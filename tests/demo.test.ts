import assert from "node:assert/strict";
import { test } from "node:test";
import { runDeterministicDemo } from "../src/demo.js";

test("deterministic demo proves branch-safe escalation and callback checkpoint flow", async () => {
  const result = await runDeterministicDemo();

  assert.equal(result.unrelatedWorkContinued, true);
  assert.deepEqual(result.blockedScopesBeforeDecision, ["production-deploy"]);
  assert.deepEqual(result.blockedScopesAfterDecision, []);
  assert.equal(result.callbackIncludedCurrentStatus, true);
  assert.deepEqual(result.queuedInstructionTexts, [
    "Deploy only after the final smoke test.",
    "Send me the release summary after deployment.",
  ]);
  assert.equal(result.consumedInstructionCount, 2);
  assert.ok(result.auditEventTypes.includes("owner_decision_recorded"));
  assert.ok(result.auditEventTypes.includes("owner_instruction_consumed"));
});
