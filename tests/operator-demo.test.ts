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

test("operator demo launcher exposes only a least-privilege browser credential over HTTP", async () => {
  const demo = await startOperatorDemoServer({ port: 0, apiToken: "operator-http-acceptance-token" });
  const authorization = { authorization: `Bearer ${demo.apiToken}` };
  const jsonHeaders = { ...authorization, "content-type": "application/json" };

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

    const authenticated = await fetch(overviewUrl, { headers: authorization });
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

    const auditResponse = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/audit`,
      { headers: authorization },
    );
    assert.equal(auditResponse.status, 200, "browser token should retain audit:read");

    const checkpointResponse = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/checkpoint`,
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ consume: false }) },
    );
    assert.equal(checkpointResponse.status, 403, "browser token must not have agent:write");

    const acknowledgeResponse = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/instructions/ack`,
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ instructionIds: [] }) },
    );
    assert.equal(acknowledgeResponse.status, 403, "browser token must not acknowledge steering");

    const reconcileResponse = await fetch(
      `${demo.baseUrl}/v1/escalations/${encodeURIComponent(demo.fixture.blockingEscalationId)}/reconcile`,
      { method: "POST", headers: jsonHeaders, body: "{}" },
    );
    assert.equal(reconcileResponse.status, 403, "browser token must not have calls:reconcile");

    const callbackResponse = await fetch(`${demo.baseUrl}/v1/callbacks`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        runId: demo.fixture.runId,
        idempotencyKey: "browser-must-not-call-owner",
      }),
    });
    assert.equal(callbackResponse.status, 403, "browser token must not have owner:callback");

    const advanced = await demo.advance();
    const advancedAgain = await demo.advance();
    assert.deepEqual(advancedAgain, advanced, "repeated demo advance requests should share one deterministic transition");
    assert.equal(advanced.resumedScope, "production-deploy");
    assert.deepEqual(advanced.unresolvedBlockingScopes, []);
    assert.equal(advanced.queuedInstructionCount, 0);

    const finalOverviewResponse = await fetch(overviewUrl, { headers: authorization });
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
