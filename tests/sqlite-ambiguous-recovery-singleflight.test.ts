import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function createGate() {
  let signalRecoveryStart!: () => void;
  let releaseRecoveryStart!: () => void;
  const recoveryStartEntered = new Promise<void>((resolve) => { signalRecoveryStart = resolve; });
  const release = new Promise<void>((resolve) => { releaseRecoveryStart = resolve; });
  return { signalRecoveryStart, releaseRecoveryStart, recoveryStartEntered, release };
}

test("lifecycle and explicit reconciliation single-flight the same ambiguous SQLite call recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-recovery-singleflight-"));
  const filename = join(directory, "state.db");
  const gate = createGate();

  class AmbiguousThenGatedProvider extends FakeCallProvider {
    starts = 0;

    override async start(input: StartCallInput) {
      this.starts += 1;
      if (this.starts === 1) throw new Error("simulated ambiguous create response");
      if (this.starts === 2) {
        gate.signalRecoveryStart();
        await gate.release;
      }
      return super.start(input);
    }
  }

  const store = SqliteControlPlaneStore.open(filename);
  try {
    const provider = new AmbiguousThenGatedProvider();
    const control = new ControlPlane(store, provider);
    const lifecycle = new LifecycleManager(control, store, undefined, {
      maxAutomaticRecoveryAttempts: 3,
      baseBackoffMs: 1,
      maxBackoffMs: 10,
    });

    const agent = control.registerAgent({ name: "recovery-agent", platform: "test", ownerId: "owner-1" });
    const run = control.startRun(agent.id, "Working while callback recovery is tested", "documentation");
    const callback = await control.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "ambiguous-callback-singleflight-1",
      prompt: "Give me a progress update",
    });

    assert.equal(callback.status, "ambiguous");
    assert.equal(callback.providerCallId, undefined);
    assert.equal(provider.starts, 1);

    const sweepPromise = lifecycle.sweep();
    await gate.recoveryStartEntered;

    const explicitReconcilePromise = control.reconcileCallback(callback.id);
    await Promise.resolve();

    assert.equal(provider.starts, 2, "concurrent recovery callers must share one provider replay");
    assert.equal(store.callAttempts.size, 1);
    assert.equal(store.callAttempts.get(callback.id)?.status, "ambiguous");

    gate.releaseRecoveryStart();
    const [sweep, explicitlyReconciled] = await Promise.all([sweepPromise, explicitReconcilePromise]);

    assert.equal(provider.starts, 2, "only the original create and one recovery replay may reach the provider");
    assert.equal(sweep.recoveriesAttempted, 1);
    assert.equal(sweep.errors.length, 0);
    assert.equal(explicitlyReconciled.id, callback.id);
    assert.ok(explicitlyReconciled.providerCallId);
    assert.equal(control.getCallAttempt(callback.id).status, "queued");

    const events = control.listAuditEvents(run.id);
    assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_ambiguous").length, 1);
    assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
    assert.equal(events.filter((event) => event.type === "owner_callback_requested").length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
