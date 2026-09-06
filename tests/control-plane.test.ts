import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function setup(provider: FakeCallProvider = new FakeCallProvider()) {
  const store = new InMemoryControlPlaneStore();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "demo-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Building the application", "backend");
  return { store, provider, control, run };
}

test("non-blocking escalation lets unrelated work continue and resolves into a decision", async () => {
  const { store, provider, control, run } = setup();
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "pricing-copy",
    question: "Use the concise or detailed pricing copy?",
    blocking: false,
    idempotencyKey: "decision-1",
  });

  const checkpointWhileCalling = control.checkpoint(run.id);
  assert.deepEqual(checkpointWhileCalling.unresolvedBlockingScopes, []);

  const attempt = store.callAttempts.get(escalation.callAttemptId!)!;
  provider.complete(attempt.providerCallId!, { status: "completed", answer: "Use concise copy", structured: { choice: "concise" } });
  const resolved = await control.reconcileEscalation(escalation.id);

  assert.equal(resolved.status, "resolved");
  assert.equal(control.getDecision(escalation.id)?.structured?.choice, "concise");
});

test("blocking escalation blocks only its scope and idempotent retries do not create calls", async () => {
  const { store, control, run } = setup();
  const request = {
    runId: run.id,
    scopeId: "production-deploy",
    question: "Deploy to production?",
    blocking: true,
    idempotencyKey: "deploy-approval-1",
  } as const;

  const first = await control.requestOwnerDecision(request);
  const retry = await control.requestOwnerDecision(request);

  assert.equal(first.id, retry.id);
  assert.equal(store.callAttempts.size, 1);
  assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["production-deploy"]);
});

test("ambiguous create is linked durably and recoverable with the exact same idempotency key", async () => {
  class FlakyProvider extends FakeCallProvider {
    readonly seenKeys: string[] = [];
    private failFirst = true;

    override async start(input: StartCallInput) {
      this.seenKeys.push(input.idempotencyKey);
      if (this.failFirst) {
        this.failFirst = false;
        throw new Error("socket closed after request transmission");
      }
      return super.start(input);
    }
  }

  const provider = new FlakyProvider();
  const { store, control, run } = setup(provider);
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "deploy",
    question: "Proceed with production deploy?",
    blocking: true,
    idempotencyKey: "recoverable-decision",
  });

  const ambiguous = store.callAttempts.get(escalation.callAttemptId!)!;
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.providerCallId, undefined);
  assert.match(ambiguous.lastError ?? "", /socket closed/);
  assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["deploy"]);

  await control.reconcileEscalation(escalation.id);
  const recovered = store.callAttempts.get(escalation.callAttemptId!)!;

  assert.equal(recovered.status, "queued");
  assert.ok(recovered.providerCallId);
  assert.equal(recovered.lastError, undefined);
  assert.deepEqual(provider.seenKeys, ["decision:recoverable-decision", "decision:recoverable-decision"]);
});

test("owner-requested callback receives current status and queues instructions for safe checkpoint consumption", async () => {
  const { store, provider, control, run } = setup();
  control.heartbeat(run.id, { summary: "Backend finished; validating adapters", currentScope: "integration" });

  const callback = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "callback-1" });
  provider.complete(callback.providerCallId!, {
    status: "completed",
    instructions: ["Prioritize Claude integration", "Do not spend time on dashboard polish"],
  });
  await control.reconcileCallback(callback.id);

  const beforeConsume = control.checkpoint(run.id);
  assert.deepEqual(beforeConsume.queuedInstructions.map((item) => item.text), [
    "Prioritize Claude integration",
    "Do not spend time on dashboard polish",
  ]);

  control.checkpoint(run.id, true);
  assert.equal(control.checkpoint(run.id).queuedInstructions.length, 0);
  assert.equal([...store.instructions.values()].every((item) => item.status === "consumed"), true);
});

test("callback idempotency prevents duplicate phone side effects", async () => {
  const { store, control, run } = setup();
  const first = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "same-callback" });
  const retry = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "same-callback" });
  assert.equal(first.id, retry.id);
  assert.equal(store.callAttempts.size, 1);
});

test("terminal decision webhook resolves through the same transition path and deduplicates event delivery", async () => {
  const { store, control, run } = setup();
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release",
    question: "Ship now?",
    blocking: true,
    idempotencyKey: "webhook-decision",
  });
  const attempt = store.callAttempts.get(escalation.callAttemptId!)!;

  const first = control.ingestProviderWebhook({
    eventId: "evt_decision_1",
    providerCallId: attempt.providerCallId!,
    outcome: { status: "completed", answer: "Ship it", structured: { choice: "ship" } },
  });
  const second = control.ingestProviderWebhook({
    eventId: "evt_decision_1",
    providerCallId: attempt.providerCallId!,
    outcome: { status: "completed", answer: "Ship it", structured: { choice: "ship" } },
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(control.getDecision(escalation.id)?.answer, "Ship it");
  assert.equal(store.decisions.size, 1);
  assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);
});

test("webhook completion followed by polling cannot enqueue callback instructions twice", async () => {
  const { store, provider, control, run } = setup();
  const callback = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "webhook-callback" });
  const outcome = {
    status: "completed" as const,
    instructions: ["Focus on persistence next"],
  };

  control.ingestProviderWebhook({
    eventId: "evt_callback_1",
    providerCallId: callback.providerCallId!,
    outcome,
  });
  provider.complete(callback.providerCallId!, outcome);
  await control.reconcileCallback(callback.id);

  assert.deepEqual(control.checkpoint(run.id).queuedInstructions.map((item) => item.text), ["Focus on persistence next"]);
  assert.equal(store.instructions.size, 1);
});
