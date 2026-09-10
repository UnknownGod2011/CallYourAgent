import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleSweepErrorSummary } from "../src/server.js";

test("runtime lifecycle error summary omits ids and arbitrary secret-bearing messages", () => {
  const secret = "webhook-token-owner-phone-+15551234567-private-task";
  const summary = lifecycleSweepErrorSummary({
    errors: [
      { kind: "escalation", id: "secret-escalation-id", message: `provider leaked ${secret}` },
      { kind: "callback", id: "secret-callback-id", message: `network leaked ${secret}` },
      { kind: "callback", id: "another-secret-callback-id", message: "another private failure" },
    ],
  });

  assert.deepEqual(summary, { total: 3, escalations: 1, callbacks: 2 });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("secret-escalation-id"), false);
  assert.equal(serialized.includes("secret-callback-id"), false);
  assert.equal(serialized.includes("private failure"), false);
});
