import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlPlane } from "../src/control-plane.js";
import { FakeCallProvider } from "../src/call-provider.js";
import { getRunOverview } from "../src/run-overview.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("run overview exposes blocking scopes and queued count without owner instruction text", async () => {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const agent = controlPlane.registerAgent({ name: "worker", platform: "test", ownerId: "owner-1" });
  const run = controlPlane.startRun(agent.id, "Working independently", "implementation");

  await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "production-deploy",
    question: "Approve deployment?",
    blocking: true,
    idempotencyKey: "overview-blocking",
  });
  await controlPlane.requestOwnerDecision({
    runId: run.id,
    scopeId: "docs",
    question: "Which title do you prefer?",
    blocking: false,
    idempotencyKey: "overview-nonblocking",
  });

  controlPlane.enqueueInstruction(run.id, "Use the safer rollback strategy", "api");
  controlPlane.enqueueInstruction(run.id, "Keep unrelated tests running", "api");

  const overview = getRunOverview(controlPlane, run.id);
  assert.equal(overview.run.id, run.id);
  assert.equal(overview.run.currentScope, "implementation");
  assert.deepEqual(overview.unresolvedBlockingScopes, ["production-deploy"]);
  assert.equal(overview.queuedInstructionCount, 2);

  const serialized = JSON.stringify(overview);
  assert.doesNotMatch(serialized, /safer rollback strategy/);
  assert.doesNotMatch(serialized, /unrelated tests running/);

  const checkpoint = controlPlane.checkpoint(run.id);
  assert.equal(checkpoint.queuedInstructions.length, 2);
  assert.ok(checkpoint.queuedInstructions.every((instruction) => instruction.status === "queued"));
});
