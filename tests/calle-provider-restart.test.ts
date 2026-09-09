import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CalleCallProvider } from "../src/calle-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

function withDatabase<T>(run: (filename: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "cya-calle-restart-"));
  const filename = join(directory, "state.db");
  return Promise.resolve(run(filename)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("CALL-E callback reconciliation after restart polls durable remote call id without replaying create", async () => {
  await withDatabase(async (filename) => {
    const firstRequests: Array<{ method: string; url: string }> = [];
    const firstFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      firstRequests.push({ method, url });
      assert.equal(method, "POST");
      assert.equal(url, "https://call-e.test/v1/calls");
      return jsonResponse({
        id: "calle_call_restart_callback",
        status: "queued",
        structured_result: null,
      });
    };

    const firstStore = SqliteControlPlaneStore.open(filename);
    const firstProvider = new CalleCallProvider({
      apiKey: "server-secret",
      ownerPhone: "+15555550123",
      baseUrl: "https://call-e.test",
      fetchImpl: firstFetch,
    });
    const first = new ControlPlane(firstStore, firstProvider);
    const agent = first.registerAgent({ name: "calle-restart-worker", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Working on release", "documentation");
    const callback = await first.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "calle-restart-callback",
      prompt: "Any new steering?",
    });

    assert.equal(callback.status, "queued");
    assert.equal(callback.providerCallId, "calle_call_restart_callback");
    assert.deepEqual(firstRequests.map((request) => request.method), ["POST"]);
    firstStore.close();

    const restartedRequests: Array<{ method: string; url: string }> = [];
    const restartedFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      restartedRequests.push({ method, url });
      assert.equal(method, "GET", "restart reconciliation must not replay POST /v1/calls");
      assert.equal(url, "https://call-e.test/v1/calls/calle_call_restart_callback");
      return jsonResponse({
        id: "calle_call_restart_callback",
        status: "completed",
        structured_result: { instructions: ["Proceed with documentation, then prepare the release summary."] },
      });
    };

    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const restartedProvider = new CalleCallProvider({
      apiKey: "server-secret",
      ownerPhone: "+15555550123",
      baseUrl: "https://call-e.test",
      fetchImpl: restartedFetch,
    });
    const restarted = new ControlPlane(reopenedStore, restartedProvider);

    const completed = await restarted.reconcileCallback(callback.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerCallId, callback.providerCallId);
    assert.deepEqual(restartedRequests.map((request) => request.method), ["GET"]);

    const checkpoint = restarted.checkpoint(run.id);
    assert.equal(checkpoint.queuedInstructions.length, 1);
    assert.equal(checkpoint.queuedInstructions[0]?.text, "Proceed with documentation, then prepare the release summary.");

    await restarted.reconcileCallback(callback.id);
    assert.equal(restartedRequests.length, 1, "already-terminal callback retry should not hit CALL-E again");
    assert.equal(restarted.checkpoint(run.id).queuedInstructions.length, 1, "restart reconciliation must queue steering exactly once");
    reopenedStore.close();
  });
});

test("CALL-E decision reconciliation after restart polls remote state and releases only its blocked scope", async () => {
  await withDatabase(async (filename) => {
    let createCalls = 0;
    const firstFetch: typeof fetch = async (_input, init) => {
      assert.equal(init?.method, "POST");
      createCalls += 1;
      return jsonResponse({ id: "calle_call_restart_decision", status: "queued", structured_result: null });
    };

    const firstStore = SqliteControlPlaneStore.open(filename);
    const first = new ControlPlane(firstStore, new CalleCallProvider({
      apiKey: "server-secret",
      ownerPhone: "+15555550123",
      baseUrl: "https://call-e.test",
      fetchImpl: firstFetch,
    }));
    const agent = first.registerAgent({ name: "calle-decision-restart", platform: "test", ownerId: "owner-1" });
    const run = first.startRun(agent.id, "Continue documentation while approval is pending", "documentation");
    const escalation = await first.requestOwnerDecision({
      runId: run.id,
      scopeId: "release-approval",
      question: "Ship the release?",
      blocking: true,
      idempotencyKey: "calle-restart-decision",
    });

    assert.equal(createCalls, 1);
    assert.deepEqual(first.checkpoint(run.id).unresolvedBlockingScopes, ["release-approval"]);
    firstStore.close();

    let pollCalls = 0;
    const restartedFetch: typeof fetch = async (input, init) => {
      assert.equal(init?.method, "GET", "restart decision reconciliation must not recreate the call");
      assert.equal(String(input), "https://call-e.test/v1/calls/calle_call_restart_decision");
      pollCalls += 1;
      return jsonResponse({
        id: "calle_call_restart_decision",
        status: "completed",
        structured_result: { answer: "Yes, ship it after the documentation pass." },
      });
    };

    const reopenedStore = SqliteControlPlaneStore.open(filename);
    const restarted = new ControlPlane(reopenedStore, new CalleCallProvider({
      apiKey: "server-secret",
      ownerPhone: "+15555550123",
      baseUrl: "https://call-e.test",
      fetchImpl: restartedFetch,
    }));

    const resolved = await restarted.reconcileEscalation(escalation.id);
    assert.equal(resolved.status, "resolved");
    assert.equal(pollCalls, 1);
    assert.deepEqual(restarted.checkpoint(run.id).unresolvedBlockingScopes, []);
    assert.equal(restarted.getRun(run.id).currentScope, "documentation", "decision resolution must not disturb unrelated current work");
    assert.equal(restarted.getDecision(escalation.id)?.answer, "Yes, ship it after the documentation pass.");

    await restarted.reconcileEscalation(escalation.id);
    assert.equal(pollCalls, 1, "resolved escalation retry should not hit CALL-E again");
    assert.equal(reopenedStore.decisions.size, 1);
    reopenedStore.close();
  });
});
