import assert from "node:assert/strict";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import type { AgentRun } from "../src/domain.js";
import { InMemoryControlPlaneStore, type RunMutationResult } from "../src/store.js";

class ContendedRunStore extends InMemoryControlPlaneStore {
  override updateRunIfCurrent(runId: string, expectedUpdatedAt: string, next: AgentRun): RunMutationResult {
    const winner: AgentRun = {
      ...next,
      status: "paused",
      summary: "A newer worker paused this run",
      currentScope: "approval",
      updatedAt: "2026-09-12T00:01:00.000Z",
    };
    this.runs.set(runId, winner);
    return { run: structuredClone(winner), applied: false };
  }
}

test("heartbeat returns the authoritative CAS winner without publishing stale progress", () => {
  const store = new ContendedRunStore();
  const control = new ControlPlane(store, new FakeCallProvider());
  const agent = control.registerAgent({ name: "heartbeat-race", platform: "test", ownerId: "owner-1" });
  const run = control.startRun(agent.id, "Initial work", "implementation");

  const result = control.heartbeat(run.id, {
    summary: "Stale worker progress",
    currentScope: "stale-scope",
  });

  assert.deepEqual(result, {
    ...run,
    status: "paused",
    summary: "A newer worker paused this run",
    currentScope: "approval",
    updatedAt: "2026-09-12T00:01:00.000Z",
  });
  assert.deepEqual(store.runs.get(run.id), result);
  assert.equal(control.listAuditEvents(run.id).filter((event) => event.type === "run_status_reported").length, 0);
});
