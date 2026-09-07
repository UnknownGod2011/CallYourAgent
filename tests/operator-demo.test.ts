import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { seedOperatorDemoFixture } from "../src/operator-demo.js";
import { getRunOverview } from "../src/run-overview.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

async function makeFixture() {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const fixture = await seedOperatorDemoFixture(controlPlane, provider);
  return { controlPlane, fixture };
}

test("operator demo fixture reproduces branch-safe privacy-safe state using real control-plane semantics", async () => {
  const first = await makeFixture();
  const second = await makeFixture();

  for (const current of [first, second]) {
    const overview = getRunOverview(current.controlPlane, current.fixture.runId);
    assert.equal(overview.run.currentScope, "documentation");
    assert.deepEqual(overview.unresolvedBlockingScopes, ["production-deploy"]);
    assert.equal(overview.queuedInstructionCount, 1);
    assert.equal(current.fixture.duplicateEscalationDeduped, true);
    assert.equal(current.fixture.duplicateCallbackDeduped, true);

    const serialized = JSON.stringify(overview);
    assert.equal(serialized.includes("Keep production deploy paused"), false);
    assert.equal(serialized.includes("queuedInstructions"), false);

    const checkpoint = current.controlPlane.checkpoint(current.fixture.runId, false);
    assert.deepEqual(
      checkpoint.queuedInstructions.map((instruction) => instruction.text),
      ["Keep production deploy paused until the final validation report is ready."],
    );
    assert.deepEqual(checkpoint.unresolvedBlockingScopes, ["production-deploy"]);
  }

  assert.deepEqual(
    {
      activeScope: first.fixture.activeScope,
      blockedScopes: first.fixture.unresolvedBlockingScopes,
      queuedInstructionCount: first.fixture.queuedInstructionCount,
    },
    {
      activeScope: second.fixture.activeScope,
      blockedScopes: second.fixture.unresolvedBlockingScopes,
      queuedInstructionCount: second.fixture.queuedInstructionCount,
    },
    "fresh demo launches should reproduce the same semantic state",
  );
});
