import assert from "node:assert/strict";
import { test } from "node:test";
import { startOperatorDemoServer } from "../src/operator-demo.js";

test("operator demo exposes a separate owner callback credential without agent-write or reconciliation authority", async () => {
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

    const readCallback = await fetch(`${demo.baseUrl}/v1/callbacks`, {
      method: "POST",
      headers: readHeaders,
      body: JSON.stringify({
        runId: demo.fixture.runId,
        idempotencyKey: "read-token-cannot-callback",
      }),
    });
    assert.equal(readCallback.status, 403);

    const ownerCallback = await fetch(`${demo.baseUrl}/v1/callbacks`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        runId: demo.fixture.runId,
        idempotencyKey: "owner-token-callback",
        prompt: "Give me a concise progress briefing and capture any steering I provide.",
      }),
    });
    assert.equal(ownerCallback.status, 201, "owner token should have owner:callback");

    const checkpoint = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/checkpoint`,
      { method: "POST", headers: ownerHeaders, body: JSON.stringify({ consume: false }) },
    );
    assert.equal(checkpoint.status, 403, "owner token must not have agent:write");

    const reconcile = await fetch(
      `${demo.baseUrl}/v1/escalations/${encodeURIComponent(demo.fixture.blockingEscalationId)}/reconcile`,
      { method: "POST", headers: ownerHeaders, body: "{}" },
    );
    assert.equal(reconcile.status, 403, "owner token must not have calls:reconcile");
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
