import { createHash, randomUUID } from "node:crypto";
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
import { providerSafeDiagnostic, type CallProvider, type CallProviderObservation, type StartCallResult } from "./call-provider.js";
import { CallPolicy } from "./call-policy.js";
import type { CallTerminalOutcomeClaim, ControlPlaneStore } from "./store.js";

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

export const IDEMPOTENCY_CONFLICT_MESSAGE = "Idempotency key is already bound to a different request";

const systemClock: Clock = { now: () => new Date() };

type TerminalCallOutcome = Extract<CallOutcome, { status: "completed" | "failed" }>;

function callbackRequestFingerprint(input: CallbackRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ runId: input.runId, prompt: input.prompt || null }))
    .digest("hex");
}

function canonicalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeFingerprintValue(nested)]),
    );
  }
  return value;
}

function terminalOutcomeClaim(outcome: TerminalCallOutcome): CallTerminalOutcomeClaim {
  return {
    status: outcome.status,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(canonicalizeFingerprintValue(outcome)))
      .digest("hex"),
  };
}

function terminalClaimsMatch(left: CallTerminalOutcomeClaim, right: CallTerminalOutcomeClaim): boolean {
  return left.status === right.status && left.fingerprint === right.fingerprint;
}

function assertEscalationReplayMatches(existing: Escalation, input: OwnerDecisionRequest): void {
  if (
    existing.runId !== input.runId
    || existing.scopeId !== input.scopeId
    || existing.question !== input.question
    || (existing.context || undefined) !== (input.context || undefined)
    || existing.blocking !== input.blocking
    || existing.priority !== (input.priority ?? "normal")
    || existing.expiresAt !== input.expiresAt
  ) throw new Error(IDEMPOTENCY_CONFLICT_MESSAGE);
}

function assertCallbackReplayMatches(existing: CallAttempt, input: CallbackRequest): void {
  if (existing.purpose !== "owner_callback" || existing.correlationId !== input.runId) {
    throw new Error(IDEMPOTENCY_CONFLICT_MESSAGE);
  }

  const fingerprint = callbackRequestFingerprint(input);
  if (existing.requestFingerprint) {
    if (existing.requestFingerprint !== fingerprint) throw new Error(IDEMPOTENCY_CONFLICT_MESSAGE);
    return;
  }

  // Backward-compatible verification for durable attempts created before
  // requestFingerprint existed. The callback prompt is already part of the
  // persisted replayable task, so no new sensitive state is introduced.
  const promptClause = input.prompt
    ? `Owner request: ${input.prompt}`
    : "Ask what the owner wants to know or change.";
  const expectedSuffix = `${promptClause}\nCapture any new owner instructions as concise action items.`;
  if (!existing.request.task.endsWith(expectedSuffix)) throw new Error(IDEMPOTENCY_CONFLICT_MESSAGE);
}

export class ControlPlane {
  private readonly recoveryInFlight = new Map<string, Promise<CallAttempt>>();

  constructor(
    private readonly store: ControlPlaneStore,
    private readonly calls: CallProvider,
    private readonly clock: Clock = systemClock,
    private readonly callPolicy: CallPolicy = new CallPolicy(),
  ) {}

  registerAgent(input: Omit<AgentRegistration, "id" | "createdAt">): AgentRegistration {
    return this.store.transaction(() => {
      const agent: AgentRegistration = { ...input, id: randomUUID(), createdAt: this.isoNow() };
      this.store.agents.set(agent.id, agent);
      this.audit("agent_registered", "control_plane", "Agent registered", { agentId: agent.id }, {
        platform: agent.platform,
        ownerId: agent.ownerId,
      });
      return agent;
    });
  }

  startRun(agentId: string, summary: string, currentScope?: string): AgentRun {
    this.requireAgent(agentId);
    return this.store.transaction(() => {
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
    });
  }

  heartbeat(runId: string, update: { summary?: string; currentScope?: string }): AgentRun {
    const run = this.requireRun(runId);
    if (run.status !== "running") throw new Error(`Run ${runId} is not running`);
    return this.store.transaction(() => {
      const current = this.requireRun(runId);
      if (current.status !== "running") throw new Error(`Run ${runId} is not running`);
      const next = { ...current, ...update, updatedAt: this.isoNow() };
      this.store.runs.set(runId, next);
      this.audit("run_status_reported", "agent", "Agent reported progress", { runId, agentId: current.agentId }, {
        currentScope: next.currentScope,
        summaryChanged: update.summary !== undefined,
      });
      return next;
    });
  }

