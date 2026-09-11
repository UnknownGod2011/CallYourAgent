import type { AgentRun } from "./domain.js";

export interface HeartbeatUpdate {
  summary?: string;
  currentScope?: string;
}

/**
 * Build the candidate heartbeat snapshot from an authoritative run snapshot.
 * The helper intentionally does not mutate the input and never changes the
 * branch-scoped lifecycle status; persistence/CAS remains the store's job.
 */
export function buildHeartbeatCandidate(
  current: AgentRun,
  update: HeartbeatUpdate,
  now: string,
): AgentRun {
  if (current.status !== "running") {
    throw new Error(`Run ${current.id} is not running`);
  }

  return {
    ...current,
    ...update,
    updatedAt: now,
  };
}
