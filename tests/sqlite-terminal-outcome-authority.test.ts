import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function conflictEvents(control: ControlPlane, runId: string, callAttemptId: string) {
  return control.listAuditEvents(runId).filter(
    (event) => event.type === "call_attempt_terminal_conflict" && event.callAttemptId === callAttemptId,
  );
}

test("stale SQLite worker converges to completed owner decision when a conflicting failure loses the terminal claim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-terminal-authority-decision-"));
  const filename = join(directory, "state.db");
  const winnerStore = SqliteControlPlaneStore.open(filename);
  let loserStore: SqliteControlPlaneStore | undefined;

  try {
    const winner = new ControlPlane(winnerStore, new FakeCallProvider());
    const agent = winner.registerAgent({ name: "terminal-race-agent", platform: "test", ownerId: "owner-1" });
    const run = winner.startRun(agent.id, "Documentation can continue", "documentation");
    const escalation = await winner.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship the release?",
      blocking: true,
      priority: "high",
      idempotencyKey: "terminal-authority-decision-1",
    });
    assert.ok(escalation.callAttemptId);
    const attempt = winner.getCallAttempt(escalation.callAttemptId);
    assert.ok(attempt.providerCallId);

    // Open before the winner commits so this worker intentionally holds stale mirrors.
    loserStore = SqliteControlPlaneStore.open(filename);
    const loser = new ControlPlane(loserStore, new FakeCallProvider());
    assert.equal(loser.getCallAttempt(attempt.id).status, "queued");

    winner.ingestProviderWebhook({
      eventId: "evt-terminal-authority-decision-winner",
      providerCallId: attempt.providerCallId,
      outcome: {
        providerCallId: attempt.providerCallId,
        status: "completed",
        answer: "Ship after the final checks.",
        structured: { choice: "ship", condition: "final-checks" },
      },
    });

    const losingDelivery = loser.ingestProviderWebhook({
      eventId: "evt-terminal-authority-decision-loser",
      providerCallId: attempt.providerCallId,
      outcome: { providerCallId: attempt.providerCallId, status: "failed" },
    });

    assert.equal(losingDelivery.callAttempt.status, "completed");
    assert.equal(loser.getCallAttempt(attempt.id).status, "completed");
    assert.equal(loser.getEscalation(escalation.id).status, "resolved");
    assert.equal(loser.getDecision(escalation.id)?.answer, "Ship after the final checks.");
    assert.equal(loserStore.decisions.size, 1);
    assert.deepEqual(loser.checkpoint(run.id).unresolvedBlockingScopes, []);

    const conflicts = conflictEvents(loser, run.id, attempt.id);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0]?.details, {
      winningStatus: "completed",
      observedStatus: "failed",
      payloadConflict: true,
    });

    // Another conflicting provider event stays converged and does not spam conflict audit.
    loser.ingestProviderWebhook({
      eventId: "evt-terminal-authority-decision-loser-retry",
      providerCallId: attempt.providerCallId,
      outcome: { providerCallId: attempt.providerCallId, status: "failed" },
    });
    assert.equal(conflictEvents(loser, run.id, attempt.id).length, 1);
    assert.equal(loserStore.decisions.size, 1);
  } finally {
    loserStore?.close();
    winnerStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stale SQLite worker cannot replace callback steering with a different completed payload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-terminal-authority-callback-"));
  const filename = join(directory, "state.db");
  const winnerStore = SqliteControlPlaneStore.open(filename);
  let loserStore: SqliteControlPlaneStore | undefined;

  try {
    const winner = new ControlPlane(winnerStore, new FakeCallProvider());
    const agent = winner.registerAgent({ name: "terminal-callback-race-agent", platform: "test", ownerId: "owner-1" });
    const run = winner.startRun(agent.id, "Implementing the integration", "integration");
    const callback = await winner.requestOwnerCallback({
      runId: run.id,
      prompt: "Give progress and steering.",
      idempotencyKey: "terminal-authority-callback-1",
    });
    assert.ok(callback.providerCallId);

    loserStore = SqliteControlPlaneStore.open(filename);
    const loser = new ControlPlane(loserStore, new FakeCallProvider());
    assert.equal(loser.getCallAttempt(callback.id).status, "queued");

    winner.ingestProviderWebhook({
      eventId: "evt-terminal-authority-callback-winner",
      providerCallId: callback.providerCallId,
      outcome: {
        providerCallId: callback.providerCallId,
        status: "completed",
        instructions: ["Keep the API stable and finish the integration tests."],
        structured: { source: "owner" },
      },
    });

    const losingDelivery = loser.ingestProviderWebhook({
      eventId: "evt-terminal-authority-callback-loser",
      providerCallId: callback.providerCallId,
      outcome: {
        providerCallId: callback.providerCallId,
        status: "completed",
        instructions: ["Discard the API and rewrite everything."],
        structured: { source: "conflicting-delivery" },
      },
    });

    assert.equal(losingDelivery.callAttempt.status, "completed");
    assert.equal(loser.getCallAttempt(callback.id).status, "completed");
    const queued = loser.checkpoint(run.id).queuedInstructions;
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.text, "Keep the API stable and finish the integration tests.");
    assert.equal(loserStore.instructions.size, 1);

    const conflicts = conflictEvents(loser, run.id, callback.id);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0]?.details, {
      winningStatus: "completed",
      observedStatus: "completed",
      payloadConflict: true,
    });
    const serializedConflict = JSON.stringify(conflicts[0]);
    assert.doesNotMatch(serializedConflict, /Discard the API|Keep the API stable|fingerprint/i);
  } finally {
    loserStore?.close();
    winnerStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
