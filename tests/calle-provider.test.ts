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
  assert.ok(capturedInit?.signal instanceof AbortSignal);
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

test("CALL-E create HTTP errors never copy provider response bodies into application errors", async () => {
  const apiKey = "super-secret-api-key";
  const ownerPhone = "+15551234567";
  const webhookUrl = "https://cya.example.invalid/webhooks/calle?token=secret-webhook-token";
  const task = "Private owner-decision context that must not reach logs";
  const echoedBody = JSON.stringify({ apiKey, ownerPhone, webhookUrl, task });
  const fetchImpl = (async () => new Response(echoedBody, {
    status: 400,
    headers: { "x-request-id": "req_safe-123" },
  })) as typeof fetch;
  const provider = new CalleCallProvider({ apiKey, ownerPhone, webhookUrl, fetchImpl });

  await assert.rejects(
    provider.start({
      idempotencyKey: "decision:redaction",
      purpose: "owner_decision",
      task,
      metadata: { runId: "run_private" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "CALL-E create failed (400) [request-id: req_safe-123]");
      for (const secret of [apiKey, ownerPhone, webhookUrl, task, "secret-webhook-token"]) {
        assert.equal(error.message.includes(secret), false);
      }
      return true;
    },
  );
});

test("CALL-E get HTTP errors ignore unsafe request ids and provider response bodies", async () => {
  const echoedSensitiveBody = "owner phone +15557654321 and private callback transcript";
  const fetchImpl = (async () => new Response(echoedSensitiveBody, {
    status: 503,
    headers: { "x-request-id": "unsafe request id with spaces" },
  })) as typeof fetch;
  const provider = new CalleCallProvider({
    apiKey: "another-secret-key",
    ownerPhone: "+15557654321",
    fetchImpl,
  });

  await assert.rejects(
    provider.getOutcome("call_private"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "CALL-E get failed (503)");
      assert.equal(error.message.includes(echoedSensitiveBody), false);
      assert.equal(error.message.includes("+15557654321"), false);
      return true;
    },
  );
});

test("CALL-E provider aborts a hung create request at the configured deadline", async () => {
  const fetchImpl = hangingFetch();
  const provider = new CalleCallProvider({
    apiKey: "key",
    ownerPhone: "TEST_OWNER_PHONE",
    fetchImpl,
    requestTimeoutMs: 10,
  });

  await assert.rejects(
    provider.start({
      idempotencyKey: "decision:timeout",
      purpose: "owner_decision",
      task: "Ask the owner.",
      metadata: { runId: "run_timeout" },
    }),
    (error: unknown) => error instanceof Error && error.name === "TimeoutError",
  );
});

test("CALL-E provider aborts a hung reconciliation request at the configured deadline", async () => {
  const fetchImpl = hangingFetch();
  const provider = new CalleCallProvider({
    apiKey: "key",
    ownerPhone: "TEST_OWNER_PHONE",
    fetchImpl,
    requestTimeoutMs: 10,
  });

  await assert.rejects(
    provider.getOutcome("call_hung"),
    (error: unknown) => error instanceof Error && error.name === "TimeoutError",
  );
});

test("CALL-E provider rejects invalid request timeout configuration", () => {
  assert.throws(
    () => new CalleCallProvider({ apiKey: "key", ownerPhone: "TEST_OWNER_PHONE", requestTimeoutMs: 0 }),
    /request timeout must be a positive integer/,
  );
});

function hangingFetch(): typeof fetch {
  return ((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("expected abort signal"));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })) as typeof fetch;
}
