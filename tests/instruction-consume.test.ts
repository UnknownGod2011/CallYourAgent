import assert from "node:assert/strict";
import test from "node:test";
import { consumeInstructionIfQueued } from "../src/instruction-consume.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("consumeInstructionIfQueued consumes a queued instruction once and returns an isolated snapshot", () => {
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
    assert.equal(result.consumed, true);
    assert.equal(result.instruction.status, "consumed");
    assert.equal(result.instruction.consumedAt, "2026-09-12T00:01:00.000Z");

    result.instruction.text = "mutated outside the store";
    assert.equal(store.instructions.get("instruction-1")?.text, "Prioritize the failing test.");

    const replay = consumeInstructionIfQueued(store, "instruction-1", "2026-09-12T00:02:00.000Z");
    assert.equal(replay.consumed, false);
    assert.equal(replay.instruction.consumedAt, "2026-09-12T00:01:00.000Z");
});
