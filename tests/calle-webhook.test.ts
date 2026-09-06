import assert from "node:assert/strict";
import test from "node:test";
import { parseCalleTerminalWebhook } from "../src/calle-webhook.js";

test("parses completed CALL-E decision webhook", () => {
  const parsed = parseCalleTerminalWebhook({
    id: "evt_123",
    type: "call.completed",
    data: {
      id: "call_123",
      status: "completed",
      structured_result: { answer: "Proceed with the deploy" },
      summary: "Owner approved the deploy.",
    },
  });

  assert.deepEqual(parsed, {
    eventId: "evt_123",
    providerCallId: "call_123",
    outcome: {
      status: "completed",
      providerCallId: "call_123",
      answer: "Proceed with the deploy",
      instructions: undefined,
      structured: { answer: "Proceed with the deploy" },
    },
  });
});

test("parses completed CALL-E callback instructions and ignores non-terminal events", () => {
  const parsed = parseCalleTerminalWebhook({
    id: "evt_456",
    data: {
      id: "call_456",
      status: "completed",
      structured_result: { instructions: ["Run the migration", 42, "Then deploy"] },
    },
  });

  assert.deepEqual(parsed?.outcome.instructions, ["Run the migration", "Then deploy"]);
  assert.equal(parseCalleTerminalWebhook({ id: "evt_queued", data: { id: "call_x", status: "queued" } }), null);
});

test("maps CALL-E failed/canceled terminal webhooks to failed outcomes", () => {
  const parsed = parseCalleTerminalWebhook({
    id: "evt_failed",
    data: {
      id: "call_failed",
      status: "failed",
      structured_result: null,
      failure_code: "provider_error",
      failure_message: "Carrier unavailable",
    },
  });

  assert.equal(parsed?.outcome.status, "failed");
  assert.deepEqual(parsed?.outcome.structured, {
    failureCode: "provider_error",
    failureMessage: "Carrier unavailable",
  });
});
