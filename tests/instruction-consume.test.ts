import { describe, expect, it } from "vitest";
import { consumeInstructionIfQueued } from "../src/instruction-consume.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

describe("consumeInstructionIfQueued", () => {
  it("consumes a queued instruction once and returns an isolated snapshot", () => {
    const store = new InMemoryControlPlaneStore();
    store.instructions.set("instruction-1", {
      id: "instruction-1",
      runId: "run-1",
      text: "Prioritize the failing test.",
      source: "api",
      status: "queued",
      createdAt: "2026-09-12T00:00:00.000Z",
    });

    const result = consumeInstructionIfQueued(store, "instruction-1", "2026-09-12T00:01:00.000Z");
    expect(result.consumed).toBe(true);
    expect(result.instruction.status).toBe("consumed");
    expect(result.instruction.consumedAt).toBe("2026-09-12T00:01:00.000Z");

    result.instruction.text = "mutated outside the store";
    expect(store.instructions.get("instruction-1")?.text).toBe("Prioritize the failing test.");

    const replay = consumeInstructionIfQueued(store, "instruction-1", "2026-09-12T00:02:00.000Z");
    expect(replay.consumed).toBe(false);
    expect(replay.instruction.consumedAt).toBe("2026-09-12T00:01:00.000Z");
  });
});
