import { describe, expect, it } from "vitest";
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

describe("applyCheckpointAtRuntime", () => {
  it("returns queued instructions and consumes them only when requested", () => {
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
    expect(preview.queuedInstructions).toHaveLength(1);
    expect(preview.consumedInstructions).toHaveLength(0);
    expect(store.instructions.get("instruction-1")?.status).toBe("queued");

    const consumed = applyCheckpointAtRuntime(store, run, true, "2026-09-12T00:03:00.000Z");
    expect(consumed.consumedInstructions[0]).toMatchObject({ status: "consumed", consumedAt: "2026-09-12T00:03:00.000Z" });
    expect(store.instructions.get("instruction-1")?.status).toBe("consumed");
  });

  it("returns isolated snapshots and converges on a concurrent consumer", () => {
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

    expect(first.consumedInstructions[0].consumedAt).toBe("2026-09-12T00:02:00.000Z");
    expect(second.consumedInstructions[0].consumedAt).toBe("2026-09-12T00:02:00.000Z");
    first.consumedInstructions[0].text = "mutated outside";
    expect(store.instructions.get("instruction-1")?.text).toBe("Keep unrelated work running");
  });
});
