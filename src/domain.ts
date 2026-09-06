export type Id = string;
export type IsoDate = string;

export type EscalationPriority = "low" | "normal" | "high" | "critical";
export type EscalationStatus = "pending" | "calling" | "resolved" | "expired" | "failed";
export type RunStatus = "running" | "completed" | "failed" | "canceled";
export type InstructionStatus = "queued" | "consumed";
export type PolicyDeferralReason = "below_priority_gate" | "quiet_hours" | "run_budget_exhausted" | "owner_budget_exhausted";
export type AuditActor = "agent" | "owner" | "control_plane" | "provider";
export type AuditEventType =
  | "agent_registered"
  | "run_started"
  | "run_status_reported"
  | "escalation_created"
  | "call_policy_deferred"
  | "call_policy_released"
  | "escalation_expired"
  | "call_attempt_created"
  | "call_attempt_started"
  | "call_attempt_ambiguous"
  | "call_attempt_completed"
  | "call_attempt_failed"
  | "owner_decision_recorded"
  | "owner_callback_requested"
  | "owner_instruction_queued"
  | "owner_instruction_consumed"
  | "provider_webhook_reconciled";

export interface AgentRegistration {
  id: Id;
  name: string;
  platform: string;
  ownerId: Id;
  createdAt: IsoDate;
}

export interface AgentRun {
  id: Id;
  agentId: Id;
  status: RunStatus;
  summary: string;
  currentScope?: string;
  startedAt: IsoDate;
  updatedAt: IsoDate;
}

export interface OwnerDecisionRequest {
  runId: Id;
  scopeId: string;
  question: string;
  context?: string;
  blocking: boolean;
  priority?: EscalationPriority;
  expiresAt?: IsoDate;
  idempotencyKey: string;
}

export interface Escalation {
  id: Id;
  runId: Id;
  scopeId: string;
  question: string;
  context?: string;
  blocking: boolean;
  priority: EscalationPriority;
  status: EscalationStatus;
  idempotencyKey: string;
  callAttemptId?: Id;
  decisionId?: Id;
  deferredReason?: PolicyDeferralReason;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  expiresAt?: IsoDate;
}

export interface OwnerDecision {
  id: Id;
  escalationId: Id;
  answer: string;
  structured?: Record<string, unknown>;
  createdAt: IsoDate;
}

export interface OwnerInstruction {
  id: Id;
  runId: Id;
  text: string;
  source: "callback" | "api";
  status: InstructionStatus;
  createdAt: IsoDate;
  consumedAt?: IsoDate;
}

export interface CallbackRequest {
  runId: Id;
  idempotencyKey: string;
  prompt?: string;
}

export interface PersistedCallRequest {
  task: string;
  metadata: Record<string, string>;
}

export interface CallAttempt {
  id: Id;
  purpose: "owner_decision" | "owner_callback";
  correlationId: Id;
  provider: string;
  providerCallId?: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "ambiguous";
  idempotencyKey: string;
  request: PersistedCallRequest;
  lastError?: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface CallOutcome {
  status: "completed" | "failed" | "ambiguous";
  providerCallId?: string;
  answer?: string;
  instructions?: string[];
  structured?: Record<string, unknown>;
}

export interface AuditEvent {
  id: Id;
  sequence: number;
  type: AuditEventType;
  actor: AuditActor;
  runId?: Id;
  agentId?: Id;
  escalationId?: Id;
  callAttemptId?: Id;
  instructionId?: Id;
  summary: string;
  details?: Record<string, unknown>;
  createdAt: IsoDate;
}

export interface CheckpointResult {
  run: AgentRun;
  queuedInstructions: OwnerInstruction[];
  unresolvedBlockingScopes: string[];
}
