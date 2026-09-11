import type { AgentRun } from "./domain.js";
import { buildHeartbeatCandidate, type HeartbeatUpdate } from "./heartbeat-mutation.js";
import type { ControlPlaneStore, RunMutationResult } from "./store.js";

export interface HeartbeatCommitResult extends RunMutationResult {
  audit: boolean;
}

/**
 * Commit one heartbeat against the store's authoritative snapshot.
 * The caller decides how to publish the audit event; rejected stale writes
 * explicitly return audit=false so they cannot report progress they did not win.
 */
export function commitHeartbeat(
  store: ControlPlaneStore,
  runId: string,
  expectedUpdatedAt: string,
  update: HeartbeatUpdate,
  now: string,
): HeartbeatCommitResult {
  const current = store.runs.get(runId);
  if (!current) throw new Error(`Unknown run: ${runId}`);
  const next = buildHeartbeatCandidate(current, update, now);
  const mutation = store.updateRunIfCurrent(runId, expectedUpdatedAt, next);
  return { ...mutation, audit: mutation.applied };
}

export function heartbeatAuditPayload(run: AgentRun, update: HeartbeatUpdate): {
  runId: string;
  agentId: string;
  currentScope?: string;
  summaryChanged: boolean;
} {
  return {
    runId: run.id,
    agentId: run.agentId,
    currentScope: run.currentScope,
    summaryChanged: update.summary !== undefined,
  };
}
