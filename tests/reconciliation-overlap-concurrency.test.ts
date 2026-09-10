import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

class TwoObserverGateProvider extends FakeCallProvider {
  private entries = 0;
  private releaseGate!: () => void;
  private firstGate!: () => void;
  private bothGate!: () => void;

  readonly firstObserveEntered = new Promise<void>((resolve) => { this.firstGate = resolve; });
  readonly bothObservesEntered = new Promise<void>((resolve) => { this.bothGate = resolve; });
  private readonly release = new Promise<void>((resolve) => { this.releaseGate = resolve; });

  override async observe(providerCallId: string) {
    this.entries += 1;
    if (this.entries === 1) this.firstGate();
    if (this.entries === 2) this.bothGate();
    await this.release;
    return super.observe(providerCallId);
  }

  releaseObservations(): void {
    this.releaseGate();
  }
}

test("lifecycle sweep and explicit callback reconciliation converge on one steering effect", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new TwoObserverGateProvider();
  const control = new ControlPlane(store, provider);
  const lifecycle = new LifecycleManager(control, store);
  const agent = control.registerAgent({ name: "callback-overlap-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Continue unrelated documentation work", "documentation");
  const callback = await control.requestOwnerCallback({
    runId: run.id,
    prompt: "Give me current progress and let me steer the run",
    idempotencyKey: "callback-overlap-1",
  });

  assert.ok(callback.providerCallId);
  provider.complete(callback.providerCallId, {
    providerCallId: callback.providerCallId,
    status: "completed",
    instructions: ["Prioritize the release checklist at the next safe checkpoint."],
    structured: { source: "overlap-test" },
  });

  const sweepPromise = lifecycle.sweep();
  await provider.firstObserveEntered;
  const explicitPromise = control.reconcileCallback(callback.id);
  await provider.bothObservesEntered;
  provider.releaseObservations();

  const [sweep, explicit] = await Promise.all([sweepPromise, explicitPromise]);
  assert.equal(sweep.errors.length, 0);
  assert.equal(explicit.status, "completed");
  assert.equal(store.instructions.size, 1);

  const checkpoint = control.checkpoint(run.id);
  assert.equal(checkpoint.run.currentScope, "documentation");
  assert.equal(checkpoint.queuedInstructions.length, 1);
  assert.equal(checkpoint.queuedInstructions[0]?.text, "Prioritize the release checklist at the next safe checkpoint.");

  const events = control.listAuditEvents(run.id);
  assert.equal(events.filter((event) => event.type === "call_attempt_completed").length, 1);
  assert.equal(events.filter((event) => event.type === "owner_instruction_queued").length, 1);
  assert.equal(events.filter((event) => event.type === "call_attempt_ambiguous").length, 0);

  const completed = events.find((event) => event.type === "call_attempt_completed");
  const queued = events.find((event) => event.type === "owner_instruction_queued");
  assert.ok(completed && queued);
  assert.equal(completed.callAttemptId, callback.id);
  assert.equal(queued.callAttemptId, callback.id);
  assert.ok(completed.sequence < queued.sequence);

  const retry = await control.reconcileCallback(callback.id);
  assert.equal(retry.status, "completed");
  assert.equal(store.instructions.size, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_instruction_queued").length, 1);
});

test("lifecycle sweep and explicit decision reconciliation converge on one decision and one branch release", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new TwoObserverGateProvider();
  const control = new ControlPlane(store, provider);
  const lifecycle = new LifecycleManager(control, store);
  const agent = control.registerAgent({ name: "decision-overlap-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Continue documentation while release waits", "documentation");
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release-approval",
    question: "Should the release branch proceed?",
    blocking: true,
    idempotencyKey: "decision-overlap-1",
  });

  assert.ok(escalation.callAttemptId);
  const attempt = control.getCallAttempt(escalation.callAttemptId);
  assert.ok(attempt.providerCallId);

  const before = control.checkpoint(run.id);
  assert.deepEqual(before.unresolvedBlockingScopes, ["release-approval"]);
  assert.equal(before.run.currentScope, "documentation");

  provider.complete(attempt.providerCallId, {
    providerCallId: attempt.providerCallId,
    status: "completed",
    answer: "Proceed with the release.",
    structured: { decision: "proceed", source: "overlap-test" },
  });

  const sweepPromise = lifecycle.sweep();
  await provider.firstObserveEntered;
  const explicitPromise = control.reconcileEscalation(escalation.id);
  await provider.bothObservesEntered;
  provider.releaseObservations();

  const [sweep, explicit] = await Promise.all([sweepPromise, explicitPromise]);
  assert.equal(sweep.errors.length, 0);
  assert.equal(explicit.status, "resolved");
  assert.equal(store.decisions.size, 1);
  assert.equal(control.getDecision(escalation.id)?.answer, "Proceed with the release.");

  const after = control.checkpoint(run.id);
  assert.deepEqual(after.unresolvedBlockingScopes, []);
  assert.equal(after.run.currentScope, "documentation");

  const events = control.listAuditEvents(run.id);
  assert.equal(events.filter((event) => event.type === "call_attempt_completed").length, 1);
  assert.equal(events.filter((event) => event.type === "owner_decision_recorded").length, 1);
  assert.equal(events.filter((event) => event.type === "call_attempt_ambiguous").length, 0);

  const completed = events.find((event) => event.type === "call_attempt_completed");
  const decision = events.find((event) => event.type === "owner_decision_recorded");
  assert.ok(completed && decision);
  assert.equal(completed.callAttemptId, attempt.id);
  assert.equal(decision.callAttemptId, attempt.id);
  assert.ok(completed.sequence < decision.sequence);

  const retry = await control.reconcileEscalation(escalation.id);
  assert.equal(retry.status, "resolved");
  assert.equal(store.decisions.size, 1);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "owner_decision_recorded").length, 1);
});
