import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider, type StartCallInput } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("decision reconciliation cannot create a second local call while the first provider start is in flight", async () => {
  let signalStart!: () => void;
  let releaseStart!: () => void;
  const startEntered = new Promise<void>((resolve) => { signalStart = resolve; });
  const release = new Promise<void>((resolve) => { releaseStart = resolve; });

  class GatedProvider extends FakeCallProvider {
    starts = 0;

    override async start(input: StartCallInput) {
      this.starts += 1;
      signalStart();
      await release;
      return super.start(input);
    }
  }

  const store = new InMemoryControlPlaneStore();
  const provider = new GatedProvider();
  const control = new ControlPlane(store, provider);
  const agent = control.registerAgent({ name: "decision-concurrency-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Preparing a release", "documentation");

  const requestPromise = control.requestOwnerDecision({
    runId: run.id,
    scopeId: "release-approval",
    question: "Should this release go to production?",
    blocking: true,
    idempotencyKey: "decision-concurrent-1",
  });
  await startEntered;

  const reservedEscalation = [...store.escalations.values()][0]!;
  assert.equal(reservedEscalation.status, "calling");
  assert.ok(reservedEscalation.callAttemptId);
  assert.equal(store.callAttempts.size, 1);

  const reconciliationWhileStarting = await control.reconcileEscalation(reservedEscalation.id);
  assert.equal(reconciliationWhileStarting.id, reservedEscalation.id);
  assert.equal(reconciliationWhileStarting.callAttemptId, reservedEscalation.callAttemptId);
  assert.equal(provider.starts, 1);
  assert.equal(store.callAttempts.size, 1);
  assert.deepEqual(control.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);

  const beforeReleaseEvents = control.listAuditEvents(run.id);
  assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_created").length, 1);
  assert.equal(beforeReleaseEvents.filter((event) => event.type === "call_attempt_started").length, 0);

  releaseStart();
  const requested = await requestPromise;

  assert.equal(requested.id, reservedEscalation.id);
  assert.equal(requested.callAttemptId, reservedEscalation.callAttemptId);
  assert.equal(provider.starts, 1);
  assert.equal(store.callAttempts.size, 1);
  assert.ok(store.callAttempts.get(requested.callAttemptId!)?.providerCallId);

  const events = control.listAuditEvents(run.id);
  assert.equal(events.filter((event) => event.type === "escalation_created").length, 1);
  assert.equal(events.filter((event) => event.type === "call_attempt_created").length, 1);
  assert.equal(events.filter((event) => event.type === "call_attempt_started").length, 1);
});