  async requestOwnerDecision(input: OwnerDecisionRequest): Promise<Escalation> {
    const replayId = this.store.escalationByIdempotencyKey.get(input.idempotencyKey);
    if (replayId) {
      const existing = this.requireEscalation(replayId);
      assertEscalationReplayMatches(existing, input);
      return existing;
    }
    this.requireRunningRun(input.runId);
    const escalation = this.store.transaction(() => {
      const candidateId = randomUUID();
      const winnerId = this.store.bindEscalationIdempotencyKey(input.idempotencyKey, candidateId);
      if (winnerId !== candidateId) {
        const existing = this.requireEscalation(winnerId);
        assertEscalationReplayMatches(existing, input);
        return existing;
      }
      const now = this.isoNow();
      const created: Escalation = {
        id: candidateId, runId: input.runId, scopeId: input.scopeId, question: input.question,
        context: input.context, blocking: input.blocking, priority: input.priority ?? "normal", status: "pending",
        idempotencyKey: input.idempotencyKey, createdAt: now, updatedAt: now, expiresAt: input.expiresAt,
      };
      this.store.escalations.set(created.id, created);
      this.audit("escalation_created", "agent", "Owner decision requested", { runId: created.runId, escalationId: created.id }, {
        scopeId: created.scopeId, blocking: created.blocking, priority: created.priority, expiresAt: created.expiresAt,
      });
      return created;
    });
    return this.startEscalationCallIfAllowed(escalation);
  }

  async reconcileEscalation(escalationId: string): Promise<Escalation> {
    const escalation = this.requireEscalation(escalationId);
    if (["resolved", "expired", "failed"].includes(escalation.status)) return escalation;
    if (escalation.expiresAt && new Date(escalation.expiresAt) <= this.clock.now()) {
      return this.store.transaction(() => {
        const current = this.requireEscalation(escalationId);
        if (["resolved", "expired", "failed"].includes(current.status)) return current;
        if (!current.expiresAt || new Date(current.expiresAt) > this.clock.now()) return current;
        const expired = { ...current, status: "expired" as const, updatedAt: this.isoNow() };
        this.store.escalations.set(expired.id, expired);
        this.audit("escalation_expired", "control_plane", "Escalation expired before resolution", { runId: expired.runId, escalationId: expired.id }, { scopeId: expired.scopeId });
        return expired;
      });
    }
    if (!escalation.callAttemptId) return this.startEscalationCallIfAllowed(escalation);
    let attempt = this.requireCallAttempt(escalation.callAttemptId);
    if (attempt.status === "ambiguous") attempt = await this.recoverCallAttempt(attempt.id);
    if (!attempt.providerCallId) return this.requireEscalation(escalationId);
    await this.rehydrateProviderCallIfSupported(attempt);
    const observation = await this.calls.observe(attempt.providerCallId);
    if (observation.status === "queued" || observation.status === "in_progress") {
      this.store.transaction(() => this.applyActiveObservation(attempt, observation));
      return this.requireEscalation(escalationId);
    }
    this.store.transaction(() => this.applyTerminalOutcome(attempt, observation));
    return this.requireEscalation(escalationId);
  }

