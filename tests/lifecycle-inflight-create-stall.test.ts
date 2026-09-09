import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider, type StartCallInput, type StartCallResult } from "../src/call-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

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

test("lifecycle does not stall a locally reserved callback while provider create is still in flight", async () => {
  const clock = new MutableClock(new Date("2026-09-09T13:30:00.000Z"));
  const store = new InMemoryControlPlaneStore();
  const provider = new GatedStartProvider();
  const control = new ControlPlane(store, provider, clock);
  const agent = control.registerAgent({ name: "inflight-create-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Continuing unrelated work", "documentation");
  const lifecycle = new LifecycleManager(control, store, clock, { maxInProgressCallAgeMs: 5_000 });

  const callbackPromise = control.requestOwnerCallback({
    runId: run.id,
    prompt: "Give me a progress update",
    idempotencyKey: "inflight-create-callback",
  });
  await provider.startEntered;

  const [reserved] = [...store.callAttempts.values()];
  assert.ok(reserved);
  assert.equal(reserved.purpose, "owner_callback");
  assert.equal(reserved.status, "queued");
  assert.equal(reserved.providerCallId, undefined);

  clock.advance(5_001);
  const sweep = await lifecycle.sweep();

  assert.equal(sweep.errors.length, 0);
  assert.equal(sweep.staleCallsMarked, 0);
  assert.equal(control.getCallAttempt(reserved.id).status, "queued");
  assert.equal(control.getCallAttempt(reserved.id).providerCallId, undefined);
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_stalled").length,
    0,
  );

  provider.releaseStart();
  const accepted = await callbackPromise;

  assert.equal(accepted.id, reserved.id);
  assert.ok(accepted.providerCallId);
  assert.equal(accepted.status, "queued");
  assert.equal(control.getRun(run.id).currentScope, "documentation");
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_started").length,
    1,
  );
});
