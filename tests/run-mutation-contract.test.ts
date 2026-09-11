import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentRun } from "../src/domain.js";
import { InMemoryControlPlaneStore } from "../src/store.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function runFixture(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    agentId: "agent-1",
    status: "running",
    summary: "initial",
    currentScope: "planning",
    startedAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

function verifyConditionalMutation(store: InMemoryControlPlaneStore | SqliteControlPlaneStore): void {
  const original = runFixture();
  store.runs.set(original.id, original);

  const first = runFixture({
    summary: "newer summary",
    currentScope: "implementation",
    updatedAt: "2026-09-11T00:01:00.000Z",
  });
  const applied = store.updateRunIfCurrent(original.id, original.updatedAt, first);
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.run, first);
  assert.deepEqual(store.runs.get(original.id), first);

  const stale = runFixture({
    summary: "stale summary",
    currentScope: "stale-scope",
    updatedAt: "2026-09-11T00:02:00.000Z",
  });
  const rejected = store.updateRunIfCurrent(original.id, original.updatedAt, stale);
  assert.equal(rejected.applied, false);
  assert.deepEqual(rejected.run, first);
  assert.deepEqual(store.runs.get(original.id), first);

  assert.throws(() => store.transaction(() => {
    const current = store.runs.get(original.id)!;
    const next = runFixture({
      summary: "rolled back",
      currentScope: "rollback",
      updatedAt: "2026-09-11T00:03:00.000Z",
    });
    assert.equal(store.updateRunIfCurrent(original.id, current.updatedAt, next).applied, true);
    throw new Error("rollback run mutation");
  }), /rollback run mutation/);
  assert.deepEqual(store.runs.get(original.id), first);
}

test("in-memory conditional run mutation is first-writer-wins and rollback-safe", () => {
  verifyConditionalMutation(new InMemoryControlPlaneStore());
});

test("SQLite conditional run mutation is authoritative across reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-run-mutation-"));
  const databasePath = join(directory, "state.db");
  try {
    const store = SqliteControlPlaneStore.open(databasePath);
    verifyConditionalMutation(store);
    store.close();

    const reopened = SqliteControlPlaneStore.open(databasePath);
    try {
      assert.deepEqual(reopened.runs.get("run-1"), runFixture({
        summary: "newer summary",
        currentScope: "implementation",
        updatedAt: "2026-09-11T00:01:00.000Z",
      }));
    } finally {
      reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