  async requestOwnerCallback(input: CallbackRequest): Promise<CallAttempt> {
    const replayId = this.store.callbackByIdempotencyKey.get(input.idempotencyKey);
    if (replayId) {
      const existing = this.requireCallAttempt(replayId);
      assertCallbackReplayMatches(existing, input);
      return existing;
    }
    const run = this.requireRunningRun(input.runId);
    const task = [
      "The owner requested a callback with their running AI agent.",
      `Current agent status: ${run.summary}`,
      run.currentScope ? `Current scope: ${run.currentScope}` : "",
      input.prompt ? `Owner request: ${input.prompt}` : "Ask what the owner wants to know or change.",
      "Capture any new owner instructions as concise action items.",
    ].filter(Boolean).join("\n");
    const attempt = this.store.transaction(() => {
      const candidateId = randomUUID();
      const winnerId = this.store.bindCallbackIdempotencyKey(input.idempotencyKey, candidateId);
      if (winnerId !== candidateId) {
        const existing = this.requireCallAttempt(winnerId);
        assertCallbackReplayMatches(existing, input);
        return existing;
      }
      const reserved = this.persistCallAttempt(
        "owner_callback",
        input.runId,
        task,
        `callback:${input.idempotencyKey}`,
        { runId: input.runId },
        callbackRequestFingerprint(input),
        candidateId,
      );
      this.audit("owner_callback_requested", "owner", "Owner requested a callback to the running agent", { runId: input.runId, agentId: run.agentId, callAttemptId: reserved.id }, { currentScope: run.currentScope });
      return reserved;
    });
    if (attempt.providerCallId || attempt.status !== "queued") return attempt;
    return this.dispatchCallAttempt(attempt);
  }

  async reconcileCallback(callAttemptId: string): Promise<CallAttempt> {
    let attempt = this.requireCallAttempt(callAttemptId);
    if (attempt.purpose !== "owner_callback") throw new Error("Call attempt is not an owner callback");
    if (["completed", "failed"].includes(attempt.status)) return attempt;
    if (attempt.status === "ambiguous") attempt = await this.recoverCallAttempt(attempt.id);
    if (!attempt.providerCallId) return attempt;
    await this.rehydrateProviderCallIfSupported(attempt);
    const observation = await this.calls.observe(attempt.providerCallId);
    if (observation.status === "queued" || observation.status === "in_progress") {
      return this.store.transaction(() => this.applyActiveObservation(attempt, observation));
    }
    return this.store.transaction(() => this.applyTerminalOutcome(attempt, observation));
  }

  ingestProviderWebhook(input: ProviderWebhookInput): ProviderWebhookResult {
    if (!input.eventId.trim()) throw new Error("Provider webhook event id is required");
    if (!input.providerCallId.trim()) throw new Error("Provider call id is required");
    return this.store.transaction(() => {
      const attempt = [...this.store.callAttempts.values()].find((item) => item.providerCallId === input.providerCallId);
      if (!attempt) throw new Error(`Unknown provider call: ${input.providerCallId}`);
      if (!this.store.claimWebhookEventId(input.eventId)) return { duplicate: true, callAttempt: this.requireCallAttempt(attempt.id) };
      const callAttempt = this.applyTerminalOutcome(attempt, input.outcome);
      this.audit("provider_webhook_reconciled", "provider", "Provider webhook reconciled", { runId: this.runIdForAttempt(attempt), callAttemptId: attempt.id }, { eventId: input.eventId, providerCallId: input.providerCallId, outcome: input.outcome.status });
      return { duplicate: false, callAttempt };
    });
  }

  async recoverCallAttempt(callAttemptId: string): Promise<CallAttempt> {
    const inFlight = this.recoveryInFlight.get(callAttemptId);
    if (inFlight) return inFlight;

    const recovery = this.recoverCallAttemptOnce(callAttemptId);
    this.recoveryInFlight.set(callAttemptId, recovery);
    try {
      return await recovery;
    } finally {
      if (this.recoveryInFlight.get(callAttemptId) === recovery) {
        this.recoveryInFlight.delete(callAttemptId);
      }
    }
  }

