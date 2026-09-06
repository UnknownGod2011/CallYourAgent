import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { CallPolicy } from "../src/call-policy.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return this.current; }
  set(value: string): void { this.current = new Date(value); }
}

function setup(clock: MutableClock, policy: CallPolicy) {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(store, provider, clock, policy);
  const agent = controlPlane.registerAgent({ name: "policy-agent", platform: "test", ownerId: "owner-1" });
  const run = controlPlane.startRun(agent.id, "Working", "main");
  return { store, provider, controlPlane, run };
}

test("quiet hours defer a decision call and reconciliation starts it later", async () => {
  const clock = new MutableClock(new Date("2026-09-06T18:30:00.000Z")); // midnight in Asia/Kolkata
  const policy = new CallPolicy({
    quietHours: { startHour: 22, endHour: 7, timeZone: "Asia/Kolkata", bypassPriority: "critical" },
  });
  const { controlPlane, run } = setup(clock, policy);

  const escalation = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "payment",
    question: "Choose provider A or B?",
    blocking: true,
    priority: "high",
    idempotencyKey: "quiet-hours",
  });

  assert.equal(escalation.status, "pending");
  assert.equal(escalation.callAttemptId, undefined);
  assert.deepEqual(controlPlane.checkpoint(run.id).unresolvedBlockingScopes, ["payment"]);

  clock.set("2026-09-07T04:00:00.000Z"); // 09:30 in Asia/Kolkata
  const reconciled = await controlPlane.reconcileEscalation(escalation.id);
  assert.equal(reconciled.status, "calling");
  assert.ok(reconciled.callAttemptId);
});

test("critical decisions can bypass configured quiet hours", async () => {
  const clock = new MutableClock(new Date("2026-09-06T18:30:00.000Z"));
  const policy = new CallPolicy({
    quietHours: { startHour: 22, endHour: 7, timeZone: "Asia/Kolkata", bypassPriority: "critical" },
  });
  const { controlPlane, run } = setup(clock, policy);

  const escalation = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "security",
    question: "Authorize emergency rollback?",
    blocking: true,
    priority: "critical",
    idempotencyKey: "critical-bypass",
  });

  assert.equal(escalation.status, "calling");
  assert.ok(escalation.callAttemptId);
});

test("minimum priority prevents low-value phone interruptions", async () => {
  const clock = new MutableClock(new Date("2026-09-06T12:00:00.000Z"));
  const { controlPlane, run } = setup(clock, new CallPolicy({ minimumDecisionPriority: "high" }));

  const escalation = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "copy-choice",
    question: "Which subtitle sounds better?",
    blocking: false,
    priority: "normal",
    idempotencyKey: "priority-gate",
  });

  assert.equal(escalation.status, "pending");
  assert.equal(escalation.callAttemptId, undefined);
  assert.deepEqual(controlPlane.checkpoint(run.id).unresolvedBlockingScopes, []);
});

test("per-run decision budget prevents additional phone side effects", async () => {
  const clock = new MutableClock(new Date("2026-09-06T12:00:00.000Z"));
  const { controlPlane, run, store } = setup(clock, new CallPolicy({ maxDecisionCallsPerRun: 1 }));

  const first = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "first",
    question: "First important choice?",
    blocking: false,
    priority: "high",
    idempotencyKey: "budget-first",
  });
  const second = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "second",
    question: "Second important choice?",
    blocking: false,
    priority: "high",
    idempotencyKey: "budget-second",
  });

  assert.equal(first.status, "calling");
  assert.equal(second.status, "pending");
  assert.equal(second.callAttemptId, undefined);
  assert.equal(store.callAttempts.size, 1);
});

test("a deferred escalation can expire without ever placing a call", async () => {
  const clock = new MutableClock(new Date("2026-09-06T18:30:00.000Z"));
  const { controlPlane, run, store } = setup(clock, new CallPolicy({
    quietHours: { startHour: 22, endHour: 7, timeZone: "Asia/Kolkata" },
  }));

  const escalation = await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "expiring",
    question: "Need a decision soon",
    blocking: true,
    priority: "normal",
    expiresAt: "2026-09-06T19:00:00.000Z",
    idempotencyKey: "expires-quiet",
  });
  assert.equal(escalation.status, "pending");

  clock.set("2026-09-06T19:01:00.000Z");
  const expired = await controlPlane.reconcileEscalation(escalation.id);
  assert.equal(expired.status, "expired");
  assert.equal(store.callAttempts.size, 0);
  assert.deepEqual(controlPlane.checkpoint(run.id).unresolvedBlockingScopes, []);
});
