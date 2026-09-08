import type { CallAttempt, Escalation, EscalationPriority, EscalationStatus, PolicyDeferralReason } from "./domain.js";
import type { ControlPlane } from "./control-plane.js";

export interface EscalationLifecycleView {
  id: string;
  runId: string;
  scopeId: string;
  blocking: boolean;
  priority: EscalationPriority;
  status: EscalationStatus;
  callStatus: CallAttempt["status"] | null;
  deferredReason?: PolicyDeferralReason;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

/**
 * Privacy-safe projection for owner/operator lifecycle observation.
 *
 * Deliberately excludes the escalation question/context, idempotency key,
 * call/decision ids, provider correlation, and the owner's decision result.
 */
export function getEscalationLifecycleView(controlPlane: ControlPlane, escalationId: string): EscalationLifecycleView {
  const escalation: Escalation = controlPlane.getEscalation(escalationId);
  const callStatus = escalation.callAttemptId
    ? controlPlane.getCallAttempt(escalation.callAttemptId).status
    : null;

  return {
    id: escalation.id,
    runId: escalation.runId,
    scopeId: escalation.scopeId,
    blocking: escalation.blocking,
    priority: escalation.priority,
    status: escalation.status,
    callStatus,
    ...(escalation.deferredReason ? { deferredReason: escalation.deferredReason } : {}),
    createdAt: escalation.createdAt,
    updatedAt: escalation.updatedAt,
    ...(escalation.expiresAt ? { expiresAt: escalation.expiresAt } : {}),
  };
}
