import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRun } from "../src/domain.js";
import { commitHeartbeat, heartbeatAuditPayload } from "../src/heartbeat-commit.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const run: AgentRun = {
  id: "run-commit-1",
  agentId: "agent-1",
  status: "running",
  summary: "before",
  currentScope: "scope-a",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
};

test("commitHeartbeat audits only the CAS winner", () => {
  const store = new InMemoryControlPlaneStore();
  store.runs.set(run.id, run);

  const first = commitHeartbeat(store, run.id, run.updatedAt, { summary: "winner" }, "2026-01-01T00:02:00.000Z");
  const stale = commitHeartbeat(store, run.id, run.updatedAt, { summary: "stale" }, "2026-01-01T00:03:00.000Z");

  assert.equal(first.applied, true);
  assert.equal(first.audit, true);
  assert.equal(stale.applied, false);
  assert.equal(stale.audit, false);
  assert.equal(stale.run.summary, "winner");
  assert.equal(store.runs.get(run.id)?.summary, "winner");
});

test("heartbeatAuditPayload is derived from the committed snapshot", () => {
  assert.deepEqual(
    heartbeatAuditPayload({ ...run, summary: "after", updatedAt: "2026-01-01T00:02:00.000Z" }, { summary: "after" }),
    {
      runId: run.id,
      agentId: run.agentId,
      currentScope: run.currentScope,
      summaryChanged: true,
    },
  );
});
