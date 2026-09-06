import type {
  AgentRegistration,
  AgentRun,
  AuditEvent,
  CallAttempt,
  Escalation,
  OwnerDecision,
  OwnerInstruction,
} from "./domain.js";

export interface ControlPlaneStore {
  agents: Map<string, AgentRegistration>;
  runs: Map<string, AgentRun>;
  escalations: Map<string, Escalation>;
  decisions: Map<string, OwnerDecision>;
  instructions: Map<string, OwnerInstruction>;
  callAttempts: Map<string, CallAttempt>;
  auditEvents: Map<string, AuditEvent>;
  escalationByIdempotencyKey: Map<string, string>;
  callbackByIdempotencyKey: Map<string, string>;
  processedWebhookEventIds: Set<string>;

  /**
   * Execute a synchronous domain mutation atomically when the backing store
   * supports transactions. The in-memory implementation executes inline.
   */
  transaction<T>(operation: () => T): T;
}

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  agents = new Map<string, AgentRegistration>();
  runs = new Map<string, AgentRun>();
  escalations = new Map<string, Escalation>();
  decisions = new Map<string, OwnerDecision>();
  instructions = new Map<string, OwnerInstruction>();
  callAttempts = new Map<string, CallAttempt>();
  auditEvents = new Map<string, AuditEvent>();
  escalationByIdempotencyKey = new Map<string, string>();
  callbackByIdempotencyKey = new Map<string, string>();
  processedWebhookEventIds = new Set<string>();

  transaction<T>(operation: () => T): T {
    return operation();
  }
}
