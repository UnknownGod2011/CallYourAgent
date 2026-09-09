import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FakeCallProvider,
  type CallProviderObservation,
} from "../src/call-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

function createObservationGate() {
  let signalObserve!: () => void;
  let releaseObserve!: () => void;
  const observeEntered = new Promise<void>((resolve) => { signalObserve = resolve; });
  const release = new Promise<void>((resolve) => { releaseObserve = resolve; });
  return { signalObserve, releaseObserve, observeEntered, release };
}

test("SQLite lifecycle sweep does not stall an overdue callback when terminal webhook wins during provider poll", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-lifecycle-callback-webhook-stall-race-"));
  const filename = join(directory, "state.db");
  const gate = createObservationGate();

  class GatedObservationProvider extends FakeCallProvider {
    override async observe(providerCallId: string): Promise<CallProviderObservation> {
      gate.signalObserve();
      await gate.release;
      return { providerCallId, status: "in_progress" };
    }
  }

  const clock = new MutableClock(new Date("2026-09-09T00:00:00.000Z"));
  const store = SqliteControlPlaneStore.open(filename);
  try {
    const provider = new GatedObservationProvider();
    const control = new ControlPlane(store, provider, clock);
    const lifecycle = new LifecycleManager(control, store, clock, { maxInProgressCallAgeMs: 1_000 });
    const agent = control.registerAgent({ name: "callback-lifecycle-race-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Documentation remains active", "documentation");
    const callback = await control.requestOwnerCallback({
      runId: run.id,
      prompt: "Give me the current status and let me steer the run.",
      idempotencyKey: "lifecycle-callback-webhook-stall-race-1",
    });

    assert.ok(callback.providerCallId);
    clock.advance(1_001);
    const sweepPromise = lifecycle.sweep();
    await gate.observeEntered;

    control.ingestProviderWebhook({
      eventId: "evt-lifecycle-callback-webhook-stall-race-completed",
      providerCallId: callback.providerCallId,
      outcome: {
        providerCallId: callback.providerCallId,
        status: "completed",
        instructions: ["Keep documentation moving and check back at the next safe checkpoint."],
      },
    });

    assert.equal(control.getCallAttempt(callback.id).status, "completed");
    assert.equal(store.instructions.size, 1);
    assert.equal(control.checkpoint(run.id).run.currentScope, "documentation");

    gate.releaseObserve();
    const sweep = await sweepPromise;

    assert.equal(sweep.errors.length, 0);
    assert.equal(sweep.staleCallsMarked, 0, "terminal webhook must prevent a false stalled transition");
    assert.equal(control.getCallAttempt(callback.id).status, "completed");
    assert.equal(store.instructions.size, 1, "lifecycle completion must not duplicate callback steering");
    assert.equal(control.checkpoint(run.id).run.currentScope, "documentation");

    const events = control.listAuditEvents(run.id);
    assert.equal(events.filter((event) => event.type === "call_attempt_completed" && event.callAttemptId === callback.id).length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_stalled" && event.callAttemptId === callback.id).length, 0);
    assert.equal(events.filter((event) => event.type === "call_attempt_progressed" && event.callAttemptId === callback.id).length, 0);
    assert.equal(events.filter((event) => event.type === "owner_instruction_queued" && event.callAttemptId === callback.id).length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite lifecycle sweep does not stall an overdue blocking decision when terminal webhook wins during provider poll", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-lifecycle-decision-webhook-stall-race-"));
  const filename = join(directory, "state.db");
  const gate = createObservationGate();

  class GatedObservationProvider extends FakeCallProvider {
    override async observe(providerCallId: string): Promise<CallProviderObservation> {
      gate.signalObserve();
      await gate.release;
      return { providerCallId, status: "in_progress" };
    }
  }

  const clock = new MutableClock(new Date("2026-09-09T00:00:00.000Z"));
  const store = SqliteControlPlaneStore.open(filename);
  try {
    const provider = new GatedObservationProvider();
    const control = new ControlPlane(store, provider, clock);
    const lifecycle = new LifecycleManager(control, store, clock, { maxInProgressCallAgeMs: 1_000 });
    const agent = control.registerAgent({ name: "decision-lifecycle-race-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Documentation remains independent", "documentation");
    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Proceed with the release?",
      blocking: true,
      priority: "high",
      idempotencyKey: "lifecycle-decision-webhook-stall-race-1",
    });

    assert.ok(escalation.callAttemptId);
    const callAttempt = control.getCallAttempt(escalation.callAttemptId);
    assert.ok(callAttempt.providerCallId);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);

    clock.advance(1_001);
    const sweepPromise = lifecycle.sweep();
    await gate.observeEntered;

    control.ingestProviderWebhook({
      eventId: "evt-lifecycle-decision-webhook-stall-race-completed",
      providerCallId: callAttempt.providerCallId,
      outcome: {
        providerCallId: callAttempt.providerCallId,
        status: "completed",
        answer: "Proceed after documentation is complete.",
        structured: { choice: "proceed", condition: "after-documentation" },
      },
    });

    const winningDecision = control.getDecision(escalation.id);
    assert.equal(winningDecision?.answer, "Proceed after documentation is complete.");
    assert.equal(control.getCallAttempt(callAttempt.id).status, "completed");
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);
    assert.equal(control.checkpoint(run.id).run.currentScope, "documentation");

    gate.releaseObserve();
    const sweep = await sweepPromise;

    assert.equal(sweep.errors.length, 0);
    assert.equal(sweep.staleCallsMarked, 0, "terminal decision evidence must prevent a false stalled transition");
    assert.equal(control.getCallAttempt(callAttempt.id).status, "completed");
    assert.equal(control.getEscalation(escalation.id).status, "resolved");
    assert.equal(store.decisions.size, 1);
    assert.equal(control.getDecision(escalation.id)?.id, winningDecision?.id);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);
    assert.equal(control.checkpoint(run.id).run.currentScope, "documentation");

    const events = control.listAuditEvents(run.id);
    assert.equal(events.filter((event) => event.type === "call_attempt_completed" && event.callAttemptId === callAttempt.id).length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_stalled" && event.callAttemptId === callAttempt.id).length, 0);
    assert.equal(events.filter((event) => event.type === "call_attempt_progressed" && event.callAttemptId === callAttempt.id).length, 0);
    assert.equal(events.filter((event) => event.type === "owner_decision_recorded" && event.escalationId === escalation.id).length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
