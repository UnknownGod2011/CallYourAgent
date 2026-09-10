import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERIC_CALL_PROVIDER_ERROR,
  SafeCallProviderError,
  providerSafeDiagnostic,
} from "../src/call-provider.js";

test("arbitrary provider exceptions are reduced to a generic durable diagnostic", () => {
  const secret = "owner=+15551234567 webhook_token=super-secret task=deploy-production";
  const diagnostic = providerSafeDiagnostic(new Error(secret));

  assert.equal(diagnostic, GENERIC_CALL_PROVIDER_ERROR);
  assert.equal(diagnostic.includes(secret), false);
  assert.equal(diagnostic.includes("+15551234567"), false);
  assert.equal(diagnostic.includes("super-secret"), false);
});

test("only explicitly marked provider diagnostics retain their message", () => {
  const diagnostic = providerSafeDiagnostic(new SafeCallProviderError("CALL-E create transport failed"));
  assert.equal(diagnostic, "CALL-E create transport failed");
});

test("non-Error throws are not reflected into the durable diagnostic", () => {
  assert.equal(providerSafeDiagnostic("token=do-not-persist"), GENERIC_CALL_PROVIDER_ERROR);
  assert.equal(providerSafeDiagnostic({ phone: "+15559876543" }), GENERIC_CALL_PROVIDER_ERROR);
});
