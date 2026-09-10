import assert from "node:assert/strict";
import test from "node:test";
import {
  FakeCallProvider,
  type CallProviderObservation,
  type RehydrateCallInput,
} from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { GENERIC_LIFECYCLE_ERROR, LifecycleManager } from "../src/lifecycle.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const SECRET = "owner=+919876543210 webhook=secret-token task=private-release-plan";

function createRun(provider: FakeCallProvider) {
  const store = new InMemoryControlPlaneStore();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "privacy-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Sensitive work", "release");
  return { store, control, run };
}

test("lifecycle sweep does not expose arbitrary provider observe errors", async () => {
  class ThrowingObserveProvider extends FakeCallProvider {
    override async observe(_providerCallId: string): Promise<CallProviderObservation> {
      throw new Error(`observe failed ${SECRET}`);
    }
  }

  const provider = new ThrowingObserveProvider();
  const { store, control, run } = createRun(provider);
  const callback = await control.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "observe-error-privacy",
    prompt: "Discuss sensitive release status",
  });
  assert.ok(callback.providerCallId);

  const result = await new LifecycleManager(control, store).sweep();

  assert.deepEqual(result.errors, [
    { kind: "callback", id: callback.id, message: GENERIC_LIFECYCLE_ERROR },
  ]);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(control.getCallAttempt(callback.id).status, "queued");
});

test("lifecycle sweep does not expose arbitrary provider rehydrate errors", async () => {
  class ThrowingRehydrateProvider extends FakeCallProvider {
    override rehydrate(_input: RehydrateCallInput): void {
      throw new Error(`rehydrate failed ${SECRET}`);
    }
  }

  const provider = new ThrowingRehydrateProvider();
  const { store, control, run } = createRun(provider);
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release",
    question: "Ship the private release?",
    blocking: true,
    idempotencyKey: "rehydrate-error-privacy",
  });
  assert.ok(escalation.callAttemptId);

  const result = await new LifecycleManager(control, store).sweep();

  assert.deepEqual(result.errors, [
    { kind: "escalation", id: escalation.id, message: GENERIC_LIFECYCLE_ERROR },
  ]);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release"]);
});
