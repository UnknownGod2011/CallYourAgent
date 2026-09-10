import assert from "node:assert/strict";
import test from "node:test";
import {
  FakeCallProvider,
  GENERIC_CALL_PROVIDER_ERROR,
  SafeCallProviderError,
  type StartCallInput,
  type StartCallResult,
} from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function setup(provider: FakeCallProvider) {
  const store = new InMemoryControlPlaneStore();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "privacy-agent", platform: "test", ownerId: "owner-privacy" });
  const run = control.startRun(agent.id, "Handling sensitive production work", "deploy");
  return { store, control, run };
}

test("custom provider exception text never reaches durable lastError during create or recovery", async () => {
  const secret = "phone=+15551234567 webhook_token=do-not-persist task=secret-production-deploy";

  class SecretBearingProvider extends FakeCallProvider {
    override async start(_input: StartCallInput): Promise<StartCallResult> {
      throw new Error(secret);
    }
  }

  const { store, control, run } = setup(new SecretBearingProvider());
  const callback = await control.requestOwnerCallback({
    runId: run.id,
    prompt: "Call me about the sensitive deployment",
    idempotencyKey: "privacy-callback-create",
  });

  assert.equal(callback.status, "ambiguous");
  assert.equal(callback.lastError, GENERIC_CALL_PROVIDER_ERROR);
  assert.equal(JSON.stringify(callback).includes(secret), false);
  assert.equal(JSON.stringify(callback).includes("+15551234567"), false);
  assert.equal(JSON.stringify(callback).includes("do-not-persist"), false);

  const recovered = await control.recoverCallAttempt(callback.id);
  assert.equal(recovered.status, "ambiguous");
  assert.equal(recovered.lastError, GENERIC_CALL_PROVIDER_ERROR);
  assert.equal(store.callAttempts.get(callback.id)?.lastError, GENERIC_CALL_PROVIDER_ERROR);
  assert.equal(JSON.stringify(store.callAttempts.get(callback.id)).includes(secret), false);
});

test("control plane preserves only explicitly marked persistence-safe provider diagnostics", async () => {
  class SanitizedProvider extends FakeCallProvider {
    override async start(_input: StartCallInput): Promise<StartCallResult> {
      throw new SafeCallProviderError("CALL-E create transport failed");
    }
  }

  const { store, control, run } = setup(new SanitizedProvider());
  const callback = await control.requestOwnerCallback({
    runId: run.id,
    prompt: "Status update",
    idempotencyKey: "privacy-callback-safe-diagnostic",
  });

  assert.equal(callback.status, "ambiguous");
  assert.equal(callback.lastError, "CALL-E create transport failed");
  assert.equal(store.callAttempts.get(callback.id)?.lastError, "CALL-E create transport failed");
});
