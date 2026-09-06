import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

function setup() {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "demo-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Building the application", "backend");
  return { store, provider, control, run };
}

test("non-blocking escalation lets unrelated work continue and resolves into a decision", async () => {
  const { store, provider, control, run } = setup();
  const escalation = await control.requestOwnerDecision({
    runId: run.id,
    scopeId: "pricing-copy",
    question: "Use the concise or detailed pricing copy?",
    blocking: false,
    idempotencyKey: "decision-1",
  });

  const checkpointWhileCalling = control.checkpoint(run.id);
  assert.deepEqual(checkpointWhileCalling.unresolvedBlockingScopes, []);

  const attempt = store.callAttempts.get(escalation.callAttemptId!)!;
  provider.complete(attempt.providerCallId!, { status: "completed", answer: "Use concise copy", structured: { choice: "concise" } });
  const resolved = await control.reconcileEscalation(escalation.id);

  assert.equal(resolved.status, "resolved");
  assert.equal(control.getDecision(escalation.id)?.structured?.choice, "concise");
});

test("blocking escalation blocks only its scope and idempotent retries do not create calls", async () => {
  const { store, control, run } = setup();
  const request = {
    runId: run.id,
    scopeId: "production-deploy",
    question: "Deploy to production?",
    blocking: true,
    idempotencyKey: "deploy-approval-1",
  } as const;

  const first = await control.requestOwnerDecision(request);
  const retry = await control.requestOwnerDecision(request);

  assert.equal(first.id, retry.id);
  assert.equal(store.callAttempts.size, 1);
  assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["production-deploy"]);
});

test("owner-requested callback receives current status and queues instructions for safe checkpoint consumption", async () => {
  const { store, provider, control, run } = setup();
  control.heartbeat(run.id, { summary: "Backend finished; validating adapters", currentScope: "integration" });

  const callback = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "callback-1" });
  provider.complete(callback.providerCallId!, {
    status: "completed",
    instructions: ["Prioritize Claude integration", "Do not spend time on dashboard polish"],
  });
  await control.reconcileCallback(callback.id);

  const beforeConsume = control.checkpoint(run.id);
  assert.deepEqual(beforeConsume.queuedInstructions.map((item) => item.text), [
    "Prioritize Claude integration",
    "Do not spend time on dashboard polish",
  ]);

  control.checkpoint(run.id, true);
  assert.equal(control.checkpoint(run.id).queuedInstructions.length, 0);
  assert.equal([...store.instructions.values()].every((item) => item.status === "consumed"), true);
});

test("callback idempotency prevents duplicate phone side effects", async () => {
  const { store, control, run } = setup();
  const first = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "same-callback" });
  const retry = await control.requestOwnerCallback({ runId: run.id, idempotencyKey: "same-callback" });
  assert.equal(first.id, retry.id);
  assert.equal(store.callAttempts.size, 1);
});
