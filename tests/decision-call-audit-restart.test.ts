import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function withDatabase<T>(run: (filename: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-decision-audit-restart-"));
  const filename = join(directory, "state.db");
  return Promise.resolve(run(filename)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test("decision call keeps one exact created-started-completed audit chain across restart and reconciliation retry", async () => {
  await withDatabase(async (filename) => {
    const firstStore = SqliteControlPlaneStore.open(filename);
    const firstProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const first = new ControlPlane(firstStore, firstProvider);
    const agent = first.registerAgent({ name: "restart-agent", platform: "mcp", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Documentation continues while release approval is pending", "documentation");

    const escalation = await first.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Proceed with the release?",
      context: "Documentation is independent and must continue while owner approval is pending.",
      blocking: true,
      priority: "high",
      idempotencyKey: "decision-call-audit-restart",
    });

    assert.equal(escalation.status, "calling");
    assert.ok(escalation.callAttemptId);
    const callAttemptId = escalation.callAttemptId;

    const beforeRestart = first.listAuditEvents(run.id);
    assert.equal(
      beforeRestart.filter((event) => event.callAttemptId === callAttemptId && event.type === "call_attempt_created").length,
      1,
    );
    assert.equal(
      beforeRestart.filter((event) => event.callAttemptId === callAttemptId && event.type === "call_attempt_started").length,
      1,
    );
    assert.equal(
      beforeRestart.filter((event) => event.callAttemptId === callAttemptId && event.type === "call_attempt_completed").length,
      0,
    );

    const blocked = first.checkpoint(run.id);
    assert.equal(blocked.run.currentScope, "documentation");
    assert.deepEqual(blocked.unresolvedBlockingScopes, ["release-approval"]);
    firstStore.close();

    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const restartedProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const restarted = new ControlPlane(reopenedStore, restartedProvider);

    const resolved = await restarted.reconcileEscalation(escalation.id);
    assert.equal(resolved.status, "resolved");
    const retry = await restarted.reconcileEscalation(escalation.id);
    assert.equal(retry.status, "resolved");

    const afterRestart = restarted.listAuditEvents(run.id);
    const callEvents = afterRestart.filter((event) => event.callAttemptId === callAttemptId);
    const created = callEvents.filter((event) => event.type === "call_attempt_created");
    const started = callEvents.filter((event) => event.type === "call_attempt_started");
    const completed = callEvents.filter((event) => event.type === "call_attempt_completed");

    assert.equal(created.length, 1, "restart/retry must not create a second durable call attempt");
    assert.equal(started.length, 1, "fake-provider rehydration must not masquerade as another provider start");
    assert.equal(completed.length, 1, "terminal reconciliation must be recorded exactly once");
    assert.ok(created[0]!.sequence < started[0]!.sequence);
    assert.ok(started[0]!.sequence < completed[0]!.sequence);
    assert.equal(
      callEvents.filter((event) => event.type === "call_attempt_ambiguous" || event.type === "call_attempt_failed").length,
      0,
    );
    assert.equal(
      afterRestart.filter((event) => event.type === "owner_decision_recorded" && event.escalationId === escalation.id).length,
      1,
      "reconciliation retry must not duplicate the durable owner decision",
    );

    const released = restarted.checkpoint(run.id);
    assert.equal(released.run.currentScope, "documentation");
    assert.deepEqual(released.unresolvedBlockingScopes, []);
    reopenedStore.close();
  });
});
