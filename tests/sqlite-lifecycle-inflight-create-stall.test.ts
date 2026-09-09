import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider, type StartCallInput, type StartCallResult } from "../src/call-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

class GatedStartProvider extends FakeCallProvider {
  readonly startEntered: Promise<void>;
  private readonly startGate: Promise<void>;
  private resolveStartEntered!: () => void;
  private releaseStartGate!: () => void;

  constructor() {
    super();
    this.startEntered = new Promise<void>((resolve) => { this.resolveStartEntered = resolve; });
    this.startGate = new Promise<void>((resolve) => { this.releaseStartGate = resolve; });
  }

  override async start(input: StartCallInput): Promise<StartCallResult> {
    this.resolveStartEntered();
    await this.startGate;
    return super.start(input);
  }

  releaseStart(): void {
    this.releaseStartGate();
  }
}

function withDatabase<T>(run: (filename: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-sqlite-inflight-create-"));
  const filename = join(directory, "state.db");
  return Promise.resolve(run(filename)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test("SQLite lifecycle does not stall a durable callback reservation while provider create is in flight", async () => {
  await withDatabase(async (filename) => {
    const clock = new MutableClock(new Date("2026-09-09T14:30:00.000Z"));
    const store = SqliteControlPlaneStore.open(filename);
    try {
      const provider = new GatedStartProvider();
      const control = new ControlPlane(store, provider, clock);
      const agent = control.registerAgent({ name: "sqlite-inflight-create-agent", platform: "test", ownerId: "owner-1" });
      const run = control.startRun(agent.id, "Continuing unrelated durable work", "documentation");
      const lifecycle = new LifecycleManager(control, store, clock, { maxInProgressCallAgeMs: 5_000 });

      const callbackPromise = control.requestOwnerCallback({
        runId: run.id,
        prompt: "Give me a progress update",
        idempotencyKey: "sqlite-inflight-create-callback",
      });
      await provider.startEntered;

      const [reserved] = [...store.callAttempts.values()];
      assert.ok(reserved);
      assert.equal(reserved.purpose, "owner_callback");
      assert.equal(reserved.status, "queued");
      assert.equal(reserved.providerCallId, undefined);
      assert.equal(store.callbackByIdempotencyKey.get("sqlite-inflight-create-callback"), reserved.id);

      clock.advance(5_001);
      const sweep = await lifecycle.sweep();

      assert.equal(sweep.errors.length, 0);
      assert.equal(sweep.staleCallsMarked, 0);
      assert.equal(control.getCallAttempt(reserved.id).status, "queued");
      assert.equal(control.getCallAttempt(reserved.id).providerCallId, undefined);
      assert.equal(control.getRun(run.id).currentScope, "documentation");
      assert.equal(
        control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_stalled").length,
        0,
      );

      provider.releaseStart();
      const accepted = await callbackPromise;

      assert.equal(accepted.id, reserved.id);
      assert.ok(accepted.providerCallId);
      assert.equal(accepted.status, "queued");
      assert.equal(store.callAttempts.size, 1);
      assert.equal(
        control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length,
        1,
      );
      assert.equal(
        control.listAuditEvents(run.id).filter((event) => event.type === "owner_callback_requested").length,
        1,
      );
    } finally {
      store.close();
    }
  });
});
