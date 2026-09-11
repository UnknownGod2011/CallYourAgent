import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

test("heartbeat reports progress without disturbing unrelated run fields", () => {
  const store = new InMemoryControlPlaneStore();
  const control = new ControlPlane(store, new FakeCallProvider());
  const agent = control.registerAgent({ name: "heartbeat-contract-agent", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Initial work", "implementation");

  const next = control.heartbeat(run.id, { summary: "Implemented checkpoint handling" });

  assert.equal(next.id, run.id);
  assert.equal(next.status, "running");
  assert.equal(next.summary, "Implemented checkpoint handling");
  assert.equal(next.currentScope, "implementation");
  assert.equal(next.startedAt, run.startedAt);
  assert.notEqual(next.updatedAt, run.updatedAt);

  const progressEvents = control.listAuditEvents(run.id).filter((event) => event.type === "run_status_reported");
  assert.equal(progressEvents.length, 1);
  assert.deepEqual(progressEvents[0]?.details, {
    currentScope: "implementation",
    summaryChanged: true,
  });
});
