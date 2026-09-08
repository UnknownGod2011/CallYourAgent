import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";
import { startRuntimeFromEnv } from "../src/server.js";

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CYA_API_TOKEN: "test-token",
    CYA_CALL_PROVIDER: "fake",
    CYA_STORE: "memory",
    CYA_LIFECYCLE_SWEEP_INTERVAL_MS: "60000",
    PORT: "0",
    ...overrides,
  };
}

test("runtime starts on an ephemeral port and shutdown is idempotent", async () => {
  const runtime = await startRuntimeFromEnv(baseEnv());
  assert.ok(runtime.port > 0);
  assert.equal(runtime.server.listening, true);

  const health = await fetch(`http://127.0.0.1:${runtime.port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  await Promise.all([runtime.shutdown(), runtime.shutdown()]);
  assert.equal(runtime.server.listening, false);
});

test("runtime wires fake auto completion from a validated fake-only environment setting", async () => {
  const runtime = await startRuntimeFromEnv(baseEnv({ CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS: "1" }));
  try {
    assert.ok(runtime.provider instanceof FakeCallProvider);
    const started = await runtime.provider.start({
      idempotencyKey: "runtime-fake-auto-complete",
      purpose: "owner_callback",
      task: "Call owner",
      metadata: {},
    });
    const observation = await runtime.provider.observe(started.providerCallId);
    assert.equal(observation.status, "completed");
  } finally {
    await runtime.shutdown();
  }
});

test("fake auto completion environment setting rejects invalid values", async () => {
  await assert.rejects(
    startRuntimeFromEnv(baseEnv({ CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS: "0" })),
    /CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS must be a positive integer/,
  );
});

test("fake auto completion setting cannot leak into live CALL-E mode", async () => {
  await assert.rejects(
    startRuntimeFromEnv(baseEnv({
      CYA_CALL_PROVIDER: "calle",
      CYA_FAKE_AUTO_COMPLETE_AFTER_OBSERVATIONS: "1",
    })),
    /only valid when CYA_CALL_PROVIDER=fake/,
  );
});

test("graceful shutdown closes the durable SQLite store after HTTP drains", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-runtime-"));
  const databasePath = join(directory, "state.db");
  try {
    const runtime = await startRuntimeFromEnv(baseEnv({ CYA_STORE: "sqlite", CYA_SQLITE_PATH: databasePath }));
    assert.ok(runtime.store instanceof SqliteControlPlaneStore);

    const agent = runtime.controlPlane.registerAgent({ name: "worker", platform: "test", ownerId: "owner-1" });
    runtime.controlPlane.startRun(agent.id, "working");

    await runtime.shutdown();
    assert.equal(runtime.server.listening, false);
    assert.throws(() => runtime.store.transaction(() => undefined));

    // Resource ownership is idempotent even after the SQLite handle is already closed.
    await runtime.shutdown();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsupported store mode fails before creating a runtime", async () => {
  await assert.rejects(
    startRuntimeFromEnv(baseEnv({ CYA_STORE: "postgres" })),
    /Unsupported CYA_STORE: postgres/,
  );
});
