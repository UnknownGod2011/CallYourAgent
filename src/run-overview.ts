import type { AgentRun, CallAttempt } from "./domain.js";
import type { ControlPlane } from "./control-plane.js";

/**
 * Privacy-preserving read model for operators and host adapters.
 *
 * This intentionally exposes only the count of queued owner instructions, never
 * their text. It also reports unresolved blocking scopes without consuming or
 * acknowledging any instruction state. Callback status is projected from the
 * durable call attempt without exposing the persisted phone task or transcript.
 */
export interface CallbackStatusOverview {
  id: string;
  status: CallAttempt["status"];
  createdAt: string;
  updatedAt: string;
}

export interface RunOverview {
  run: AgentRun;
  unresolvedBlockingScopes: string[];
  queuedInstructionCount: number;
  latestOwnerCallback: CallbackStatusOverview | null;
}

export function getRunOverview(controlPlane: ControlPlane, runId: string): RunOverview {
  const checkpoint = controlPlane.checkpoint(runId, false);
  const latestCallbackEvent = controlPlane.listAuditEvents(runId, 500)
    .slice()
    .reverse()
    .find((event) => event.type === "owner_callback_requested" && event.callAttemptId);
  const latestCallback = latestCallbackEvent?.callAttemptId
    ? controlPlane.getCallAttempt(latestCallbackEvent.callAttemptId)
    : undefined;

  return {
    run: checkpoint.run,
    unresolvedBlockingScopes: [...new Set(checkpoint.unresolvedBlockingScopes)],
    queuedInstructionCount: checkpoint.queuedInstructions.length,
    latestOwnerCallback: latestCallback ? {
      id: latestCallback.id,
      status: latestCallback.status,
      createdAt: latestCallback.createdAt,
      updatedAt: latestCallback.updatedAt,
    } : null,
  };
}
