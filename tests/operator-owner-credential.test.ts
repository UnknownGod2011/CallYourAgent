import assert from "node:assert/strict";
import { test } from "node:test";
import { startOperatorDemoServer } from "../src/operator-demo.js";

test("operator demo proves a fresh owner callback can queue and later consume steering without browser agent authority", async () => {
  const demo = await startOperatorDemoServer({
    port: 0,
    apiToken: "operator-read-token",
    ownerToken: "operator-owner-token",
  });
  const readHeaders = {
    authorization: `Bearer ${demo.apiToken}`,
    "content-type": "application/json",
  };
  const ownerHeaders = {
    authorization: `Bearer ${demo.ownerToken}`,
    "content-type": "application/json",
  };

  try {
    assert.notEqual(demo.apiToken, demo.ownerToken);

    const overviewUrl = `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/overview`;
    assert.equal((await fetch(overviewUrl, { headers: ownerHeaders })).status, 200);

    const readCapabilities = await fetch(`${demo.baseUrl}/v1/auth/capabilities`, { headers: readHeaders });
    assert.equal(readCapabilities.status, 200);
    assert.deepEqual((await readCapabilities.json() as { scopes: string[] }).scopes, ["agent:read", "audit:read"]);

    const ownerCapabilities = await fetch(`${demo.baseUrl}/v1/auth/capabilities`, { headers: ownerHeaders });
    assert.equal(ownerCapabilities.status, 200);
    assert.deepEqual(
      (await ownerCapabilities.json() as { scopes: string[] }).scopes,
      ["agent:read", "audit:read", "owner:callback"],
    );

    const readCallback = await fetch(`${demo.baseUrl}/v1/callbacks`, {
      method: "POST",
      headers: readHeaders,
      body: JSON.stringify({
        runId: demo.fixture.runId,
        idempotencyKey: "read-token-cannot-callback",
      }),
    });
    assert.equal(readCallback.status, 403);

    const advanced = await demo.advance();
    assert.equal(advanced.resumedScope, "production-deploy");
    assert.equal(advanced.queuedInstructionCount, 0);

    const ownerCallback = await fetch(`${demo.baseUrl}/v1/callbacks`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        runId: demo.fixture.runId,
        idempotencyKey: "owner-token-fresh-callback",
        prompt: "Give me a concise progress briefing and capture any steering I provide.",
      }),
    });
    assert.equal(ownerCallback.status, 201, "owner token should have owner:callback");
    const callback = await ownerCallback.json() as { id: string; runId: string; status: string; createdAt: string; updatedAt: string };
    assert.equal(callback.runId, demo.fixture.runId);
    assert.deepEqual(Object.keys(callback).sort(), ["createdAt", "id", "runId", "status", "updatedAt"]);
    const serializedCallback = JSON.stringify(callback);
    assert.doesNotMatch(serializedCallback, /production-deploy/);
    assert.doesNotMatch(serializedCallback, /concise progress briefing/);
    assert.doesNotMatch(serializedCallback, /request/);
    assert.doesNotMatch(serializedCallback, /providerCallId/);

    const callbackRead = await fetch(`${demo.baseUrl}/v1/callbacks/${encodeURIComponent(callback.id)}`, { headers: ownerHeaders });
    assert.equal(callbackRead.status, 200);
    assert.deepEqual(await callbackRead.json(), callback);

    const checkpoint = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/checkpoint`,
      { method: "POST", headers: ownerHeaders, body: JSON.stringify({ consume: false }) },
    );
    assert.equal(checkpoint.status, 403, "owner token must not have agent:write");

    const reconcile = await fetch(
      `${demo.baseUrl}/v1/callbacks/${encodeURIComponent(callback.id)}/reconcile`,
      { method: "POST", headers: ownerHeaders, body: "{}" },
    );
    assert.equal(reconcile.status, 403, "owner token must not have calls:reconcile");

    const completed = await demo.completeFreshOwnerCallback();
    assert.equal(completed.callbackId, callback.id, "trusted demo process must reconcile the exact browser-requested callback");
    assert.equal(completed.queuedInstructionCount, 1);
    assert.equal(completed.queuedInstructionIds.length, 1);

    const queuedOverviewResponse = await fetch(overviewUrl, { headers: ownerHeaders });
    assert.equal(queuedOverviewResponse.status, 200);
    const queuedOverview = await queuedOverviewResponse.json() as { queuedInstructionCount: number };
    assert.equal(queuedOverview.queuedInstructionCount, 1);
    assert.equal(JSON.stringify(queuedOverview).includes("Roll out to 25%"), false, "operator overview must not expose steering text");

    const consumed = await demo.consumeFreshOwnerSteering();
    assert.deepEqual(consumed.acknowledgedInstructionIds, completed.queuedInstructionIds);
    assert.equal(consumed.queuedInstructionCount, 0);

    const finalOverviewResponse = await fetch(overviewUrl, { headers: ownerHeaders });
    assert.equal(finalOverviewResponse.status, 200);
    assert.equal((await finalOverviewResponse.json() as { queuedInstructionCount: number }).queuedInstructionCount, 0);

    const auditResponse = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/audit?limit=250`,
      { headers: ownerHeaders },
    );
    assert.equal(auditResponse.status, 200);
    const audit = await auditResponse.json() as { events: Array<{ type: string; callAttemptId?: string; instructionId?: string }> };
    const freshCallbackRequested = audit.events.find((event) => event.type === "owner_callback_requested" && event.callAttemptId === callback.id);
    assert.ok(freshCallbackRequested, "fresh browser callback must appear in the durable audit timeline");
    const freshInstructionQueuedIndex = audit.events.findIndex((event) => event.type === "owner_instruction_queued" && event.instructionId === completed.queuedInstructionIds[0]);
    const freshInstructionConsumedIndex = audit.events.findIndex((event) => event.type === "owner_instruction_consumed" && event.instructionId === completed.queuedInstructionIds[0]);
    assert.ok(freshInstructionQueuedIndex >= 0);
    assert.ok(freshInstructionConsumedIndex > freshInstructionQueuedIndex, "fresh steering must be durable before safe-checkpoint acknowledgement");
  } finally {
    await demo.close();
  }
});

test("operator demo rejects accidental token reuse across read and owner roles", async () => {
  await assert.rejects(
    startOperatorDemoServer({ port: 0, apiToken: "same-token", ownerToken: "same-token" }),
    /read and owner tokens must be different/,
  );
});
