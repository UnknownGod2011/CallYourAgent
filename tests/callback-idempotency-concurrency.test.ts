import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("concurrent callback retries reserve one durable local call attempt before provider start completes", async () => {
  let signalStart!: () => void;
  let releaseStart!: () => void;
  const startEntered = new Promise<void>((resolve) => { signalStart = resolve; });
  const release = new Promise<void>((resolve) => { releaseStart = resolve; });

  class GatedProvider extends FakeCallProvider {
    starts = 0;

    override async start(input: StartCallInput) {
      this.starts += 1;
      signalStart();
      await release;
      return super.start(input);
    }
  }

  const store = new InMemoryControlPlaneStore();
  const provider = new GatedProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "concurrency-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Validating callback idempotency", "integration");
  const request = { runId: run.id, idempotencyKey: "callback-concurrent-1", prompt: "Give me current progress" };

  const firstPromise = control.requestOwnerCallback(request);
  await startEntered;

  const retry = await control.requestOwnerCallback(request);
  assert.equal(provider.starts, 1);
  assert.equal(store.callAttempts.size, 1);
  assert.equal(store.callbackByIdempotencyKey.get(request.idempotencyKey), retry.id);
  assert.equal(retry.providerCallId, undefined);

  const beforeReleaseEvents = control.listAuditEvents(run.id);
  assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_created").length, 1);
  assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_started").length, 0);

  releaseStart();
  const first = await firstPromise;

  assert.equal(first.id, retry.id);
  assert.ok(first.providerCallId);
  assert.equal(provider.starts, 1);
  assert.equal(store.callAttempts.size, 1);

  const events = control.listAuditEvents(run.id);
  assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
  assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
  assert.equal(events.filter((event) => event.type === "owner_callback_requested").length, 1);
});
