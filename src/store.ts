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

  /** Execute a synchronous domain mutation atomically. */
  transaction<T>(operation: () => T): T;

  /** Release backing resources. Implementations must make this idempotent. */
  close(): void;
}

type InMemorySnapshot = {
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
};

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]));
}

function replaceMap<T>(target: Map<string, T>, source: Map<string, T>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
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

  private transactionDepth = 0;

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();

    const snapshot = this.snapshot();
    this.transactionDepth += 1;
    try {
      return operation();
    } catch (error) {
      this.restore(snapshot);
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  close(): void {}

  private snapshot(): InMemorySnapshot {
    return {
      agents: cloneMap(this.agents),
      runs: cloneMap(this.runs),
      escalations: cloneMap(this.escalations),
      decisions: cloneMap(this.decisions),
      instructions: cloneMap(this.instructions),
      callAttempts: cloneMap(this.callAttempts),
      auditEvents: cloneMap(this.auditEvents),
      escalationByIdempotencyKey: cloneMap(this.escalationByIdempotencyKey),
      callbackByIdempotencyKey: cloneMap(this.callbackByIdempotencyKey),
      processedWebhookEventIds: new Set(this.processedWebhookEventIds),
    };
  }

  private restore(snapshot: InMemorySnapshot): void {
    replaceMap(this.agents, snapshot.agents);
    replaceMap(this.runs, snapshot.runs);
    replaceMap(this.escalations, snapshot.escalations);
    replaceMap(this.decisions, snapshot.decisions);
    replaceMap(this.instructions, snapshot.instructions);
    replaceMap(this.callAttempts, snapshot.callAttempts);
    replaceMap(this.auditEvents, snapshot.auditEvents);
    replaceMap(this.escalationByIdempotencyKey, snapshot.escalationByIdempotencyKey);
    replaceMap(this.callbackByIdempotencyKey, snapshot.callbackByIdempotencyKey);
    this.processedWebhookEventIds.clear();
    for (const eventId of snapshot.processedWebhookEventIds) this.processedWebhookEventIds.add(eventId);
  }
}
