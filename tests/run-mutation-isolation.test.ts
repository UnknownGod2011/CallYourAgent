import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRun } from "../src/domain.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function fixture(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-isolation",
    agentId: "agent-1",
    status: "running",
    summary: "initial",
    currentScope: "planning",
    startedAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

test("conditional run mutation does not retain caller-owned object aliases", () => {
  const store = new InMemoryControlPlaneStore();
  const initial = fixture();
  store.runs.set(initial.id, initial);

  const next = fixture({
    summary: "implementation",
    currentScope: "coding",
    updatedAt: "2026-09-11T00:01:00.000Z",
  });
  const result = store.updateRunIfCurrent(initial.id, initial.updatedAt, next);
  assert.equal(result.applied, true);

  next.summary = "mutated after write";
  result.run.summary = "mutated from returned value";

  assert.deepEqual(store.runs.get(initial.id), fixture({
    summary: "implementation",
    currentScope: "coding",
    updatedAt: "2026-09-11T00:01:00.000Z",
  }));
});

test("stale conditional mutation returns an isolated authoritative winner", () => {
  const store = new InMemoryControlPlaneStore();
  const initial = fixture();
  store.runs.set(initial.id, initial);
  const winner = fixture({ updatedAt: "2026-09-11T00:01:00.000Z", summary: "winner" });
  store.updateRunIfCurrent(initial.id, initial.updatedAt, winner);

  const rejected = store.updateRunIfCurrent(
    initial.id,
    initial.updatedAt,
    fixture({ updatedAt: "2026-09-11T00:02:00.000Z", summary: "stale" }),
  );
  assert.equal(rejected.applied, false);
  rejected.run.summary = "caller mutation";

  assert.equal(store.runs.get(initial.id)?.summary, "winner");
});
