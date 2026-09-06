import assert from "node:assert/strict";
import test from "node:test";
import { CalleCallProvider } from "../src/calle-provider.js";

test("CALL-E provider sends idempotency, recipient, metadata, and decision schema", async () => {
  let capturedInit: RequestInit | undefined;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify({ id: "call_123", status: "queued", structured_result: null }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const provider = new CalleCallProvider({
    apiKey: "test-key",
    ownerPhone: "TEST_OWNER_PHONE",
    webhookUrl: "https://example.invalid/calle/webhook",
    fetchImpl,
  });

  const result = await provider.start({
    idempotencyKey: "decision:abc",
    purpose: "owner_decision",
    task: "Ask the owner whether to deploy.",
    metadata: { runId: "run_1", escalationId: "esc_1" },
  });

  assert.deepEqual(result, { providerCallId: "call_123", status: "queued" });
  assert.equal(new Headers(capturedInit?.headers).get("idempotency-key"), "decision:abc");
  const body = JSON.parse(String(capturedInit?.body));
  assert.deepEqual(body.recipients, [{ phones: ["TEST_OWNER_PHONE"] }]);
  assert.deepEqual(body.metadata, { runId: "run_1", escalationId: "esc_1" });
  assert.deepEqual(body.result_schema.required, ["answer"]);
  assert.equal(body.result_schema.additionalProperties, false);
});

test("CALL-E provider maps decision and callback terminal results", async () => {
  let requestCount = 0;
  const fetchImpl = (async () => {
    requestCount += 1;
    const payload = requestCount === 1
      ? { id: "call_decision", status: "completed", structured_result: { answer: "Deploy after tests pass" } }
      : { id: "call_callback", status: "completed", structured_result: { instructions: ["Finish tests first", "Then wire MCP"] } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const provider = new CalleCallProvider({ apiKey: "key", ownerPhone: "TEST_OWNER_PHONE", fetchImpl });
  const decision = await provider.getOutcome("call_decision");
  const callback = await provider.getOutcome("call_callback");
  assert.equal(decision?.answer, "Deploy after tests pass");
  assert.deepEqual(callback?.instructions, ["Finish tests first", "Then wire MCP"]);
});

test("CALL-E provider returns null while active and maps terminal failure", async () => {
  let requestCount = 0;
  const fetchImpl = (async () => {
    requestCount += 1;
    const payload = requestCount === 1
      ? { id: "call_active", status: "in_progress", structured_result: null }
      : { id: "call_failed", status: "failed", structured_result: null, failure_code: "unreachable", failure_message: "Could not reach recipient" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const provider = new CalleCallProvider({ apiKey: "key", ownerPhone: "TEST_OWNER_PHONE", fetchImpl });
  assert.equal(await provider.getOutcome("call_active"), null);
  const failed = await provider.getOutcome("call_failed");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.structured?.failureCode, "unreachable");
});
