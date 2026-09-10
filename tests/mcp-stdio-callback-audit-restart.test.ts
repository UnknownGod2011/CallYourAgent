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
  callAttemptId?: string;
  instructionId?: string;
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

test("long-lived stdio MCP observes restart-recovered owner callback and consumes steering safely", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cya-mcp-stdio-callback-restart-"));
  const filename = join(directory, "state.db");
  const apiToken = "stdio-callback-agent-secret";

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
  const client = new Client({ name: "cya-stdio-callback-restart", version: "1.0.0" });

  let restartedStore: SqliteControlPlaneStore | undefined;

  try {
    await client.connect(transport);

    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "get_callback_status"));

    const agentResult = await client.callTool({
      name: "register_agent",
      arguments: { name: "stdio-callback-agent", platform: "claude-code", ownerId: "owner-1" },
    });
    assert.notEqual(agentResult.isError, true);
    const agent = parseToolText(agentResult) as { id: string };

    const runResult = await client.callTool({
      name: "start_run",
      arguments: {
        agentId: agent.id,
        summary: "Continuing documentation while the owner may call for progress",
        currentScope: "documentation",
      },
    });
    assert.notEqual(runResult.isError, true);
    const run = parseToolText(runResult) as { id: string; currentScope?: string };
    assert.equal(run.currentScope, "documentation");

    // The owner-facing surface is separate from the agent/MCP adapter. Create the callback
    // through the shared control-plane service so this test does not imply an agent initiates it.
    const callback = await firstControlPlane.requestOwnerCallback({
      runId: run.id,
      idempotencyKey: "stdio-owner-callback-restart",
      prompt: "Tell me current progress and capture one steering instruction.",
    });
    assert.ok(callback.status === "queued" || callback.status === "in_progress");

    const callbackBeforeRestartResult = await client.callTool({
      name: "get_callback_status",
      arguments: { callbackId: callback.id },
    });
    assert.notEqual(callbackBeforeRestartResult.isError, true);
    const callbackBeforeRestart = parseToolText(callbackBeforeRestartResult) as {
      id: string;
      runId: string;
      status: string;
    };
    assert.equal(callbackBeforeRestart.id, callback.id);
    assert.equal(callbackBeforeRestart.runId, run.id);
    assert.ok(callbackBeforeRestart.status === "queued" || callbackBeforeRestart.status === "in_progress");

    const checkpointBeforeRestartResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    assert.notEqual(checkpointBeforeRestartResult.isError, true);
    const checkpointBeforeRestart = parseToolText(checkpointBeforeRestartResult) as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
      queuedInstructions: unknown[];
    };
    assert.equal(checkpointBeforeRestart.run.currentScope, "documentation");
    assert.deepEqual(checkpointBeforeRestart.unresolvedBlockingScopes, []);
    assert.deepEqual(checkpointBeforeRestart.queuedInstructions, []);

    const eventsBeforeRestart = firstControlPlane.listAuditEvents(run.id)
      .filter((event) => event.callAttemptId === callback.id);
    assert.equal(eventsBeforeRestart.filter((event) => event.type === "call_attempt_created").length, 1);
    assert.equal(eventsBeforeRestart.filter((event) => event.type === "call_attempt_started").length, 1);
    assert.equal(eventsBeforeRestart.filter((event) => event.type === "owner_callback_requested").length, 1);
    assert.equal(eventsBeforeRestart.filter((event) => event.type === "call_attempt_completed").length, 0);
    assert.equal(eventsBeforeRestart.filter((event) => event.type === "owner_instruction_queued").length, 0);

    await closeServer(http);
    firstStore.close();

    restartedStore = SqliteControlPlaneStore.open(filename);
    const restartedProvider = new FakeCallProvider({ autoCompleteAfterObservations: 1 });
    const restartedControlPlane = new ControlPlane(restartedStore, restartedProvider);
    http = createControlPlaneHttpServer(restartedControlPlane, { apiToken });
    await new Promise<void>((resolve) => http.listen(port, "127.0.0.1", resolve));

    // The same stdio child/client remains connected while only the HTTP control plane/store/provider restart.
    const callbackAfterRestartResult = await client.callTool({
      name: "get_callback_status",
      arguments: { callbackId: callback.id },
    });
    assert.notEqual(callbackAfterRestartResult.isError, true);
    const callbackAfterRestart = parseToolText(callbackAfterRestartResult) as {
      id: string;
      runId: string;
      status: string;
    };
    assert.equal(callbackAfterRestart.id, callback.id);
    assert.equal(callbackAfterRestart.runId, run.id);
    assert.ok(callbackAfterRestart.status === "queued" || callbackAfterRestart.status === "in_progress");

    const completed = await restartedControlPlane.reconcileCallback(callback.id);
    assert.equal(completed.status, "completed");
    const retried = await restartedControlPlane.reconcileCallback(callback.id);
    assert.equal(retried.status, "completed");

    const callbackCompletedResult = await client.callTool({
      name: "get_callback_status",
      arguments: { callbackId: callback.id },
    });
    assert.notEqual(callbackCompletedResult.isError, true);
    const callbackCompleted = parseToolText(callbackCompletedResult) as { id: string; status: string };
    assert.equal(callbackCompleted.id, callback.id);
    assert.equal(callbackCompleted.status, "completed");

    const checkpointResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    assert.notEqual(checkpointResult.isError, true);
    const checkpoint = parseToolText(checkpointResult) as {
      run: { currentScope?: string };
      unresolvedBlockingScopes: string[];
      queuedInstructions: Array<{ id: string; text: string; status: string }>;
    };
    assert.equal(checkpoint.run.currentScope, "documentation");
    assert.deepEqual(checkpoint.unresolvedBlockingScopes, []);
    assert.equal(checkpoint.queuedInstructions.length, 1);
    const instruction = checkpoint.queuedInstructions[0]!;
    assert.equal(instruction.status, "queued");
    assert.equal(instruction.text, "Continue the current plan and report progress at the next safe checkpoint.");

    const ackResult = await client.callTool({
      name: "acknowledge_owner_instructions",
      arguments: { runId: run.id, instructionIds: [instruction.id] },
    });
    assert.notEqual(ackResult.isError, true);
    const acknowledged = parseToolText(ackResult) as Array<{ id: string; status: string }>;
    assert.deepEqual(acknowledged.map((item) => item.id), [instruction.id]);
    assert.equal(acknowledged[0]?.status, "consumed");

    const repeatedAckResult = await client.callTool({
      name: "acknowledge_owner_instructions",
      arguments: { runId: run.id, instructionIds: [instruction.id] },
    });
    assert.notEqual(repeatedAckResult.isError, true);
    const repeatedAck = parseToolText(repeatedAckResult) as Array<{ id: string; status: string }>;
    assert.deepEqual(repeatedAck.map((item) => item.id), [instruction.id]);
    assert.equal(repeatedAck[0]?.status, "consumed");

    const finalCheckpointResult = await client.callTool({
      name: "checkpoint",
      arguments: { runId: run.id, consume: false },
    });
    assert.notEqual(finalCheckpointResult.isError, true);
    const finalCheckpoint = parseToolText(finalCheckpointResult) as {
      queuedInstructions: unknown[];
      unresolvedBlockingScopes: string[];
    };
    assert.deepEqual(finalCheckpoint.queuedInstructions, []);
    assert.deepEqual(finalCheckpoint.unresolvedBlockingScopes, []);

    const auditResult = await client.callTool({
      name: "get_audit_timeline",
      arguments: { runId: run.id, limit: 100 },
    });
    assert.notEqual(auditResult.isError, true);
    const events = parseToolText(auditResult) as AuditEventLike[];
    const callbackEvents = events.filter((event) => event.callAttemptId === callback.id);
    const created = callbackEvents.filter((event) => event.type === "call_attempt_created");
    const started = callbackEvents.filter((event) => event.type === "call_attempt_started");
    const requested = callbackEvents.filter((event) => event.type === "owner_callback_requested");
    const completedEvents = callbackEvents.filter((event) => event.type === "call_attempt_completed");
    const queued = callbackEvents.filter((event) => event.type === "owner_instruction_queued");
    const consumed = events.filter(
      (event) => event.type === "owner_instruction_consumed" && event.instructionId === instruction.id,
    );

    assert.equal(created.length, 1, "callback must have exactly one durable create event");
    assert.equal(started.length, 1, "provider rehydration must not emit another callback start event");
    assert.equal(requested.length, 1, "owner callback request must remain exactly-once across restart");
    assert.equal(completedEvents.length, 1, "terminal reconciliation retry must not duplicate completion");
    assert.equal(queued.length, 1, "terminal reconciliation retry must not duplicate queued steering");
    assert.equal(consumed.length, 1, "repeated exact acknowledgement must not duplicate consumption");
    assert.equal(queued[0]?.instructionId, instruction.id);
    assert.equal(consumed[0]?.instructionId, instruction.id);

    assert.ok(created[0]!.sequence < requested[0]!.sequence);
    assert.ok(requested[0]!.sequence < started[0]!.sequence);
    assert.ok(started[0]!.sequence < completedEvents[0]!.sequence);
    assert.ok(completedEvents[0]!.sequence < queued[0]!.sequence);
    assert.ok(queued[0]!.sequence < consumed[0]!.sequence);

    assert.equal(
      callbackEvents.filter(
        (event) => event.type === "call_attempt_ambiguous" || event.type === "call_attempt_failed",
      ).length,
      0,
      "successful restart recovery must not fabricate ambiguous or failed callback state",
    );

    const serialized = JSON.stringify(callbackEvents);
    assert.equal(serialized.includes("Tell me current progress and capture one steering instruction."), false);
    assert.equal(
      serialized.includes("Continue the current plan and report progress at the next safe checkpoint."),
      false,
    );
  } finally {
    await client.close().catch(() => undefined);
    if (http.listening) await closeServer(http);
    if (restartedStore) restartedStore.close();
    else firstStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
