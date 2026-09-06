import { randomUUID } from "node:crypto";
import type {
  AgentRegistration,
  AgentRun,
  CallAttempt,
  CallbackRequest,
  CheckpointResult,
  Escalation,
  OwnerDecision,
  OwnerDecisionRequest,
  OwnerInstruction,
} from "./domain.js";
import type { CallProvider } from "./call-provider.js";
import type { ControlPlaneStore } from "./store.js";

export interface Clock {
  now(): Date;
}

const systemClock: Clock = { now: () => new Date() };

export class ControlPlane {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly calls: CallProvider,
    private readonly clock: Clock = systemClock,
  ) {}

  registerAgent(input: Omit<AgentRegistration, "id" | "createdAt">): AgentRegistration {
    const agent: AgentRegistration = { ...input, id: randomUUID(), createdAt: this.isoNow() };
    this.store.agents.set(agent.id, agent);
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
    return run;
  }

  heartbeat(runId: string, update: { summary?: string; currentScope?: string }): AgentRun {
    const run = this.requireRun(runId);
    if (run.status !== "running") throw new Error(`Run ${runId} is not running`);
    const next = { ...run, ...update, updatedAt: this.isoNow() };
    this.store.runs.set(runId, next);
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

    const attempt = await this.startCall(
      "owner_decision",
      escalation.id,
      `Decision needed from the agent owner. Question: ${input.question}${input.context ? `\nContext: ${input.context}` : ""}`,
      `decision:${input.idempotencyKey}`,
      { runId: input.runId, escalationId: escalation.id, scopeId: input.scopeId },
    );

    const next: Escalation = {
      ...escalation,
      status: "calling",
      callAttemptId: attempt.id,
      updatedAt: this.isoNow(),
    };
    this.store.escalations.set(next.id, next);
    return next;
  }

  async reconcileEscalation(escalationId: string): Promise<Escalation> {
    const escalation = this.requireEscalation(escalationId);
    if (["resolved", "expired", "failed"].includes(escalation.status)) return escalation;
    if (escalation.expiresAt && new Date(escalation.expiresAt) <= this.clock.now()) {
      const expired = { ...escalation, status: "expired" as const, updatedAt: this.isoNow() };
      this.store.escalations.set(expired.id, expired);
      return expired;
    }
    if (!escalation.callAttemptId) return escalation;

    let attempt = this.requireCallAttempt(escalation.callAttemptId);
    if (attempt.status === "ambiguous") attempt = await this.recoverCallAttempt(attempt.id);
    if (!attempt.providerCallId) return escalation;

    const outcome = await this.calls.getOutcome(attempt.providerCallId);
    if (!outcome) return escalation;
    this.finishAttempt(attempt, outcome.status);

    if (outcome.status === "failed" || outcome.status === "ambiguous") {
      const failed = { ...escalation, status: "failed" as const, updatedAt: this.isoNow() };
      this.store.escalations.set(failed.id, failed);
      return failed;
    }

    const decision: OwnerDecision = {
      id: randomUUID(),
      escalationId,
      answer: outcome.answer ?? "",
      structured: outcome.structured,
      createdAt: this.isoNow(),
    };
    this.store.decisions.set(decision.id, decision);
    const resolved = { ...escalation, status: "resolved" as const, decisionId: decision.id, updatedAt: this.isoNow() };
    this.store.escalations.set(resolved.id, resolved);
    return resolved;
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
    const finished = this.finishAttempt(attempt, outcome.status);
    if (outcome.status === "completed") {
      for (const text of outcome.instructions ?? []) this.enqueueInstruction(attempt.correlationId, text, "callback");
    }
    return finished;
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
      return recovered;
    } catch (error) {
      const stillAmbiguous: CallAttempt = {
        ...attempt,
        status: "ambiguous",
        lastError: errorMessage(error),
        updatedAt: this.isoNow(),
      };
      this.store.callAttempts.set(stillAmbiguous.id, stillAmbiguous);
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
      }
    }
    return { run, queuedInstructions, unresolvedBlockingScopes };
  }

  enqueueInstruction(runId: string, text: string, source: OwnerInstruction["source"] = "api"): OwnerInstruction {
    this.requireRun(runId);
    const instruction: OwnerInstruction = {
      id: randomUUID(),
      runId,
      text,
      source,
      status: "queued",
      createdAt: this.isoNow(),
    };
    this.store.instructions.set(instruction.id, instruction);
    return instruction;
  }

  getDecision(escalationId: string): OwnerDecision | undefined {
    const escalation = this.requireEscalation(escalationId);
    return escalation.decisionId ? this.store.decisions.get(escalation.decisionId) : undefined;
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

    try {
      const started = await this.calls.start({ idempotencyKey, purpose, task, metadata });
      const next: CallAttempt = {
        ...attempt,
        providerCallId: started.providerCallId,
        status: started.status,
        updatedAt: this.isoNow(),
      };
      this.store.callAttempts.set(next.id, next);
      return next;
    } catch (error) {
      const ambiguous: CallAttempt = {
        ...attempt,
        status: "ambiguous",
        lastError: errorMessage(error),
        updatedAt: this.isoNow(),
      };
      this.store.callAttempts.set(ambiguous.id, ambiguous);
      return ambiguous;
    }
  }

  private finishAttempt(attempt: CallAttempt, status: "completed" | "failed" | "ambiguous"): CallAttempt {
    const next = { ...attempt, status, updatedAt: this.isoNow() };
    this.store.callAttempts.set(next.id, next);
    return next;
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
