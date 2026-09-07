import type { AgentRun } from "./domain.js";
import type { ControlPlane } from "./control-plane.js";

/**
 * Privacy-preserving read model for operators and host adapters.
 *
 * This intentionally exposes only the count of queued owner instructions, never
 * their text. It also reports unresolved blocking scopes without consuming or
 * acknowledging any instruction state.
 */
export interface RunOverview {
  run: AgentRun;
  unresolvedBlockingScopes: string[];
  queuedInstructionCount: number;
}

export function getRunOverview(controlPlane: ControlPlane, runId: string): RunOverview {
  const checkpoint = controlPlane.checkpoint(runId, false);
  return {
    run: checkpoint.run,
    unresolvedBlockingScopes: [...new Set(checkpoint.unresolvedBlockingScopes)],
    queuedInstructionCount: checkpoint.queuedInstructions.length,
  };
}