  private async recoverCallAttemptOnce(callAttemptId: string): Promise<CallAttempt> {
    const attempt = this.requireCallAttempt(callAttemptId);
    if (attempt.status !== "ambiguous") return attempt;
    if (attempt.automaticRecoveryExhaustedAt) return attempt;

    let started: StartCallResult;
    try {
      started = await this.calls.start({ idempotencyKey: attempt.idempotencyKey, purpose: attempt.purpose, task: attempt.request.task, metadata: attempt.request.metadata });
    } catch (error) {
      const current = this.requireCallAttempt(attempt.id);
      if (current.status !== "ambiguous") return current;
      const stillAmbiguous: CallAttempt = { ...current, status: "ambiguous", lastError: providerSafeDiagnostic(error), updatedAt: this.isoNow() };
      this.store.callAttempts.set(stillAmbiguous.id, stillAmbiguous);
      this.audit("call_attempt_ambiguous", "control_plane", "Call recovery remains ambiguous", { runId: this.runIdForAttempt(stillAmbiguous), callAttemptId: stillAmbiguous.id }, { purpose: stillAmbiguous.purpose, provider: stillAmbiguous.provider });
      return stillAmbiguous;
    }

    const current = this.requireCallAttempt(attempt.id);
    if (current.status !== "ambiguous") return current;
    const recovered: CallAttempt = { ...current, providerCallId: started.providerCallId, status: started.status, lastError: undefined, updatedAt: this.isoNow() };
    this.store.callAttempts.set(recovered.id, recovered);
    this.audit("call_attempt_started", "control_plane", "Ambiguous call attempt safely recovered", { runId: this.runIdForAttempt(recovered), callAttemptId: recovered.id }, { purpose: recovered.purpose, provider: recovered.provider, recovered: true });
    return recovered;
  }

  checkpoint(runId: string, consume = false): CheckpointResult {
    const run = this.requireRun(runId);
    const queuedInstructions = [...this.store.instructions.values()].filter((instruction) => instruction.runId === runId && instruction.status === "queued");
    const unresolvedBlockingScopes = [...this.store.escalations.values()]
      .filter((e) => e.runId === runId && e.blocking && (e.status === "pending" || e.status === "calling"))
      .map((e) => e.scopeId);
    if (consume) this.acknowledgeInstructions(runId, queuedInstructions.map((instruction) => instruction.id));
    return { run, queuedInstructions, unresolvedBlockingScopes };
  }

  acknowledgeInstructions(runId: string, instructionIds: string[]): OwnerInstruction[] {
    const run = this.requireRun(runId);
    const uniqueIds = [...new Set(instructionIds)];
    const instructions = uniqueIds.map((id) => {
      const instruction = this.store.instructions.get(id);
      if (!instruction) throw new Error(`Unknown instruction: ${id}`);
      if (instruction.runId !== runId) throw new Error(`Instruction ${id} does not belong to run ${runId}`);
      return instruction;
    });
    const now = this.isoNow();
    return this.store.transaction(() => instructions.map((instruction) => {
      if (instruction.status === "consumed") return instruction;
      const consumed: OwnerInstruction = { ...instruction, status: "consumed", consumedAt: now };
      this.store.instructions.set(consumed.id, consumed);
      this.audit("owner_instruction_consumed", "agent", "Owner instruction acknowledged after safe-checkpoint incorporation", {
        runId, agentId: run.agentId, instructionId: consumed.id,
      }, { source: consumed.source, explicitAcknowledgement: true });
      return consumed;
    }));
  }

  enqueueInstruction(runId: string, text: string, source: OwnerInstruction["source"] = "api", callAttemptId?: string): OwnerInstruction {
    const run = this.requireRun(runId);
    return this.store.transaction(() => {
      const instruction: OwnerInstruction = { id: randomUUID(), runId, text, source, status: "queued", createdAt: this.isoNow() };
      this.store.instructions.set(instruction.id, instruction);
      this.audit("owner_instruction_queued", source === "callback" ? "owner" : "control_plane", "Owner instruction queued for next safe checkpoint", { runId, agentId: run.agentId, callAttemptId, instructionId: instruction.id }, { source });
      return instruction;
    });
  }

  getRun(runId: string): AgentRun { return this.requireRun(runId); }
  getEscalation(escalationId: string): Escalation { return this.requireEscalation(escalationId); }
  getCallAttempt(callAttemptId: string): CallAttempt { return this.requireCallAttempt(callAttemptId); }
  getDecision(escalationId: string): OwnerDecision | undefined {
    const escalation = this.requireEscalation(escalationId);
    return escalation.decisionId ? this.store.decisions.get(escalation.decisionId) : undefined;
  }

