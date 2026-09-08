import assert from "node:assert/strict";
import { test } from "node:test";
import { startOperatorDemoServer } from "../src/operator-demo.js";

interface OverviewResponse {
  queuedInstructionCount: number;
  latestOwnerCallback: {
    id: string;
    status: "queued" | "in_progress" | "completed" | "failed" | "ambiguous" | "stalled";
    createdAt: string;
    updatedAt: string;
  } | null;
}

test("operator HTTP overview tracks a fresh callback from queued to completed without exposing steering", async () => {
  const demo = await startOperatorDemoServer({
    port: 0,
    apiToken: "callback-lifecycle-read-token",
    ownerToken: "callback-lifecycle-owner-token",
  });
  const ownerHeaders = {
    authorization: `Bearer ${demo.ownerToken}`,
    "content-type": "application/json",
  };
  const overviewUrl = `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/overview`;

  try {
    await demo.advance();

    const callbackResponse = await fetch(`${demo.baseUrl}/v1/callbacks`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        runId: demo.fixture.runId,
        idempotencyKey: "operator-callback-lifecycle-http",
        prompt: "Give me a progress briefing and capture one steering instruction.",
      }),
    });
    assert.equal(callbackResponse.status, 201);
    const callback = await callbackResponse.json() as { id: string; status: string };
    assert.equal(callback.status, "queued", "deterministic fake provider should expose its real queued start state");

    const queuedResponse = await fetch(overviewUrl, { headers: ownerHeaders });
    assert.equal(queuedResponse.status, 200);
    const queued = await queuedResponse.json() as OverviewResponse;
    assert.deepEqual(queued.latestOwnerCallback && {
      id: queued.latestOwnerCallback.id,
      status: queued.latestOwnerCallback.status,
    }, {
      id: callback.id,
      status: "queued",
    });
    assert.equal(queued.queuedInstructionCount, 0);
    const queuedSerialized = JSON.stringify(queued);
    assert.equal(queuedSerialized.includes("Give me a progress briefing"), false);
    assert.equal(queuedSerialized.includes("Roll out to 25%"), false);

    const completed = await demo.completeFreshOwnerCallback();
    assert.equal(completed.callbackId, callback.id);
    assert.equal(completed.queuedInstructionCount, 1);
    assert.equal(completed.queuedInstructionIds.length, 1);

    const completedResponse = await fetch(overviewUrl, { headers: ownerHeaders });
    assert.equal(completedResponse.status, 200);
    const completedOverview = await completedResponse.json() as OverviewResponse;
    assert.deepEqual(completedOverview.latestOwnerCallback && {
      id: completedOverview.latestOwnerCallback.id,
      status: completedOverview.latestOwnerCallback.status,
    }, {
      id: callback.id,
      status: "completed",
    });
    assert.equal(completedOverview.queuedInstructionCount, 1, "completed callback must queue steering before the safe checkpoint acknowledgement");
    assert.equal(JSON.stringify(completedOverview).includes("Roll out to 25%"), false, "privacy-safe overview must never expose callback steering text");

    const consumed = await demo.consumeFreshOwnerSteering();
    assert.deepEqual(consumed.acknowledgedInstructionIds, completed.queuedInstructionIds);
    assert.equal(consumed.queuedInstructionCount, 0);

    const acknowledgedResponse = await fetch(overviewUrl, { headers: ownerHeaders });
    assert.equal(acknowledgedResponse.status, 200);
    const acknowledged = await acknowledgedResponse.json() as OverviewResponse;
    assert.equal(acknowledged.latestOwnerCallback?.id, callback.id);
    assert.equal(acknowledged.latestOwnerCallback?.status, "completed", "instruction acknowledgement must not rewrite provider call history");
    assert.equal(acknowledged.queuedInstructionCount, 0);

    const auditResponse = await fetch(
      `${demo.baseUrl}/v1/runs/${encodeURIComponent(demo.fixture.runId)}/audit?limit=250`,
      { headers: ownerHeaders },
    );
    assert.equal(auditResponse.status, 200);
    const audit = await auditResponse.json() as {
      events: Array<{ type: string; callAttemptId?: string; instructionId?: string; sequence: number }>;
    };
    const callbackRequested = audit.events.find(
      (event) => event.type === "owner_callback_requested" && event.callAttemptId === callback.id,
    );
    const callCompleted = audit.events.find(
      (event) => event.type === "call_attempt_completed" && event.callAttemptId === callback.id,
    );
    const queuedInstruction = audit.events.find(
      (event) => event.type === "owner_instruction_queued" && event.instructionId === completed.queuedInstructionIds[0],
    );
    const consumedInstruction = audit.events.find(
      (event) => event.type === "owner_instruction_consumed" && event.instructionId === completed.queuedInstructionIds[0],
    );
    assert.ok(callbackRequested);
    assert.ok(callCompleted);
    assert.ok(queuedInstruction);
    assert.ok(consumedInstruction);
    assert.ok(callbackRequested.sequence < callCompleted.sequence);
    assert.ok(callCompleted.sequence < queuedInstruction.sequence);
    assert.ok(queuedInstruction.sequence < consumedInstruction.sequence);
  } finally {
    await demo.close();
  }
});
