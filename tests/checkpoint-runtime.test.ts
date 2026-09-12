import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryControlPlaneStore } from "../src/store.js";
import { applyCheckpointAtRuntime } from "../src/checkpoint-runtime.js";

const run = {
  id: "run-1",
  agentId: "agent-1",
  status: "running" as const,
  summary: "working",
  startedAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

test("applyCheckpointAtRuntime returns queued instructions and consumes them only when requested", () => {
    const store = new InMemoryControlPlaneStore();
    store.runs.set(run.id, structuredClone(run));
    store.instructions.set("instruction-1", {
      id: "instruction-1",
      runId: run.id,
      text: "Use the safer rollout",
      source: "callback",
      status: "queued",
      createdAt: "2026-09-12T00:01:00.000Z",
    });

    const preview = applyCheckpointAtRuntime(store, run, false, "2026-09-12T00:02:00.000Z");
    assert.equal(preview.queuedInstructions.length, 1);
    assert.equal(preview.consumedInstructions.length, 0);
    assert.equal(store.instructions.get("instruction-1")?.status, "queued");

    const consumed = applyCheckpointAtRuntime(store, run, true, "2026-09-12T00:03:00.000Z");
    assert.deepEqual(consumed.consumedInstructions[0], {
      id: "instruction-1", runId: run.id, text: "Use the safer rollout", source: "callback", status: "consumed",
      createdAt: "2026-09-12T00:01:00.000Z", consumedAt: "2026-09-12T00:03:00.000Z",
    });
    assert.equal(store.instructions.get("instruction-1")?.status, "consumed");
});

test("applyCheckpointAtRuntime returns isolated snapshots and converges on a concurrent consumer", () => {
    const store = new InMemoryControlPlaneStore();
    store.runs.set(run.id, structuredClone(run));
    store.instructions.set("instruction-1", {
      id: "instruction-1",
      runId: run.id,
      text: "Keep unrelated work running",
      source: "api",
      status: "queued",
      createdAt: "2026-09-12T00:01:00.000Z",
    });

    const first = applyCheckpointAtRuntime(store, run, true, "2026-09-12T00:02:00.000Z");
    const second = applyCheckpointAtRuntime(store, run, true, "2026-09-12T00:04:00.000Z");

    assert.equal(first.consumedInstructions[0]?.consumedAt, "2026-09-12T00:02:00.000Z");
    assert.equal(second.consumedInstructions.length, 0);
    first.consumedInstructions[0].text = "mutated outside";
    assert.equal(store.instructions.get("instruction-1")?.text, "Keep unrelated work running");
});
