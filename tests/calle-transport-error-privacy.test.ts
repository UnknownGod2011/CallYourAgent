import assert from "node:assert/strict";
import test from "node:test";
import { CalleCallProvider } from "../src/calle-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("CALL-E transport exceptions are sanitized before durable call-attempt state", async () => {
  const secret = "secret-webhook-token-and-owner-phone-+15551234567";
  const fetchImpl = (async () => {
    throw new Error(`socket failure while sending ${secret}`);
  }) as typeof fetch;
  const provider = new CalleCallProvider({
    apiKey: "server-only-api-key",
    ownerPhone: "+15551234567",
    webhookUrl: `https://cya.example.invalid/webhooks/calle?token=${secret}`,
    fetchImpl,
  });
  const store = new InMemoryControlPlaneStore();
  const controlPlane = new ControlPlane(store, provider);
  const agent = controlPlane.registerAgent({ name: "privacy-test", platform: "custom", ownerId: "owner-1" });
  const run = controlPlane.startRun(agent.id, "Private active task", "implementation");

  const attempt = await controlPlane.requestOwnerCallback({
    runId: run.id,
    prompt: "Private owner steering prompt",
    idempotencyKey: "callback:transport-privacy",
  });

  assert.equal(attempt.status, "ambiguous");
  assert.equal(attempt.lastError, "CALL-E create transport failed");
  assert.equal(attempt.lastError?.includes(secret), false);
  assert.equal(attempt.lastError?.includes("+15551234567"), false);
  assert.equal(attempt.lastError?.includes("Private owner steering prompt"), false);
  assert.equal(controlPlane.getCallAttempt(attempt.id).lastError, "CALL-E create transport failed");
});

test("CALL-E polling transport exceptions are sanitized while preserving timeout classification", async () => {
  const secret = "private-provider-url-token";
  const failingFetch = (async () => {
    throw new Error(`network stack exposed ${secret}`);
  }) as typeof fetch;
  const provider = new CalleCallProvider({ apiKey: "key", ownerPhone: "+15550001111", fetchImpl: failingFetch });

  await assert.rejects(
    provider.observe("call-private"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "CALL-E get transport failed");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );

  const timeoutFetch = (async () => {
    const error = new Error(`timed out near ${secret}`);
    error.name = "TimeoutError";
    throw error;
  }) as typeof fetch;
  const timeoutProvider = new CalleCallProvider({ apiKey: "key", ownerPhone: "+15550001111", fetchImpl: timeoutFetch });

  await assert.rejects(
    timeoutProvider.observe("call-private"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.message, "CALL-E get timed out");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});
