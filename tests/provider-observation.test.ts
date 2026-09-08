import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider, type CallProvider, type CallProviderObservation, type StartCallInput, type StartCallResult } from "../src/call-provider.js";
import { CalleCallProvider } from "../src/calle-provider.js";
import { ControlPlane, type Clock } from "../src/control-plane.js";
import { LifecycleManager } from "../src/lifecycle.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

class MutableObservationProvider implements CallProvider {
  readonly name = "mutable-observation";
  readonly providerCallId = "mutable_call_1";
  observationStatus: "queued" | "in_progress" = "queued";
  startCount = 0;

  async start(_input: StartCallInput): Promise<StartCallResult> {
    this.startCount += 1;
    return { providerCallId: this.providerCallId, status: "queued" };
  }

  async observe(providerCallId: string): Promise<CallProviderObservation> {
    if (providerCallId !== this.providerCallId) throw new Error(`Unknown mutable call: ${providerCallId}`);
    return { providerCallId, status: this.observationStatus };
  }

  async getOutcome(providerCallId: string) {
    await this.observe(providerCallId);
    return null;
  }
}

test("CALL-E observation preserves active queued and in-progress states instead of collapsing them to null", async () => {
  let requestCount = 0;
  const fetchImpl = (async () => {
    requestCount += 1;
    const payload = requestCount === 1
      ? { id: "call_active", status: "queued", structured_result: null }
      : { id: "call_active", status: "in_progress", structured_result: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const provider = new CalleCallProvider({ apiKey: "key", ownerPhone: "TEST_OWNER_PHONE", fetchImpl });

  assert.deepEqual(await provider.observe("call_active"), { providerCallId: "call_active", status: "queued" });
  assert.deepEqual(await provider.observe("call_active"), { providerCallId: "call_active", status: "in_progress" });
});

test("queued to in-progress observation is durable once and repeated polls do not reset stale-call age", async () => {
  const clock = new MutableClock(new Date("2026-09-08T00:00:00.000Z"));
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider, clock);
  const lifecycle = new LifecycleManager(control, store, clock, { maxInProgressCallAgeMs: 5_000 });
  const agent = control.registerAgent({ name: "observation-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working", "independent-scope");

  const callback = await control.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "provider-observation-callback",
    prompt: "Give me progress",
  });
  assert.equal(callback.status, "queued");
  assert.equal(callback.updatedAt, "2026-09-08T00:00:00.000Z");

  clock.advance(4_000);
  provider.progress(callback.providerCallId!);
  const progressed = await control.reconcileCallback(callback.id);

  assert.equal(progressed.status, "in_progress");
  assert.equal(progressed.updatedAt, "2026-09-08T00:00:04.000Z");
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
    1,
  );

  clock.advance(4_000);
  const repeated = await control.reconcileCallback(callback.id);
  assert.equal(repeated.status, "in_progress");
  assert.equal(repeated.updatedAt, "2026-09-08T00:00:04.000Z");
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
    1,
  );

  const beforeTimeout = await lifecycle.sweep();
  assert.equal(beforeTimeout.staleCallsMarked, 0);
  assert.equal(control.getCallAttempt(callback.id).status, "in_progress");
  assert.equal(control.getCallAttempt(callback.id).updatedAt, "2026-09-08T00:00:04.000Z");

  clock.advance(1_001);
  const afterTimeout = await lifecycle.sweep();
  const stalled = control.getCallAttempt(callback.id);

  assert.equal(afterTimeout.staleCallsMarked, 1);
  assert.equal(stalled.status, "stalled");
  assert.equal(stalled.stalledAt, "2026-09-08T00:00:09.001Z");
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
    1,
  );
});

test("stale queued provider observation cannot downgrade an in-progress callback or reset its timeout anchor", async () => {
  const clock = new MutableClock(new Date("2026-09-08T01:00:00.000Z"));
  const store = new InMemoryControlPlaneStore();
  const provider = new MutableObservationProvider();
  const control = new ControlPlane(store, provider, clock);
  const lifecycle = new LifecycleManager(control, store, clock, { maxInProgressCallAgeMs: 5_000 });
  const agent = control.registerAgent({ name: "stale-observation-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working", "independent-scope");

  const callback = await control.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "stale-provider-observation-callback",
    prompt: "Give me progress",
  });
  assert.equal(callback.status, "queued");
  assert.equal(provider.startCount, 1);

  clock.advance(1_000);
  provider.observationStatus = "in_progress";
  const progressed = await control.reconcileCallback(callback.id);
  const progressTimestamp = progressed.updatedAt;
  const progressEvents = control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed");

  assert.equal(progressed.status, "in_progress");
  assert.equal(progressTimestamp, "2026-09-08T01:00:01.000Z");
  assert.equal(progressEvents.length, 1);

  clock.advance(3_000);
  provider.observationStatus = "queued";
  const stale = await control.reconcileCallback(callback.id);

  assert.equal(stale.status, "in_progress");
  assert.equal(stale.updatedAt, progressTimestamp);
  assert.equal(provider.startCount, 1);
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
    1,
  );

  const beforeTimeout = await lifecycle.sweep();
  assert.equal(beforeTimeout.staleCallsMarked, 0);
  assert.equal(control.getCallAttempt(callback.id).status, "in_progress");
  assert.equal(control.getCallAttempt(callback.id).updatedAt, progressTimestamp);

  clock.advance(2_001);
  const afterTimeout = await lifecycle.sweep();
  const stalled = control.getCallAttempt(callback.id);

  assert.equal(afterTimeout.staleCallsMarked, 1);
  assert.equal(stalled.status, "stalled");
  assert.equal(stalled.updatedAt, progressTimestamp);
  assert.equal(stalled.stalledAt, "2026-09-08T01:00:06.001Z");
  assert.equal(provider.startCount, 1);
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_progressed").length,
    1,
  );
  assert.equal(
    control.listAuditEvents(run.id).filter((event) => event.type === "call_attempt_stalled").length,
    1,
  );
});
