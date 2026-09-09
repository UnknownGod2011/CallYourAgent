import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import { createControlPlaneHttpServer } from "../src/http-server.js";
import { SqliteControlPlaneStore } from "../src/sqlite-store.js";

interface ToolResultLike {
  content?: unknown;
  isError?: boolean;
}

interface AuditEventLike {
  type: string;
  sequence: number;
  escalationId?: string;
  callAttemptId?: string;
}

function parseToolText(result: ToolResultLike): unknown {
  assert.ok(Array.isArray(result.content), "tool result must contain content");
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  assert.equal(first?.type, "text");
  assert.equal(typeof first?.text, "string");
  return JSON.parse(first!.text!);
}

async function closeServer(server: ReturnType<typeof createControlPlaneHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("real stdio MCP child preserves one decision-call audit chain across control-plane restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-mcp-stdio-audit-restart-"));
  const filename = join(directory, "state.db");
  const apiToken = "stdio-agent-secret";

  const firstStore = SqliteControlPlaneStore.open(filename);
  const firstProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
  const firstControlPlane = new ControlPlane(firstStore, firstProvider);
  let http = createControlPlaneHttpServer(firstControlPlane, { apiToken });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const childEnv: Record<string, string> = {
    CYA_BASE_URL: baseUrl,
    CYA_API_TOKEN: apiToken,
  };
  if (process.env.PATH) childEnv.PATH = process.env.PATH;
  if (process.env.HOME) childEnv.HOME = process.env.HOME;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/mcp-server.js"],
    cwd: process.cwd(),
    env: childEnv,
    stderr: "pipe",
  });
  const client = new Client({ name: "cya-stdio-audit-restart", version: "1.0.0" });

  let restartedStore: SqliteControlPlaneStore | undefined;

  try {
    await client.connect(transport);

    const agentResult = await client.callTool({
      name: "register_agent",
      arguments: { name: "stdio-restart-agent", platform: "claude-code", ownerId: "owner-1" },
    });
    assert.notEqual(agentResult.isError, true);
    const agent = parseToolText(agentResult) as { id: string };

    const runResult = await client.callTool({
      name: "start_run",
      arguments: {
        agentId: agent.id,
        summary: "Documentation continues while release approval is pending",
        currentScope: "documentation",
      },
    });
    assert.notEqual(runResult.isError, true);
    const run = parseToolText(runResult) as { id: string; currentScope?: string };
    assert.equal(run.currentScope, "documentation");

    const escalationResult = await client.callTool({
      name: "request_owner_decision",
      arguments: {
        runId: run.id,
        scopeId: "release-approval",
        question: "Proceed with the release?",
        context: "Documentation is independent and must continue while approval is pending.",
        blocking: true,
        priority: "high",
        idempotencyKey: "stdio-decision-call-audit-restart",
      },
    });
    assert.notEqual(escalationResult.isError, true);
    const escalation = parseToolText(escalationResult) as { id: string };

    const beforeRestartResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    assert.notEqual(beforeRestartResult.isError, true);
    const beforeRestart = parseToolText(beforeRestartResult) as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
    };
    assert.equal(beforeRestart.run.currentScope, "documentation");
    assert.deepEqual(beforeRestart.unresolvedBlockingScopes, ["release-approval"]);

    await closeServer(http);
    firstStore.close();

    restartedStore = SqliteControlPlaneStore.open(filename);
    const restartedProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const restartedControlPlane = new ControlPlane(restartedStore, restartedProvider);
    http = createControlPlaneHttpServer(restartedControlPlane, { apiToken });
    await new Promise<void>((resolve) => http.listen(port, "127.0.0.1", resolve));

    const lifecycleResult = await client.callTool({
      name: "get_escalation_lifecycle_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(lifecycleResult.isError, true);
    const lifecycle = parseToolText(lifecycleResult) as { status: string; callStatus?: string };
    assert.equal(lifecycle.status, "calling");
    assert.ok(lifecycle.callStatus === "queued" || lifecycle.callStatus === "in_progress");

    const afterRestartCheckpointResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    assert.notEqual(afterRestartCheckpointResult.isError, true);
    const afterRestartCheckpoint = parseToolText(afterRestartCheckpointResult) as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
    };
    assert.equal(afterRestartCheckpoint.run.currentScope, "documentation");
    assert.deepEqual(afterRestartCheckpoint.unresolvedBlockingScopes, ["release-approval"]);

    const resolved = await restartedControlPlane.reconcileEscalation(escalation.id);
    assert.equal(resolved.status, "resolved");
    const retried = await restartedControlPlane.reconcileEscalation(escalation.id);
    assert.equal(retried.status, "resolved");

    const decisionResult = await client.callTool({
      name: "get_escalation_status",
      arguments: { escalationId: escalation.id },
    });
    assert.notEqual(decisionResult.isError, true);
    const decisionState = parseToolText(decisionResult) as {
      escalation: { status: string };
      decision?: { answer?: string; structured?: Record<string, unknown> };
    };
    assert.equal(decisionState.escalation.status, "resolved");
    assert.equal(decisionState.decision?.answer, "Proceed with the requested scope.");
    assert.equal(decisionState.decision?.structured?.decision, "proceed");

    const releasedResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    assert.notEqual(releasedResult.isError, true);
    const released = parseToolText(releasedResult) as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
    };
    assert.equal(released.run.currentScope, "documentation");
    assert.deepEqual(released.unresolvedBlockingScopes, []);

    const auditResult = await client.callTool({
      name: "get_audit_timeline",
      arguments: { runId: run.id, limit: 100 },
    });
    assert.notEqual(auditResult.isError, true);
    const events = parseToolText(auditResult) as AuditEventLike[];
    const decisionEvents = events.filter(
      (event) => event.type === "owner_decision_recorded" && event.escalationId === escalation.id,
    );
    assert.equal(decisionEvents.length, 1, "restart/retry must record exactly one owner decision");
    const callAttemptId = decisionEvents[0]?.callAttemptId;
    assert.equal(typeof callAttemptId, "string");

    const callEvents = events.filter((event) => event.callAttemptId === callAttemptId);
    const created = callEvents.filter((event) => event.type === "call_attempt_created");
    const started = callEvents.filter((event) => event.type === "call_attempt_started");
    const completed = callEvents.filter((event) => event.type === "call_attempt_completed");

    assert.equal(created.length, 1, "same stdio-raised logical call must have one durable create event");
    assert.equal(started.length, 1, "provider rehydration must not emit another start event");
    assert.equal(completed.length, 1, "terminal reconciliation retry must not duplicate completion");
    assert.ok(created[0]!.sequence < started[0]!.sequence);
    assert.ok(started[0]!.sequence < completed[0]!.sequence);
    assert.equal(
      callEvents.filter((event) => event.type === "call_attempt_ambiguous" || event.type === "call_attempt_failed").length,
      0,
    );
  } finally {
    await client.close().catch(() => undefined);
    if (http.listening) await closeServer(http);
    if (restartedStore) restartedStore.close();
    else if (firstStore) firstStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
