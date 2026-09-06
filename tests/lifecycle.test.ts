import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { CallPolicy } from "../src/call-policy.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

function setup(clock: Clock = { now: () => new Date("2026-09-07T00:00:00.000Z") }) {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider, clock);
  const agent = control.registerAgent({ name: "lifecycle-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working", "scope-a");
  return { store, provider, control, run };
}

test("lifecycle sweep reconciles completed decision and callback without an agent-driven reconcile request", async () => {
  const { store, provider, control, run } = setup();
  const lifecycle = new LifecycleManager(control, store);

  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "deploy",
    question: "Ship?",
    blocking: true,
    idempotencyKey: "lifecycle-decision",
  });
  const decisionAttempt = store.callAttempts.get(escalation.callAttemptId!)!;
  provider.complete(decisionAttempt.providerCallId!, { status: "completed", answer: "Ship" });

  const callback = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "lifecycle-callback" });
  provider.complete(callback.providerCallId!, { status: "completed", instructions: ["Run the release checklist"] });

  const result = await lifecycle.sweep();

  assert.equal(result.errors.length, 0);
  assert.equal(control.getEscalation(escalation.id).status, "resolved");
  assert.equal(control.getDecision(escalation.id)?.answer, "Ship");
  assert.deepEqual(control.checkpoint(run.id).queuedInstructions.map((item) => item.text), ["Run the release checklist"]);
});

test("automatic ambiguous recovery is bounded, backoff-aware, fail-closed, and reuses the same idempotency key", async () => {
  class AlwaysAmbiguousProvider extends FakeCallProvider {
    readonly seenKeys: string[] = [];
    override async start(input: StartCallInput) {
      this.seenKeys.push(input.idempotencyKey);
      throw new Error("connection lost after send");
    }
  }

  const clock = new MutableClock(new Date("2026-09-07T00:00:00.000Z"));
  const store = new InMemoryControlPlaneStore();
  const provider = new AlwaysAmbiguousProvider();
  const control = new ControlPlane(store, provider, clock);
  const agent = control.registerAgent({ name: "retry-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working");
  const lifecycle = new LifecycleManager(control, store, clock, {
    maxAutomaticRecoveryAttempts: 2,
    baseBackoffMs: 1_000,
    maxBackoffMs: 10_000,
  });

  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release",
    question: "Proceed?",
    blocking: true,
    idempotencyKey: "bounded-recovery",
  });
  const attemptId = escalation.callAttemptId!;

  const firstSweep = await lifecycle.sweep();
  let attempt = control.getCallAttempt(attemptId);
  assert.equal(firstSweep.recoveriesAttempted, 1);
  assert.equal(attempt.automaticRecoveryAttempts, 1);
  assert.equal(attempt.nextAutomaticRecoveryAt, "2026-09-07T00:00:01.000Z");

  const earlySweep = await lifecycle.sweep();
  assert.equal(earlySweep.recoveriesAttempted, 0);
  assert.equal(earlySweep.recoveriesDeferred, 1);

  clock.advance(1_000);
  const finalSweep = await lifecycle.sweep();
  attempt = control.getCallAttempt(attemptId);
  assert.equal(finalSweep.recoveriesAttempted, 1);
  assert.equal(attempt.status, "ambiguous");
  assert.equal(attempt.automaticRecoveryAttempts, 2);
  assert.equal(attempt.automaticRecoveryExhaustedAt, "2026-09-07T00:00:01.000Z");
  assert.equal(attempt.nextAutomaticRecoveryAt, undefined);
  assert.deepEqual(provider.seenKeys, [
    "decision:bounded-recovery",
    "decision:bounded-recovery",
    "decision:bounded-recovery",
  ]);

  clock.advance(60_000);
  const exhaustedSweep = await lifecycle.sweep();
  assert.equal(exhaustedSweep.recoveriesAttempted, 0);
  assert.equal(exhaustedSweep.recoveriesExhausted, 1);
  assert.equal(provider.seenKeys.length, 3);
  assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release"]);
  assert.ok(control.listAuditEvents(run.id).some((event) => event.type === "call_recovery_exhausted"));
});

test("lifecycle sweep expires a policy-deferred escalation without creating a phone side effect", async () => {
  const clock = new MutableClock(new Date("2026-09-07T00:00:00.000Z"));
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const policy = new CallPolicy({ minimumDecisionPriority: "high" });
  const control = new ControlPlane(store, provider, clock, policy);
  const agent = control.registerAgent({ name: "expiry-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working");
  const lifecycle = new LifecycleManager(control, store, clock);

  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "copy",
    question: "Which wording?",
    priority: "normal",
    blocking: false,
    idempotencyKey: "deferred-expiry",
    expiresAt: "2026-09-07T00:00:10.000Z",
  });
  assert.equal(escalation.status, "pending");
  assert.equal(escalation.callAttemptId, undefined);
  assert.equal(store.callAttempts.size, 0);

  clock.advance(11_000);
  await lifecycle.sweep();
  assert.equal(control.getEscalation(escalation.id).status, "expired");
  assert.equal(store.callAttempts.size, 0);
});
