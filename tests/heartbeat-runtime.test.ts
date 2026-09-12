import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRun } from "../src/domain.js";
import { applyHeartbeatAtRuntime } from "../src/heartbeat-runtime.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const run: AgentRun = {
  id: "run-runtime-1",
  agentId: "agent-1",
  status: "running",
  summary: "before",
  currentScope: "scope-a",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
};

test("applyHeartbeatAtRuntime exposes audit payload only for the committed writer", () => {
  const store = new InMemoryControlPlaneStore();
  store.runs.set(run.id, run);

  const first = applyHeartbeatAtRuntime(store, run, { summary: "winner" }, "2026-01-01T00:02:00.000Z");
  const stale = applyHeartbeatAtRuntime(store, run, { summary: "stale" }, "2026-01-01T00:03:00.000Z");

  assert.equal(first.applied, true);
  assert.equal(first.audit, true);
  assert.equal(first.auditPayload?.summaryChanged, true);
  assert.equal(stale.applied, false);
  assert.equal(stale.audit, false);
  assert.equal(stale.auditPayload, undefined);
  assert.equal(stale.run.summary, "winner");
});


test("applyHeartbeatAtRuntime keeps the caller snapshot immutable", () => {
  const store = new InMemoryControlPlaneStore();
  store.runs.set(run.id, run);
  const snapshot = structuredClone(run);

  applyHeartbeatAtRuntime(store, snapshot, { currentScope: "scope-b" }, "2026-01-01T00:02:00.000Z");

  assert.deepEqual(snapshot, run);
  assert.equal(store.runs.get(run.id)?.currentScope, "scope-b");
});
