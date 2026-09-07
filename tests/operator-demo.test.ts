import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import {
  advanceOperatorDemoFixture,
  seedOperatorDemoFixture,
  startOperatorDemoServer,
} from "../src/operator-demo.js";
import { getRunOverview } from "../src/run-overview.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

async function makeFixture() {
  const provider = new FakeCallProvider();
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), provider);
  const fixture = await seedOperatorDemoFixture(controlPlane, provider);
  return { controlPlane, provider, fixture };
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

test("operator demo advance resolves only the blocked branch and acknowledges exact steering ids at a safe checkpoint", async () => {
  const current = await makeFixture();
  const before = current.controlPlane.checkpoint(current.fixture.runId, false);
  const instructionIds = before.queuedInstructions.map((instruction) => instruction.id);

  const advanced = await advanceOperatorDemoFixture(
    current.controlPlane,
    current.provider,
    current.fixture,
  );

  assert.equal(advanced.decisionAnswer, "Approved. Proceed once final validation is complete.");
  assert.equal(advanced.resumedScope, "production-deploy");
  assert.deepEqual(advanced.unresolvedBlockingScopes, []);
  assert.deepEqual(advanced.acknowledgedInstructionIds, instructionIds);
  assert.equal(advanced.queuedInstructionCount, 0);

  const after = current.controlPlane.checkpoint(current.fixture.runId, false);
  assert.deepEqual(after.unresolvedBlockingScopes, []);
  assert.deepEqual(after.queuedInstructions, []);

  const timeline = current.controlPlane.listAuditEvents(current.fixture.runId);
  const eventTypes = timeline.map((event) => event.type);
  assert.ok(eventTypes.includes("owner_decision_recorded"));
  assert.ok(eventTypes.includes("owner_instruction_consumed"));
  assert.ok(eventTypes.lastIndexOf("owner_instruction_consumed") > eventTypes.indexOf("owner_instruction_queued"));
});

test("operator demo launcher proves the judge-facing state through the authenticated HTTP boundary", async () => {
  const demo = await startOperatorDemoServer({ port: 0, apiToken: "operator-http-acceptance-token" });

  try {
    const pageResponse = await fetch(demo.operatorUrl);
    assert.equal(pageResponse.status, 200);
    assert.equal(pageResponse.headers.get("cache-control"), "no-store");
    const pageHtml = await pageResponse.text();
    assert.match(pageHtml, /Active scope/);
    assert.match(pageHtml, /Blocked scopes/);
    assert.match(pageHtml, /Pending steering/);
    assert.equal(pageHtml.includes("Keep production deploy paused"), false);
    assert.equal(pageHtml.includes(demo.apiToken), false);

    const overviewUrl = `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/overview`;
    const unauthenticated = await fetch(overviewUrl);
    assert.equal(unauthenticated.status, 401);

    const authenticated = await fetch(overviewUrl, {
      headers: { authorization: `Bearer ${demo.apiToken}` },
    });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.headers.get("cache-control"), "no-store");
    const overview = await authenticated.json() as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
      queuedInstructionCount: number;
    };
    assert.equal(overview.run.currentScope, "documentation");
    assert.deepEqual(overview.unresolvedBlockingScopes, ["production-deploy"]);
    assert.equal(overview.queuedInstructionCount, 1);

    const serializedOverview = JSON.stringify(overview);
    assert.equal(serializedOverview.includes("Keep production deploy paused"), false);
    assert.equal(serializedOverview.includes("queuedInstructions"), false);

    const checkpointResponse = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/checkpoint`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${demo.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ consume: false }),
      },
    );
    assert.equal(checkpointResponse.status, 200);
    const checkpoint = await checkpointResponse.json() as {
      unresolvedBlockingScopes: string[];
      queuedInstructions: Array<{ text: string }>;
    };
    assert.deepEqual(checkpoint.unresolvedBlockingScopes, ["production-deploy"]);
    assert.deepEqual(
      checkpoint.queuedInstructions.map((instruction) => instruction.text),
      ["Keep production deploy paused until the final validation report is ready."],
      "steering should remain durable for the agent checkpoint even though the operator overview hides it",
    );

    const advanced = await demo.advance();
    const advancedAgain = await demo.advance();
    assert.deepEqual(advancedAgain, advanced, "repeated demo advance requests should share one deterministic transition");
    assert.equal(advanced.resumedScope, "production-deploy");
    assert.deepEqual(advanced.unresolvedBlockingScopes, []);
    assert.equal(advanced.queuedInstructionCount, 0);

    const finalOverviewResponse = await fetch(overviewUrl, {
      headers: { authorization: `Bearer ${demo.apiToken}` },
    });
    assert.equal(finalOverviewResponse.status, 200);
    const finalOverview = await finalOverviewResponse.json() as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
      queuedInstructionCount: number;
    };
    assert.equal(finalOverview.run.currentScope, "production-deploy");
    assert.deepEqual(finalOverview.unresolvedBlockingScopes, []);
    assert.equal(finalOverview.queuedInstructionCount, 0);
  } finally {
    await demo.close();
  }
});
