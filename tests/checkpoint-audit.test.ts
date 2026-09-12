import assert from "node:assert/strict";
import test from "node:test";
import { checkpointInstructionAuditPayload } from "../src/checkpoint-audit.js";
import type { AgentRun, OwnerInstruction } from "../src/domain.js";

const run: AgentRun = {
  id: "run-1",
  agentId: "agent-1",
  status: "running",
  summary: "working",
  startedAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

const instruction = (id: string): OwnerInstruction => ({
  id,
  runId: run.id,
  text: `Do ${id}`,
  source: "callback",
  status: "consumed",
  createdAt: "2026-09-12T00:01:00.000Z",
  consumedAt: "2026-09-12T00:02:00.000Z",
});

test("checkpoint audit payload is omitted when no instruction is consumed", () => {
  assert.equal(checkpointInstructionAuditPayload(run, []), undefined);
});

test("checkpoint audit payload contains only committed instruction ids", () => {
  assert.deepEqual(checkpointInstructionAuditPayload(run, [instruction("i-1"), instruction("i-2")]), {
    runId: run.id,
    instructionIds: ["i-1", "i-2"],
    count: 2,
  });
});
