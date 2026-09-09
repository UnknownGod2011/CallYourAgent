import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FakeCallProvider,
  type CallProviderObservation,
} from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function createObservationGate() {
  let signalObserve!: () => void;
  let releaseObserve!: () => void;
  const observeEntered = new Promise<void>((resolve) => { signalObserve = resolve; });
  const release = new Promise<void>((resolve) => { releaseObserve = resolve; });
  return { signalObserve, releaseObserve, observeEntered, release };
}

test("late active callback poll cannot downgrade a callback completed by webhook", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-callback-poll-webhook-race-"));
  const filename = join(directory, "state.db");
  const gate = createObservationGate();

  class GatedObservationProvider extends FakeCallProvider {
    override async observe(providerCallId: string): Promise<CallProviderObservation> {
      gate.signalObserve();
      await gate.release;
      return { providerCallId, status: "in_progress" };
    }
  }

  const store = SqliteControlPlaneStore.open(filename);
  try {
    const provider = new GatedObservationProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "callback-poll-race-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working on documentation", "documentation");
    const callback = await control.requestOwnerCallback({
      runId: run.id,
      prompt: "Give me the latest progress and let me steer if needed.",
      idempotencyKey: "callback-poll-webhook-race-1",
    });

    assert.ok(callback.providerCallId);
    const reconcilePromise = control.reconcileCallback(callback.id);
    await gate.observeEntered;

    const webhook = control.ingestProviderWebhook({
      eventId: "evt-callback-poll-race-completed",
      providerCallId: callback.providerCallId,
      outcome: {
        providerCallId: callback.providerCallId,
        status: "completed",
        instructions: ["Keep documentation moving and report again at the next safe checkpoint."],
      },
    });

    assert.equal(webhook.callAttempt.status, "completed");
    assert.equal(control.getCallAttempt(callback.id).status, "completed");
    assert.equal(store.instructions.size, 1);

    gate.releaseObserve();
    const reconciled = await reconcilePromise;

    assert.equal(reconciled.status, "completed", "a stale active poll must not overwrite terminal webhook state");
    assert.equal(control.getCallAttempt(callback.id).status, "completed");
    assert.equal(store.instructions.size, 1, "late poll must not duplicate callback steering");

    const events = control.listAuditEvents(run.id);
    assert.equal(events.filter((event) => event.type === "call_attempt_completed" && event.callAttemptId === callback.id).length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_progressed" && event.callAttemptId === callback.id).length, 0);
    assert.equal(events.filter((event) => event.type === "owner_instruction_queued" && event.callAttemptId === callback.id).length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("late failed decision poll cannot overwrite a decision completed by webhook", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-decision-poll-webhook-race-"));
  const filename = join(directory, "state.db");
  const gate = createObservationGate();

  class GatedObservationProvider extends FakeCallProvider {
    override async observe(providerCallId: string): Promise<CallProviderObservation> {
      gate.signalObserve();
      await gate.release;
      return { providerCallId, status: "failed", error: "stale provider poll" };
    }
  }

  const store = SqliteControlPlaneStore.open(filename);
  try {
    const provider = new GatedObservationProvider();
    const control = new ControlPlane(store, provider);
    const agent = control.registerAgent({ name: "decision-poll-race-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Documentation remains independent", "documentation");
    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Proceed with the release?",
      blocking: true,
      priority: "high",
      idempotencyKey: "decision-poll-webhook-race-1",
    });

    assert.ok(escalation.callAttemptId);
    const callAttempt = control.getCallAttempt(escalation.callAttemptId);
    assert.ok(callAttempt.providerCallId);
    const reconcilePromise = control.reconcileEscalation(escalation.id);
    await gate.observeEntered;

    control.ingestProviderWebhook({
      eventId: "evt-decision-poll-race-completed",
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
    const reconciled = await reconcilePromise;

    assert.equal(reconciled.status, "resolved");
    assert.equal(control.getCallAttempt(callAttempt.id).status, "completed", "stale failed poll must not overwrite completed webhook state");
    assert.equal(store.decisions.size, 1);
    assert.equal(control.getDecision(escalation.id)?.id, winningDecision?.id);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);

    const events = control.listAuditEvents(run.id);
    assert.equal(events.filter((event) => event.type === "call_attempt_completed" && event.callAttemptId === callAttempt.id).length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_failed" && event.callAttemptId === callAttempt.id).length, 0);
    assert.equal(events.filter((event) => event.type === "owner_decision_recorded" && event.escalationId === escalation.id).length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