  listAuditEvents(runId: string, limit = 100): AuditEvent[] {
    this.requireRun(runId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Audit event limit must be an integer from 1 to 500");
    return [...this.store.auditEvents.values()].filter((event) => event.runId === runId).sort((left, right) => left.sequence - right.sequence).slice(-limit);
  }

  private async startEscalationCallIfAllowed(escalation: Escalation): Promise<Escalation> {
    if (escalation.callAttemptId || escalation.status !== "pending") return escalation;
    const run = this.requireRunningRun(escalation.runId);
    const owner = this.requireAgent(run.agentId);
    const decision = this.callPolicy.assessDecisionCall({ run, owner, priority: escalation.priority, now: this.clock.now(), attempts: this.store.callAttempts.values(), runs: this.store.runs, agents: this.store.agents });
    if (!decision.allowed) {
      if (decision.reason && escalation.deferredReason !== decision.reason) {
        return this.store.transaction(() => {
          const current = this.requireEscalation(escalation.id);
          if (current.callAttemptId || current.status !== "pending") return current;
          if (current.deferredReason === decision.reason) return current;
          const deferred = { ...current, deferredReason: decision.reason, updatedAt: this.isoNow() };
          this.store.escalations.set(deferred.id, deferred);
          this.audit("call_policy_deferred", "control_plane", "Owner call deferred by policy", { runId: deferred.runId, escalationId: deferred.id }, { reason: decision.reason, scopeId: deferred.scopeId, priority: deferred.priority });
          return deferred;
        });
      }
      return escalation;
    }
    const attempt = this.store.transaction(() => {
      const current = this.requireEscalation(escalation.id);
      if (current.callAttemptId || current.status !== "pending") return undefined;
      if (current.deferredReason) {
        this.audit("call_policy_released", "control_plane", "Deferred owner call became eligible", { runId: current.runId, escalationId: current.id }, { previousReason: current.deferredReason, scopeId: current.scopeId });
      }
      const reserved = this.persistCallAttempt("owner_decision", current.id, `Decision needed from the agent owner. Question: ${current.question}${current.context ? `\nContext: ${current.context}` : ""}`, `decision:${current.idempotencyKey}`, { runId: current.runId, escalationId: current.id, scopeId: current.scopeId });
      const calling: Escalation = { ...current, status: "calling", callAttemptId: reserved.id, deferredReason: undefined, updatedAt: this.isoNow() };
      this.store.escalations.set(calling.id, calling);
      return reserved;
    });
    if (!attempt) return this.requireEscalation(escalation.id);
    await this.dispatchCallAttempt(attempt);
    return this.requireEscalation(escalation.id);
  }

  private applyActiveObservation(
    attempt: CallAttempt,
    observation: Extract<CallProviderObservation, { status: "queued" | "in_progress" }>,
  ): CallAttempt {
    const current = this.requireCallAttempt(attempt.id);
    if (current.providerCallId !== observation.providerCallId) {
      throw new Error(`Provider observation id mismatch for call attempt ${current.id}`);
    }
    if (current.status !== "queued" && current.status !== "in_progress") return current;
    if (current.status === observation.status) return current;
    if (current.status === "in_progress" && observation.status === "queued") return current;

    const next: CallAttempt = { ...current, status: "in_progress", updatedAt: this.isoNow() };
    this.store.callAttempts.set(next.id, next);
    this.audit("call_attempt_progressed", "provider", "Phone provider reported call in progress", {
      runId: this.runIdForAttempt(next), callAttemptId: next.id,
    }, {
      purpose: next.purpose,
      provider: next.provider,
      priorStatus: current.status,
      status: next.status,
    });
    return next;
  }

  private applyTerminalOutcome(attempt: CallAttempt, outcome: CallOutcome): CallAttempt {
    const current = this.requireCallAttempt(attempt.id);
    if (outcome.status === "ambiguous") {
      if (current.status === "completed" || current.status === "failed") return current;
      return this.finishAttempt(current, "ambiguous");
    }

    const observedClaim = terminalOutcomeClaim(outcome);
    if (current.status === "completed" || current.status === "failed") {
      const existingClaim = this.store.terminalOutcomeClaims.get(current.id);
      if (existingClaim && !terminalClaimsMatch(existingClaim, observedClaim)) {
        this.auditTerminalConflictOnce(current, existingClaim, observedClaim);
      }
      return current;
    }

    const claimResult = this.store.claimCallTerminalOutcome(current.id, observedClaim);
    const authoritativeCurrent = this.requireCallAttempt(current.id);
    if (!claimResult.claimed) {
      if (!terminalClaimsMatch(claimResult.winner, observedClaim)) {
        this.auditTerminalConflictOnce(authoritativeCurrent, claimResult.winner, observedClaim);
      }
      if (authoritativeCurrent.status === "completed" || authoritativeCurrent.status === "failed") {
        return authoritativeCurrent;
      }
      throw new Error(`Terminal outcome claim exists without committed terminal state for call attempt ${current.id}`);
    }

    const finished = this.finishAttempt(authoritativeCurrent, outcome.status);
    if (authoritativeCurrent.purpose === "owner_decision") {
      const escalation = this.requireEscalation(authoritativeCurrent.correlationId);
      if (["resolved", "expired", "failed"].includes(escalation.status)) return finished;
      if (outcome.status === "failed") {
        const failed = { ...escalation, status: "failed" as const, updatedAt: this.isoNow() };
        this.store.escalations.set(failed.id, failed);
        return finished;
      }
      const decision: OwnerDecision = { id: randomUUID(), escalationId: escalation.id, answer: outcome.answer ?? "", structured: outcome.structured, createdAt: this.isoNow() };
      const winningDecisionId = this.store.bindDecisionToEscalation(escalation.id, decision.id);
      if (winningDecisionId !== decision.id) {
        const resolved = { ...escalation, status: "resolved" as const, decisionId: winningDecisionId, updatedAt: this.isoNow() };
        this.store.escalations.set(resolved.id, resolved);
        return finished;
      }
      this.store.decisions.set(decision.id, decision);
      const resolved = { ...escalation, status: "resolved" as const, decisionId: decision.id, updatedAt: this.isoNow() };
      this.store.escalations.set(resolved.id, resolved);
      this.audit("owner_decision_recorded", "owner", "Owner decision recorded and blocked scope released", { runId: escalation.runId, escalationId: escalation.id, callAttemptId: authoritativeCurrent.id }, { scopeId: escalation.scopeId, blocking: escalation.blocking, structured: Boolean(outcome.structured) });
      return finished;
    }
    if (outcome.status === "completed" && this.store.claimCallbackInstructionSet(authoritativeCurrent.id)) {
      for (const text of outcome.instructions ?? []) this.enqueueInstruction(authoritativeCurrent.correlationId, text, "callback", authoritativeCurrent.id);
    }
    return finished;
  }

  private auditTerminalConflictOnce(
    attempt: CallAttempt,
    winner: CallTerminalOutcomeClaim,
    observed: CallTerminalOutcomeClaim,
  ): void {
    const alreadyAudited = [...this.store.auditEvents.values()].some(
      (event) => event.type === "call_attempt_terminal_conflict" && event.callAttemptId === attempt.id,
    );
    if (alreadyAudited) return;
    this.audit(
      "call_attempt_terminal_conflict",
      "provider",
      "Conflicting terminal provider evidence ignored; first committed outcome remains authoritative",
      { runId: this.runIdForAttempt(attempt), callAttemptId: attempt.id },
      {
        winningStatus: winner.status,
        observedStatus: observed.status,
        payloadConflict: winner.fingerprint !== observed.fingerprint,
      },
    );
  }

  private async rehydrateProviderCallIfSupported(attempt: CallAttempt): Promise<void> {
    if (!this.calls.rehydrate || !attempt.providerCallId) return;
    if (attempt.status !== "queued" && attempt.status !== "in_progress") return;
    await this.calls.rehydrate({
      providerCallId: attempt.providerCallId,
      status: attempt.status,
      idempotencyKey: attempt.idempotencyKey,
      purpose: attempt.purpose,
      task: attempt.request.task,
      metadata: { ...attempt.request.metadata },
    });
  }

  private persistCallAttempt(
    purpose: CallAttempt["purpose"],
    correlationId: string,
    task: string,
    idempotencyKey: string,
    metadata: Record<string, string>,
    requestFingerprint?: string,
    attemptId = randomUUID(),
  ): CallAttempt {
    const now = this.isoNow();
    const attempt: CallAttempt = { id: attemptId, purpose, correlationId, provider: this.calls.name, status: "queued", idempotencyKey, requestFingerprint, request: { task, metadata: { ...metadata } }, createdAt: now, updatedAt: now };
    this.store.callAttempts.set(attempt.id, attempt);
    this.audit("call_attempt_created", "control_plane", "Phone call attempt persisted before provider side effect", { runId: this.runIdForAttempt(attempt), callAttemptId: attempt.id }, { purpose, provider: attempt.provider });
    return attempt;
  }

  private async dispatchCallAttempt(attempt: CallAttempt): Promise<CallAttempt> {
    let started: StartCallResult;
    try {
      started = await this.calls.start({ idempotencyKey: attempt.idempotencyKey, purpose: attempt.purpose, task: attempt.request.task, metadata: attempt.request.metadata });
    } catch (error) {
      const ambiguous: CallAttempt = { ...attempt, status: "ambiguous", lastError: providerSafeDiagnostic(error), updatedAt: this.isoNow() };
      this.store.callAttempts.set(ambiguous.id, ambiguous);
      this.audit("call_attempt_ambiguous", "control_plane", "Phone call outcome is ambiguous and will be safely reconciled", { runId: this.runIdForAttempt(ambiguous), callAttemptId: ambiguous.id }, { purpose: ambiguous.purpose, provider: ambiguous.provider });
      return ambiguous;
    }

    const next: CallAttempt = { ...attempt, providerCallId: started.providerCallId, status: started.status, updatedAt: this.isoNow() };
    this.store.callAttempts.set(next.id, next);
    this.audit("call_attempt_started", "provider", "Phone provider accepted call attempt", { runId: this.runIdForAttempt(next), callAttemptId: next.id }, { purpose: next.purpose, provider: next.provider, status: next.status });
    return next;
  }

  private async startCall(purpose: CallAttempt["purpose"], correlationId: string, task: string, idempotencyKey: string, metadata: Record<string, string>): Promise<CallAttempt> {
    return this.dispatchCallAttempt(this.persistCallAttempt(purpose, correlationId, task, idempotencyKey, metadata));
  }

  private finishAttempt(attempt: CallAttempt, status: "completed" | "failed" | "ambiguous"): CallAttempt {
    const next = { ...attempt, status, updatedAt: this.isoNow() };
    this.store.callAttempts.set(next.id, next);
    const type = status === "completed" ? "call_attempt_completed" : status === "failed" ? "call_attempt_failed" : "call_attempt_ambiguous";
    this.audit(type, status === "ambiguous" ? "control_plane" : "provider", `Phone call attempt ${status}`, { runId: this.runIdForAttempt(next), callAttemptId: next.id }, { purpose: next.purpose, provider: next.provider });
    return next;
  }

  private audit(type: AuditEvent["type"], actor: AuditActor, summary: string, refs: Pick<AuditEvent, "runId" | "agentId" | "escalationId" | "callAttemptId" | "instructionId"> = {}, details?: Record<string, unknown>): AuditEvent {
    let sequence = 1;
    for (const existing of this.store.auditEvents.values()) sequence = Math.max(sequence, existing.sequence + 1);
    const event: AuditEvent = { id: randomUUID(), sequence, type, actor, summary, ...refs, details, createdAt: this.isoNow() };
    this.store.auditEvents.set(event.id, event);
    return event;
  }

  private runIdForAttempt(attempt: CallAttempt): string | undefined {
    if (attempt.purpose === "owner_callback") return attempt.correlationId;
    return this.store.escalations.get(attempt.correlationId)?.runId ?? attempt.request.metadata.runId;
  }
  private requireAgent(id: string): AgentRegistration { const value = this.store.agents.get(id); if (!value) throw new Error(`Unknown agent: ${id}`); return value; }
  private requireRun(id: string): AgentRun { const value = this.store.runs.get(id); if (!value) throw new Error(`Unknown run: ${id}`); return value; }
  private requireRunningRun(id: string): AgentRun { const run = this.requireRun(id); if (run.status !== "running") throw new Error(`Run ${id} is not running`); return run; }
  private requireEscalation(id: string): Escalation { const value = this.store.escalations.get(id); if (!value) throw new Error(`Unknown escalation: ${id}`); return value; }
  private requireCallAttempt(id: string): CallAttempt { const value = this.store.callAttempts.get(id); if (!value) throw new Error(`Unknown call attempt: ${id}`); return value; }
  private isoNow(): string { return this.clock.now().toISOString(); }
}
