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

test("terminal webhook wins over an in-flight ambiguous SQLite callback recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-recovery-webhook-race-"));
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

    const agent = control.registerAgent({ name: "webhook-race-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working while callback recovery races a webhook", "documentation");
    const callback = await control.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "ambiguous-callback-webhook-race-1",
      prompt: "Tell me whether to change the release plan",
    });

    assert.equal(provider.starts, 1);
    assert.ok(callback.providerCallId);

    provider.complete(callback.providerCallId, {
      providerCallId: callback.providerCallId,
      status: "ambiguous",
    });
    const ambiguous = await control.reconcileCallback(callback.id);
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.providerCallId, callback.providerCallId);

    const recoveryPromise = control.recoverCallAttempt(callback.id);
    await gate.recoveryStartEntered;

    const webhook = control.ingestProviderWebhook({
      eventId: "evt-callback-terminal-during-recovery",
      providerCallId: callback.providerCallId,
      outcome: {
        providerCallId: callback.providerCallId,
        status: "completed",
        instructions: ["Keep documentation moving and postpone only the release branch."],
      },
    });

    assert.equal(webhook.duplicate, false);
    assert.equal(webhook.callAttempt.status, "completed");
    assert.equal(control.getCallAttempt(callback.id).status, "completed");

    const checkpointBeforeRecoveryReturns = control.checkpoint(run.id);
    assert.equal(checkpointBeforeRecoveryReturns.queuedInstructions.length, 1);
    const instructionId = checkpointBeforeRecoveryReturns.queuedInstructions[0]!.id;

    gate.releaseRecoveryStart();
    const recovered = await recoveryPromise;

    assert.equal(recovered.status, "completed", "late recovery result must observe and preserve the webhook terminal state");
    assert.equal(control.getCallAttempt(callback.id).status, "completed");
    assert.equal(provider.starts, 2, "only the original provider create and one recovery replay may occur");

    const checkpointAfterRecoveryReturns = control.checkpoint(run.id);
    assert.deepEqual(
      checkpointAfterRecoveryReturns.queuedInstructions.map((instruction) => instruction.id),
      [instructionId],
      "late recovery must not duplicate callback steering",
    );

    const duplicateWebhook = control.ingestProviderWebhook({
      eventId: "evt-callback-terminal-during-recovery",
      providerCallId: callback.providerCallId,
      outcome: {
        providerCallId: callback.providerCallId,
        status: "completed",
        instructions: ["This duplicate delivery must not queue another instruction."],
      },
    });
    assert.equal(duplicateWebhook.duplicate, true);
    assert.equal(control.checkpoint(run.id).queuedInstructions.length, 1);

    const events = control.listAuditEvents(run.id);
    assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_ambiguous").length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_completed").length, 1);
    assert.equal(events.filter((event) => event.type === "owner_instruction_queued").length, 1);
    assert.equal(events.filter((event) => event.type === "provider_webhook_reconciled").length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
