import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function createGate() {
  let signalRecoveryStart!: () => void;
  let releaseRecoveryStart!: () => void;
  const recoveryStartEntered = new Promise<void>((resolve) => { signalRecoveryStart = resolve; });
  const release = new Promise<void>((resolve) => { releaseRecoveryStart = resolve; });
  return { signalRecoveryStart, releaseRecoveryStart, recoveryStartEntered, release };
}

test("terminal webhook wins over an in-flight ambiguous SQLite owner-decision recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-decision-recovery-webhook-race-"));
  const filename = join(directory, "state.db");
  const gate = createGate();

  class GatedRecoveryProvider extends FakeCallProvider {
    starts = 0;

    override async start(input: StartCallInput) {
      this.starts += 1;
      if (this.starts === 2) {
        gate.signalRecoveryStart();
        await gate.release;
      }
      return super.start(input);
    }
  }

  const store = SqliteControlPlaneStore.open(filename);
  try {
    const provider = new GatedRecoveryProvider();
    const control = new ControlPlane(store, provider);

    const agent = control.registerAgent({ name: "decision-webhook-race-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Documentation continues while release approval is blocked", "documentation");
    const escalation = await control.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Proceed with the release?",
      context: "Documentation is independent and should continue while only release approval is blocked.",
      blocking: true,
      priority: "high",
      idempotencyKey: "ambiguous-decision-webhook-race-1",
    });

    assert.equal(provider.starts, 1);
    assert.ok(escalation.callAttemptId);
    const callAttemptId = escalation.callAttemptId;
    const accepted = control.getCallAttempt(callAttemptId);
    assert.ok(accepted.providerCallId);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);
    assert.equal(control.checkpoint(run.id).run.currentScope, "documentation");

    provider.complete(accepted.providerCallId, {
      providerCallId: accepted.providerCallId,
      status: "ambiguous",
    });
    const ambiguousEscalation = await control.reconcileEscalation(escalation.id);
    assert.equal(ambiguousEscalation.status, "calling");
    assert.equal(control.getCallAttempt(callAttemptId).status, "ambiguous");

    const recoveryPromise = control.recoverCallAttempt(callAttemptId);
    await gate.recoveryStartEntered;

    const webhook = control.ingestProviderWebhook({
      eventId: "evt-decision-terminal-during-recovery",
      providerCallId: accepted.providerCallId,
      outcome: {
        providerCallId: accepted.providerCallId,
        status: "completed",
        answer: "Proceed with release after documentation finishes.",
        structured: { choice: "proceed", condition: "after-documentation" },
      },
    });

    assert.equal(webhook.duplicate, false);
    assert.equal(webhook.callAttempt.status, "completed");
    assert.equal(control.getCallAttempt(callAttemptId).status, "completed");

    const resolvedBeforeRecoveryReturns = control.getEscalation(escalation.id);
    assert.equal(resolvedBeforeRecoveryReturns.status, "resolved");
    const decisionBeforeRecoveryReturns = control.getDecision(escalation.id);
    assert.equal(decisionBeforeRecoveryReturns?.answer, "Proceed with release after documentation finishes.");
    assert.deepEqual(decisionBeforeRecoveryReturns?.structured, { choice: "proceed", condition: "after-documentation" });
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);
    assert.equal(control.checkpoint(run.id).run.currentScope, "documentation");

    gate.releaseRecoveryStart();
    const recovered = await recoveryPromise;

    assert.equal(recovered.status, "completed", "late recovery result must preserve the webhook terminal state");
    assert.equal(control.getCallAttempt(callAttemptId).status, "completed");
    assert.equal(provider.starts, 2, "only the original provider create and one recovery replay may occur");
    assert.equal(store.decisions.size, 1, "late recovery must not duplicate the durable owner decision");
    assert.equal(control.getEscalation(escalation.id).decisionId, decisionBeforeRecoveryReturns?.id);
    assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, []);

    const duplicateWebhook = control.ingestProviderWebhook({
      eventId: "evt-decision-terminal-during-recovery",
      providerCallId: accepted.providerCallId,
      outcome: {
        providerCallId: accepted.providerCallId,
        status: "completed",
        answer: "A duplicate delivery must not create another decision.",
        structured: { choice: "duplicate" },
      },
    });
    assert.equal(duplicateWebhook.duplicate, true);
    assert.equal(store.decisions.size, 1);
    assert.equal(control.getDecision(escalation.id)?.id, decisionBeforeRecoveryReturns?.id);

    const events = control.listAuditEvents(run.id);
    assert.equal(events.filter((event) => event.type === "call_attempt_created" && event.callAttemptId === callAttemptId).length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_started" && event.callAttemptId === callAttemptId).length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_ambiguous" && event.callAttemptId === callAttemptId).length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_completed" && event.callAttemptId === callAttemptId).length, 1);
    assert.equal(events.filter((event) => event.type === "owner_decision_recorded" && event.escalationId === escalation.id).length, 1);
    assert.equal(events.filter((event) => event.type === "provider_webhook_reconciled").length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
