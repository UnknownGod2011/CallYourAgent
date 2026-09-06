import { randomUUID } from "node:crypto";
import type {
  AgentRegistration,
  AgentRun,
  AuditActor,
  AuditEvent,
  CallAttempt,
  CallOutcome,
  CallbackRequest,
  CheckpointResult,
  Escalation,
  OwnerDecision,
  OwnerDecisionRequest,
  OwnerInstruction,
} from "./domain.js";
import type { CallProvider } from "./call-provider.js";
import { CallPolicy } from "./call-policy.js";
import type { ControlPlaneStore } from "./store.js";

export interface Clock {
  now(): Date;
}

export interface ProviderWebhookInput {
  eventId: string;
  providerCallId: string;
  outcome: CallOutcome;
}

export interface ProviderWebhookResult {
  duplicate: boolean;
  callAttempt: CallAttempt;
}

const systemClock: Clock = { now: () => new Date() };

export class ControlPlane {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly calls: CallProvider,
    private readonly clock: Clock = systemClock,
    private readonly callPolicy: CallPolicy = new CallPolicy(),
  ) {}

  registerAgent(input: Omit<AgentRegistration, "id" | "createdAt">): AgentRegistration {
    const agent: AgentRegistration = { ...input, id: randomUUID(), createdAt: this.isoNow() };
    this.store.agents.set(agent.id, agent);
    this.audit("agent_registered", "control_plane", "Agent registered", { agentId: agent.id }, {
      platform: agent.platform,
      ownerId: agent.ownerId,
    });
    return agent;
  }

  startRun(agentId: string, summary: string, currentScope?: string): AgentRun {
    this.requireAgent(agentId);
    const now = this.isoNow();
    const run: AgentRun = {
      id: randomUUID(),
      agentId,
      status: "running",
      summary,
      currentScope,
      startedAt: now,
      updatedAt: now,
    };
    this.store.runs.set(run.id, run);
    this.audit("run_started", "agent", "Agent run started", { runId: run.id, agentId }, {
      currentScope: run.currentScope,
    });
    return run;
  }

  heartbeat(runId: string, update: { summary?: string; currentScope?: string }): AgentRun {
    const run = this.requireRun(runId);
    if (run.status !== "running") throw new Error(`Run ${runId} is not running`);
    const next = { ...run, ...update, updatedAt: this.isoNow() };
    this.store.runs.set(runId, next);
    this.audit("run_status_reported", "agent", "Agent reported progress", { runId, agentId: run.agentId }, {
      currentScope: next.currentScope,
      summaryChanged: update.summary !== undefined,
    });
    return next;
  }

  async requestOwnerDecision(input: OwnerDecisionRequest): Promise<Escalation> {
    this.requireRunningRun(input.runId);
    const existingId = this.store.escalationByIdempotencyKey.get(input.idempotencyKey);
    if (existingId) return this.store.escalations.get(existingId)!;

    const now = this.isoNow();
    const escalation: Escalation = {
      id: randomUUID(),
      runId: input.runId,
      scopeId: input.scopeId,
      question: input.question,
      context: input.context,
      blocking: input.blocking,
      priority: input.priority ?? "normal",
      status: "pending",
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };
    this.store.escalations.set(escalation.id, escalation);
    this.store.escalationByIdempotencyKey.set(input.idempotencyKey, escalation.id);
    this.audit("escalation_created", "agent", "Owner decision requested", {
      runId: escalation.runId,
      escalationId: escalation.id,
    }, {
      scopeId: escalation.scopeId,
      blocking: escalation.blocking,
      priority: escalation.priority,
      expiresAt: escalation.expiresAt,
    });

    return this.startEscalationCallIfAllowed(escalation);
  }

  async reconcileEscalation(escalationId: string): Promise<Escalation> {
    const escalation = this.requireEscalation(escalationId);
    if (["resolved", "expired", "failed"].includes(escalation.status)) return escalation;
    if (escalation.expiresAt && new Date(escalation.expiresAt) <= this.clock.now()) {
      const expired = { ...escalation, status: "expired" as const, updatedAt: this.isoNow() };
      this.store.escalations.set(expired.id, expired);
      this.audit("escalation_expired", "control_plane", "Escalation expired before resolution", {
        runId: expired.runId,
        escalationId: expired.id,
      }, { scopeId: expired.scopeId });
      return expired;
    }
    if (!escalation.callAttemptId) return this.startEscalationCallIfAllowed(escalation);

    let attempt = this.requireCallAttempt(escalation.callAttemptId);
    if (attempt.status === "ambiguous") attempt = await this.recoverCallAttempt(attempt.id);
    if (!attempt.providerCallId) return this.requireEscalation(escalationId);

    const outcome = await this.calls.getOutcome(attempt.providerCallId);
    if (!outcome) return this.requireEscalation(escalationId);
    this.applyTerminalOutcome(attempt, outcome);
    return this.requireEscalation(escalationId);
  }

  async requestOwnerCallback(input: CallbackRequest): Promise<CallAttempt> {
    const run = this.requireRunningRun(input.runId);
    const existingId = this.store.callbackByIdempotencyKey.get(input.idempotencyKey);
    if (existingId) return this.store.callAttempts.get(existingId)!;

    const task = [
      "The owner requested a callback with their running AI agent.",
      `Current agent status: ${run.summary}`,
      run.currentScope ? `Current scope: ${run.currentScope}` : "",
      input.prompt ? `Owner request: ${input.prompt}` : "Ask what the owner wants to know or change.",
      "Capture any new owner instructions as concise action items.",
    ].filter(Boolean).join("\n");

    const attempt = await this.startCall(
      "owner_callback",
      input.runId,
      task,
      `callback:${input.idempotencyKey}`,
      { runId: input.runId },
    );
    this.store.callbackByIdempotencyKey.set(input.idempotencyKey, attempt.id);
    this.audit("owner_callback_requested", "owner", "Owner requested a callback to the running agent", {
      runId: input.runId,
      agentId: run.agentId,
      callAttemptId: attempt.id,
    }, { currentScope: run.currentScope });
    return attempt;
  }

  async reconcileCallback(callAttemptId: string): Promise<CallAttempt> {
    let attempt = this.requireCallAttempt(callAttemptId);
    if (attempt.purpose !== "owner_callback") throw new Error("Call attempt is not an owner callback");
    if (["completed", "failed"].includes(attempt.status)) return attempt;
    if (attempt.status === "ambiguous") attempt = await this.recoverCallAttempt(attempt.id);
    if (!attempt.providerCallId) return attempt;

    const outcome = await this.calls.getOutcome(attempt.providerCallId);
    if (!outcome) return attempt;
    return this.applyTerminalOutcome(attempt, outcome);
  }

  ingestProviderWebhook(input: ProviderWebhookInput): ProviderWebhookResult {
    if (!input.eventId.trim()) throw new Error("Provider webhook event id is required");
    if (!input.providerCallId.trim()) throw new Error("Provider call id is required");

    return this.store.transaction(() => {
      const attempt = [...this.store.callAttempts.values()].find((item) => item.providerCallId === input.providerCallId);
      if (!attempt) throw new Error(`Unknown provider call: ${input.providerCallId}`);

      if (this.store.processedWebhookEventIds.has(input.eventId)) {
        return { duplicate: true, callAttempt: this.requireCallAttempt(attempt.id) };
      }

      const callAttempt = this.applyTerminalOutcome(attempt, input.outcome);
      this.store.processedWebhookEventIds.add(input.eventId);
      this.audit("provider_webhook_reconciled", "provider", "Provider webhook reconciled", {
        runId: this.runIdForAttempt(attempt),
        callAttemptId: attempt.id,
      }, { eventId: input.eventId, providerCallId: input.providerCallId, outcome: input.outcome.status });
      return { duplicate: false, callAttempt };
    });
  }

  async recoverCallAttempt(callAttemptId: string): Promise<CallAttempt> {
    const attempt = this.requireCallAttempt(callAttemptId);
    if (attempt.status !== "ambiguous") return attempt;

    try {
      const started = await this.calls.start({
        idempotencyKey: attempt.idempotencyKey,
        purpose: attempt.purpose,
        task: attempt.request.task,
        metadata: attempt.request.metadata,
      });
      const recovered: CallAttempt = {
        ...attempt,
        providerCallId: started.providerCallId,
        status: started.status,
        lastError: undefined,
        updatedAt: this.isoNow(),
      };
      this.store.callAttempts.set(recovered.id, recovered);
      this.audit("call_attempt_started", "control_plane", "Ambiguous call attempt safely recovered", {
        runId: this.runIdForAttempt(recovered),
        callAttemptId: recovered.id,
      }, { purpose: recovered.purpose, provider: recovered.provider, recovered: true });
      return recovered;
    } catch (error) {
      const stillAmbiguous: CallAttempt = {
        ...attempt,
        status: "ambiguous",
        lastError: errorMessage(error),
        updatedAt: this.isoNow(),
      };
      this.store.callAttempts.set(stillAmbiguous.id, stillAmbiguous);
      this.audit("call_attempt_ambiguous", "control_plane", "Call recovery remains ambiguous", {
        runId: this.runIdForAttempt(stillAmbiguous),
        callAttemptId: stillAmbiguous.id,
      }, { purpose: stillAmbiguous.purpose, provider: stillAmbiguous.provider });
      return stillAmbiguous;
    }
  }

  checkpoint(runId: string, consume = false): CheckpointResult {
    const run = this.requireRun(runId);
    const queuedInstructions = [...this.store.instructions.values()].filter(
      (instruction) => instruction.runId === runId && instruction.status === "queued",
    );
    const unresolvedBlockingScopes = [...this.store.escalations.values()]
      .filter((e) => e.runId === runId && e.blocking && (e.status === "pending" || e.status === "calling"))
      .map((e) => e.scopeId);

    if (consume) {
      const now = this.isoNow();
      for (const instruction of queuedInstructions) {
        this.store.instructions.set(instruction.id, { ...instruction, status: "consumed", consumedAt: now });
        this.audit("owner_instruction_consumed", "agent", "Owner instruction consumed at a safe checkpoint", {
          runId,
          agentId: run.agentId,
          instructionId: instruction.id,
        }, { source: instruction.source });
      }
    }
    return { run, queuedInstructions, unresolvedBlockingScopes };
  }

  enqueueInstruction(runId: string, text: string, source: OwnerInstruction["source"] = "api"): OwnerInstruction {
    const run = this.requireRun(runId);
    const instruction: OwnerInstruction = {
      id: randomUUID(),
      runId,
      text,
      source,
      status: "queued",
      createdAt: this.isoNow(),
    };
    this.store.instructions.set(instruction.id, instruction);
    this.audit("owner_instruction_queued", source === "callback" ? "owner" : "control_plane", "Owner instruction queued for next safe checkpoint", {
      runId,
      agentId: run.agentId,
      instructionId: instruction.id,
    }, { source });
    return instruction;
  }

  getRun(runId: string): AgentRun {
    return this.requireRun(runId);
  }

  getEscalation(escalationId: string): Escalation {
    return this.requireEscalation(escalationId);
  }

  getCallAttempt(callAttemptId: string): CallAttempt {
    return this.requireCallAttempt(callAttemptId);
  }

  getDecision(escalationId: string): OwnerDecision | undefined {
    const escalation = this.requireEscalation(escalationId);
    return escalation.decisionId ? this.store.decisions.get(escalation.decisionId) : undefined;
  }

  listAuditEvents(runId: string, limit = 100): AuditEvent[] {
    this.requireRun(runId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Audit event limit must be an integer from 1 to 500");
    return [...this.store.auditEvents.values()]
      .filter((event) => event.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(-limit);
  }

  private async startEscalationCallIfAllowed(escalation: Escalation): Promise<Escalation> {
    if (escalation.callAttemptId || escalation.status !== "pending") return escalation;
    const run = this.requireRunningRun(escalation.runId);
    const owner = this.requireAgent(run.agentId);
    const decision = this.callPolicy.assessDecisionCall({
      run,
      owner,
      priority: escalation.priority,
      now: this.clock.now(),
      attempts: this.store.callAttempts.values(),
      runs: this.store.runs,
      agents: this.store.agents,
    });
    if (!decision.allowed) {
      if (decision.reason && escalation.deferredReason !== decision.reason) {
        const deferred = { ...escalation, deferredReason: decision.reason, updatedAt: this.isoNow() };
        this.store.escalations.set(deferred.id, deferred);
        this.audit("call_policy_deferred", "control_plane", "Owner call deferred by policy", {
          runId: escalation.runId,
          escalationId: escalation.id,
        }, { reason: decision.reason, scopeId: escalation.scopeId, priority: escalation.priority });
        return deferred;
      }
      return escalation;
    }

    if (escalation.deferredReason) {
      this.audit("call_policy_released", "control_plane", "Deferred owner call became eligible", {
        runId: escalation.runId,
        escalationId: escalation.id,
      }, { previousReason: escalation.deferredReason, scopeId: escalation.scopeId });
    }

    const attempt = await this.startCall(
      "owner_decision",
      escalation.id,
      `Decision needed from the agent owner. Question: ${escalation.question}${escalation.context ? `\nContext: ${escalation.context}` : ""}`,
      `decision:${escalation.idempotencyKey}`,
      { runId: escalation.runId, escalationId: escalation.id, scopeId: escalation.scopeId },
    );

    const next: Escalation = {
      ...escalation,
      status: "calling",
      callAttemptId: attempt.id,
      deferredReason: undefined,
      updatedAt: this.isoNow(),
    };
    this.store.escalations.set(next.id, next);
    return next;
  }

  private applyTerminalOutcome(attempt: CallAttempt, outcome: CallOutcome): CallAttempt {
    if (attempt.status === "completed" || attempt.status === "failed") return attempt;
    if (outcome.status === "ambiguous") {
      return this.finishAttempt(attempt, "ambiguous");
    }

    const finished = this.finishAttempt(attempt, outcome.status);

    if (attempt.purpose === "owner_decision") {
      const escalation = this.requireEscalation(attempt.correlationId);
      if (["resolved", "expired", "failed"].includes(escalation.status)) return finished;

      if (outcome.status === "failed") {
        const failed = { ...escalation, status: "failed" as const, updatedAt: this.isoNow() };
        this.store.escalations.set(failed.id, failed);
        return finished;
      }

      const decision: OwnerDecision = {
        id: randomUUID(),
        escalationId: escalation.id,
        answer: outcome.answer ?? "",
        structured: outcome.structured,
        createdAt: this.isoNow(),
      };
      this.store.decisions.set(decision.id, decision);
      const resolved = {
        ...escalation,
        status: "resolved" as const,
        decisionId: decision.id,
        updatedAt: this.isoNow(),
      };
      this.store.escalations.set(resolved.id, resolved);
      this.audit("owner_decision_recorded", "owner", "Owner decision recorded and blocked scope released", {
        runId: escalation.runId,
        escalationId: escalation.id,
        callAttemptId: attempt.id,
      }, { scopeId: escalation.scopeId, blocking: escalation.blocking, structured: Boolean(outcome.structured) });
      return finished;
    }

    if (outcome.status === "completed") {
      for (const text of outcome.instructions ?? []) this.enqueueInstruction(attempt.correlationId, text, "callback");
    }
    return finished;
  }

  private async startCall(
    purpose: CallAttempt["purpose"],
    correlationId: string,
    task: string,
    idempotencyKey: string,
    metadata: Record<string, string>,
  ): Promise<CallAttempt> {
    const now = this.isoNow();
    const attempt: CallAttempt = {
      id: randomUUID(),
      purpose,
      correlationId,
      provider: this.calls.name,
      status: "queued",
      idempotencyKey,
      request: { task, metadata: { ...metadata } },
      createdAt: now,
      updatedAt: now,
    };
    this.store.callAttempts.set(attempt.id, attempt);
    this.audit("call_attempt_created", "control_plane", "Phone call attempt persisted before provider side effect", {
      runId: this.runIdForAttempt(attempt),
      callAttemptId: attempt.id,
    }, { purpose, provider: attempt.provider });

    try {
      const started = await this.calls.start({ idempotencyKey, purpose, task, metadata });
      const next: CallAttempt = {
        ...attempt,
        providerCallId: started.providerCallId,
        status: started.status,
        updatedAt: this.isoNow(),
      };
      this.store.callAttempts.set(next.id, next);
      this.audit("call_attempt_started", "provider", "Phone provider accepted call attempt", {
        runId: this.runIdForAttempt(next),
        callAttemptId: next.id,
      }, { purpose, provider: next.provider, status: next.status });
      return next;
    } catch (error) {
      const ambiguous: CallAttempt = {
        ...attempt,
        status: "ambiguous",
        lastError: errorMessage(error),
        updatedAt: this.isoNow(),
      };
      this.store.callAttempts.set(ambiguous.id, ambiguous);
      this.audit("call_attempt_ambiguous", "control_plane", "Phone call outcome is ambiguous and will be safely reconciled", {
        runId: this.runIdForAttempt(ambiguous),
        callAttemptId: ambiguous.id,
      }, { purpose, provider: ambiguous.provider });
      return ambiguous;
    }
  }

  private finishAttempt(attempt: CallAttempt, status: "completed" | "failed" | "ambiguous"): CallAttempt {
    const next = { ...attempt, status, updatedAt: this.isoNow() };
    this.store.callAttempts.set(next.id, next);
    const type = status === "completed" ? "call_attempt_completed" : status === "failed" ? "call_attempt_failed" : "call_attempt_ambiguous";
    this.audit(type, status === "ambiguous" ? "control_plane" : "provider", `Phone call attempt ${status}`, {
      runId: this.runIdForAttempt(next),
      callAttemptId: next.id,
    }, { purpose: next.purpose, provider: next.provider });
    return next;
  }

  private audit(
    type: AuditEvent["type"],
    actor: AuditActor,
    summary: string,
    refs: Pick<AuditEvent, "runId" | "agentId" | "escalationId" | "callAttemptId" | "instructionId"> = {},
    details?: Record<string, unknown>,
  ): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      type,
      actor,
      summary,
      ...refs,
      details,
      createdAt: this.isoNow(),
    };
    this.store.auditEvents.set(event.id, event);
    return event;
  }

  private runIdForAttempt(attempt: CallAttempt): string | undefined {
    if (attempt.purpose === "owner_callback") return attempt.correlationId;
    return this.store.escalations.get(attempt.correlationId)?.runId ?? attempt.request.metadata.runId;
  }

  private requireAgent(id: string): AgentRegistration {
    const value = this.store.agents.get(id);
    if (!value) throw new Error(`Unknown agent: ${id}`);
    return value;
  }

  private requireRun(id: string): AgentRun {
    const value = this.store.runs.get(id);
    if (!value) throw new Error(`Unknown run: ${id}`);
    return value;
  }

  private requireRunningRun(id: string): AgentRun {
    const run = this.requireRun(id);
    if (run.status !== "running") throw new Error(`Run ${id} is not running`);
    return run;
  }

  private requireEscalation(id: string): Escalation {
    const value = this.store.escalations.get(id);
    if (!value) throw new Error(`Unknown escalation: ${id}`);
    return value;
  }

  private requireCallAttempt(id: string): CallAttempt {
    const value = this.store.callAttempts.get(id);
    if (!value) throw new Error(`Unknown call attempt: ${id}`);
    return value;
  }

  private isoNow(): string {
    return this.clock.now().toISOString();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
