import assert from "node:assert/strict";
import test from "node:test";
import { buildHeartbeatCandidate } from "../src/heartbeat-mutation.js";
import type { AgentRun } from "../src/domain.js";

const runningRun: AgentRun = {
  id: "run-1",
  agentId: "agent-1",
  status: "running",
  summary: "old summary",
  currentScope: "scope-a",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
};

test("buildHeartbeatCandidate preserves lifecycle and does not mutate the source", () => {
  const candidate = buildHeartbeatCandidate(runningRun, { summary: "new summary" }, "2026-01-01T00:02:00.000Z");
  assert.deepEqual(candidate, {
    ...runningRun,
    summary: "new summary",
    updatedAt: "2026-01-01T00:02:00.000Z",
  });
  assert.equal(runningRun.summary, "old summary");
  assert.equal(runningRun.updatedAt, "2026-01-01T00:01:00.000Z");
});

test("buildHeartbeatCandidate rejects terminal or paused runs", () => {
  for (const status of ["paused", "completed", "failed"] as const) {
    assert.throws(
      () => buildHeartbeatCandidate({ ...runningRun, status }, {}, "2026-01-01T00:02:00.000Z"),
      new RegExp(`Run ${runningRun.id} is not running`),
    );
  }
});
