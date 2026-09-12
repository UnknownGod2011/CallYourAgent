import type { AgentRun } from "./domain.js";
import { commitHeartbeat, heartbeatAuditPayload, type HeartbeatCommitResult } from "./heartbeat-commit.js";
import type { ControlPlaneStore } from "./store.js";

export interface HeartbeatRuntimeResult extends HeartbeatCommitResult {
  auditPayload?: ReturnType<typeof heartbeatAuditPayload>;
}

/**
 * Runtime-facing heartbeat operation for adapters and future ControlPlane wiring.
 * The expectedUpdatedAt token is captured by the caller from its last durable
 * run snapshot; stale writers converge on the authoritative winner and do not
 * produce an audit payload.
 */
export function applyHeartbeatAtRuntime(
  store: ControlPlaneStore,
  run: AgentRun,
  update: { summary?: string; currentScope?: string },
  now: string,
): HeartbeatRuntimeResult {
  const result = commitHeartbeat(store, run.id, run.updatedAt, update, now);
  return result.audit
    ? { ...result, auditPayload: heartbeatAuditPayload(result.run, update) }
    : result;
}
