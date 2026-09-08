import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { toOwnerCallbackView } from "../src/callback-view.js";
import { ControlPlane } from "../src/control-plane.js";
import { getRunOverview } from "../src/run-overview.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("in-progress owner callback stays privacy-safe across callback view, overview, audit, and completion", async () => {
  const store = new InMemoryControlPlaneStore();
  const provider = new FakeCallProvider({ initialStatus: "in_progress" });
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "progress-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Preparing release candidate", "release-validation");

  const callback = await control.requestOwnerCallback({
    runId: run.id,
    idempotencyKey: "callback-in-progress-1",
    prompt: "Tell me whether the release validation is still healthy",
  });

  assert.equal(callback.status, "in_progress");
  assert.ok(callback.providerCallId);

  const ownerView = toOwnerCallbackView(callback);
  assert.deepEqual(Object.keys(ownerView).sort(), ["createdAt", "id", "runId", "status", "updatedAt"]);
  assert.equal(ownerView.status, "in_progress");
  assert.equal(ownerView.runId, run.id);

  const overview = getRunOverview(control, run.id);
  assert.equal(overview.latestOwnerCallback?.id, callback.id);
  assert.equal(overview.latestOwnerCallback?.status, "in_progress");
  assert.equal(overview.queuedInstructionCount, 0);
  assert.equal(JSON.stringify(overview).includes("Tell me whether the release validation is still healthy"), false);
  assert.equal(JSON.stringify(overview).includes("release-validation"), true);
  assert.equal(JSON.stringify(overview).includes("providerCallId"), false);

  const audit = control.listAuditEvents(run.id, 100);
  const started = audit.find((event) => event.type === "call_attempt_started" && event.callAttemptId === callback.id);
  assert.ok(started);
  assert.equal(started.details?.status, "in_progress");
  const serializedAudit = JSON.stringify(audit);
  assert.equal(serializedAudit.includes("Tell me whether the release validation is still healthy"), false);
  assert.equal(serializedAudit.includes("Current agent status"), false);

  provider.complete(callback.providerCallId!, {
    status: "completed",
    instructions: ["Keep validating; do not deploy until the smoke suite is green"],
  });
  const completed = await control.reconcileCallback(callback.id);

  assert.equal(completed.status, "completed");
  const completedOverview = getRunOverview(control, run.id);
  assert.equal(completedOverview.latestOwnerCallback?.status, "completed");
  assert.equal(completedOverview.queuedInstructionCount, 1);
  assert.equal(JSON.stringify(completedOverview).includes("Keep validating"), false);
});

test("in-progress fake-provider idempotency retries preserve the same accepted call", async () => {
  const provider = new FakeCallProvider({ initialStatus: "in_progress" });
  const input = {
    idempotencyKey: "same-in-progress-call",
    purpose: "owner_callback" as const,
    task: "Call the owner",
    metadata: { runId: "run-1" },
  };

  const first = await provider.start(input);
  const retry = await provider.start(input);

  assert.deepEqual(first, retry);
  assert.equal(first.status, "in_progress");
});
