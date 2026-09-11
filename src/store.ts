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
  decisionByEscalationId: Map<string, string>;
  processedWebhookEventIds: Set<string>;
  callbackInstructionSetClaims: Set<string>;

  /** Execute a synchronous domain mutation atomically. */
  transaction<T>(operation: () => T): T;

  /** Atomically bind an escalation idempotency key and return the winning escalation id. */
  bindEscalationIdempotencyKey(key: string, escalationId: string): string;

  /** Atomically bind a callback idempotency key and return the winning call-attempt id. */
  bindCallbackIdempotencyKey(key: string, callAttemptId: string): string;

  /** Atomically bind an escalation to its one durable owner-decision id and return the winner. */
  bindDecisionToEscalation(escalationId: string, decisionId: string): string;

  /** Atomically claim creation of the callback-derived instruction set for one terminal call attempt. */
  claimCallbackInstructionSet(callAttemptId: string): boolean;

  /** Atomically claim a provider webhook event id. Returns true only for the first claim. */
  claimWebhookEventId(eventId: string): boolean;

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
  decisionByEscalationId: Map<string, string>;
  processedWebhookEventIds: Set<string>;
  callbackInstructionSetClaims: Set<string>;
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
  decisionByEscalationId = new Map<string, string>();
  processedWebhookEventIds = new Set<string>();
  callbackInstructionSetClaims = new Set<string>();

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

  bindEscalationIdempotencyKey(key: string, escalationId: string): string {
    return this.bindUnique(this.escalationByIdempotencyKey, key, escalationId);
  }

  bindCallbackIdempotencyKey(key: string, callAttemptId: string): string {
    return this.bindUnique(this.callbackByIdempotencyKey, key, callAttemptId);
  }

  bindDecisionToEscalation(escalationId: string, decisionId: string): string {
    return this.bindUnique(this.decisionByEscalationId, escalationId, decisionId);
  }

  claimCallbackInstructionSet(callAttemptId: string): boolean {
    return this.claimUnique(this.callbackInstructionSetClaims, callAttemptId);
  }

  claimWebhookEventId(eventId: string): boolean {
    return this.claimUnique(this.processedWebhookEventIds, eventId);
  }

  close(): void {}

  private bindUnique(map: Map<string, string>, key: string, value: string): string {
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    map.set(key, value);
    return value;
  }

  private claimUnique(set: Set<string>, value: string): boolean {
    if (set.has(value)) return false;
    set.add(value);
    return true;
  }

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
      decisionByEscalationId: cloneMap(this.decisionByEscalationId),
      processedWebhookEventIds: new Set(this.processedWebhookEventIds),
      callbackInstructionSetClaims: new Set(this.callbackInstructionSetClaims),
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
    replaceMap(this.decisionByEscalationId, snapshot.decisionByEscalationId);
    this.processedWebhookEventIds.clear();
    for (const eventId of snapshot.processedWebhookEventIds) this.processedWebhookEventIds.add(eventId);
    this.callbackInstructionSetClaims.clear();
    for (const callAttemptId of snapshot.callbackInstructionSetClaims) this.callbackInstructionSetClaims.add(callAttemptId);
  }
}
