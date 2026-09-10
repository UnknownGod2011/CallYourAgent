import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane, IDEMPOTENCY_CONFLICT_MESSAGE } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function setup() {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "idempotency-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Working", "scope-a");
  return { store, provider, control, agent, run };
}

test("owner-decision idempotency key is bound to the original logical request", async () => {
  const { store, control, agent, run } = setup();
  const request = {
    runId: run.id, scopeId: "release", question: "Ship now?", context: "Production is green",
    blocking: true, priority: "high" as const, expiresAt: "2026-09-11T00:00:00.000Z", idempotencyKey: "decision-bound-1",
  };
  const first = await control.requestOwnerDecision(request);
  assert.equal((await control.requestOwnerDecision({ ...request })).id, first.id);

  const otherRun = control.startRun(agent.id, "Other work", "scope-b");
  for (const changed of [
    { ...request, runId: otherRun.id },
    { ...request, scopeId: "billing" },
    { ...request, question: "Rollback?" },
    { ...request, context: "Different context" },
    { ...request, blocking: false },
    { ...request, priority: "critical" as const },
    { ...request, expiresAt: "2026-09-12T00:00:00.000Z" },
  ]) {
    await assert.rejects(control.requestOwnerDecision(changed), new RegExp(IDEMPOTENCY_CONFLICT_MESSAGE));
  }

  assert.equal(store.escalations.size, 1);
  assert.equal(store.callAttempts.size, 1);
});

test("owner-callback idempotency key binds run and prompt while exact retries remain no-op", async () => {
  const { store, control, agent, run } = setup();
  const request = { runId: run.id, prompt: "Tell me deployment progress", idempotencyKey: "callback-bound-1" };
  const first = await control.requestOwnerCallback(request);
  assert.equal((await control.requestOwnerCallback({ ...request })).id, first.id);

  control.heartbeat(run.id, { summary: "Status changed after callback reservation", currentScope: "scope-c" });
  assert.equal((await control.requestOwnerCallback({ ...request })).id, first.id, "run status changes do not change the logical callback request");

  await assert.rejects(
    control.requestOwnerCallback({ ...request, prompt: "Tell me billing progress" }),
    new RegExp(IDEMPOTENCY_CONFLICT_MESSAGE),
  );
  const otherRun = control.startRun(agent.id, "Other work");
  await assert.rejects(
    control.requestOwnerCallback({ ...request, runId: otherRun.id }),
    new RegExp(IDEMPOTENCY_CONFLICT_MESSAGE),
  );

  assert.equal(store.callAttempts.size, 1);
  assert.ok(first.requestFingerprint);
  assert.equal(first.request.metadata.callbackRequestFingerprint, undefined, "binding stays local and is not provider metadata");
});

test("exact retries remain valid after a run is no longer running", async () => {
  const { store, control, run } = setup();
  const decisionRequest = { runId: run.id, scopeId: "deploy", question: "Deploy?", blocking: true, idempotencyKey: "stopped-decision" };
  const callbackRequest = { runId: run.id, prompt: "Progress?", idempotencyKey: "stopped-callback" };
  const decision = await control.requestOwnerDecision(decisionRequest);
  const callback = await control.requestOwnerCallback(callbackRequest);
  store.runs.set(run.id, { ...run, status: "completed", updatedAt: new Date().toISOString() });

  assert.equal((await control.requestOwnerDecision(decisionRequest)).id, decision.id);
  assert.equal((await control.requestOwnerCallback(callbackRequest)).id, callback.id);
  await assert.rejects(
    control.requestOwnerDecision({ ...decisionRequest, question: "Different?" }),
    new RegExp(IDEMPOTENCY_CONFLICT_MESSAGE),
  );
});

test("callback request binding survives SQLite restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-idempotency-binding-"));
  const filename = join(directory, "state.db");
  try {
    const provider = new FakeCallProvider();
    const firstStore = SqliteControlPlaneStore.open(filename);
    const first = new ControlPlane(firstStore, provider);
    const agent = first.registerAgent({ name: "durable-agent", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Working");
    const callback = await first.requestOwnerCallback({ runId: run.id, prompt: "Original prompt", idempotencyKey: "durable-callback-key" });
    assert.ok(callback.requestFingerprint);
    firstStore.close();

    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const reopened = new ControlPlane(reopenedStore, new FakeCallProvider());
    const replay = await reopened.requestOwnerCallback({ runId: run.id, prompt: "Original prompt", idempotencyKey: "durable-callback-key" });
    assert.equal(replay.id, callback.id);
    await assert.rejects(
      reopened.requestOwnerCallback({ runId: run.id, prompt: "Changed prompt", idempotencyKey: "durable-callback-key" }),
      new RegExp(IDEMPOTENCY_CONFLICT_MESSAGE),
    );
    assert.equal(reopenedStore.callAttempts.size, 1);
    reopenedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("HTTP returns a stable privacy-safe 409 for idempotency payload mismatch", async () => {
  const control = new ControlPlane(new InMemoryControlPlaneStore(), new FakeCallProvider());
  const server = createControlPlaneHttpServer(control, { apiToken: "test-secret" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  const agent = control.registerAgent({ name: "worker", platform: "test", ownerId: "owner" });
  const run = control.startRun(agent.id, "working");
  const otherRun = control.startRun(agent.id, "other");

  const post = (body: unknown) => fetch(`${base}/v1/escalations`, {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const firstBody = { runId: run.id, scopeId: "release", question: "Ship?", blocking: true, idempotencyKey: "http-bound-key" };
  assert.equal((await post(firstBody)).status, 201);
  const conflict = await post({ ...firstBody, runId: otherRun.id, question: "Different secret question" });
  assert.equal(conflict.status, 409);
  const body = await conflict.json() as { error: string };
  assert.deepEqual(body, { error: "idempotency_conflict" });
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(run.id), false);
  assert.equal(serialized.includes(otherRun.id), false);
  assert.equal(serialized.includes("Different secret question"), false);
});
