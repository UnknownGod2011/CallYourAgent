import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

class TrackingStore extends InMemoryControlPlaneStore {
  escalationClaims = 0;
  callbackClaims = 0;
  webhookClaims = 0;
  forcedEscalationWinner?: string;
  forcedCallbackWinner?: string;

  override bindEscalationIdempotencyKey(key: string, escalationId: string): string {
    this.escalationClaims += 1;
    return this.forcedEscalationWinner ?? super.bindEscalationIdempotencyKey(key, escalationId);
  }

  override bindCallbackIdempotencyKey(key: string, callAttemptId: string): string {
    this.callbackClaims += 1;
    return this.forcedCallbackWinner ?? super.bindCallbackIdempotencyKey(key, callAttemptId);
  }

  override claimWebhookEventId(eventId: string): boolean {
    this.webhookClaims += 1;
    return super.claimWebhookEventId(eventId);
  }
}

class CountingProvider extends FakeCallProvider {
  starts = 0;

  override async start(input: StartCallInput) {
    this.starts += 1;
    return super.start(input);
  }
}

test("decision requests converge on the atomic store winner without duplicate provider I/O", async () => {
  const store = new TrackingStore();
  const provider = new CountingProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "decision-claim-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Testing decision claim convergence", "release");
  const request = {
    runId: run.id,
    scopeId: "release-approval",
    question: "Ship this release?",
    blocking: true,
    priority: "high" as const,
    idempotencyKey: "decision-claim-1",
  };

  const first = await control.requestOwnerDecision(request);
  assert.equal(store.escalationClaims, 1);
  assert.equal(provider.starts, 1);
  assert.equal(store.escalations.size, 1);
  assert.equal(store.callAttempts.size, 1);

  // Simulate a stale caller-side read cache while the atomic store primitive still
  // knows the durable winner. The domain must converge on that winner rather than
  // creating or dispatching another logical request.
  store.escalationByIdempotencyKey.delete(request.idempotencyKey);
  store.forcedEscalationWinner = first.id;

  const retry = await control.requestOwnerDecision(request);
  assert.equal(retry.id, first.id);
  assert.equal(store.escalationClaims, 2);
  assert.equal(provider.starts, 1);
  assert.equal(store.escalations.size, 1);
  assert.equal(store.callAttempts.size, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "escalation_created").length, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length, 1);
});

test("owner callbacks converge on the atomic store winner without duplicate provider I/O", async () => {
  const store = new TrackingStore();
  const provider = new CountingProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "callback-claim-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Testing callback claim convergence", "implementation");
  const request = {
    runId: run.id,
    idempotencyKey: "callback-claim-1",
    prompt: "Give me the current progress and let me steer the next step.",
  };

  const first = await control.requestOwnerCallback(request);
  assert.equal(store.callbackClaims, 1);
  assert.equal(provider.starts, 1);
  assert.equal(store.callAttempts.size, 1);

  store.callbackByIdempotencyKey.delete(request.idempotencyKey);
  store.forcedCallbackWinner = first.id;

  const retry = await control.requestOwnerCallback(request);
  assert.equal(retry.id, first.id);
  assert.equal(store.callbackClaims, 2);
  assert.equal(provider.starts, 1);
  assert.equal(store.callAttempts.size, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_callback_requested").length, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length, 1);
});

test("provider webhook delivery uses the atomic event claim and applies terminal effects once", async () => {
  const store = new TrackingStore();
  const provider = new CountingProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "webhook-claim-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Testing webhook claim convergence", "implementation");
  const callback = await control.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "callback-webhook-claim-1",
    prompt: "Tell the agent to finish the current implementation safely.",
  });
  assert.ok(callback.providerCallId);

  const input = {
    eventId: "evt-terminal-claim-1",
    providerCallId: callback.providerCallId,
    outcome: {
      providerCallId: callback.providerCallId,
      status: "completed" as const,
      instructions: ["Finish the current implementation and run the full verification suite."],
    },
  };

  const first = control.ingestProviderWebhook(input);
  const duplicate = control.ingestProviderWebhook(input);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.webhookClaims, 2);
  assert.equal([...store.instructions.values()].filter((instruction) => instruction.runId === run.id).length, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "provider_webhook_reconciled").length, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_queued").length, 1);
});
