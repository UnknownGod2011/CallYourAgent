import { randomUUID } from "node:crypto";
import type { AuditEvent, CallAttempt, Escalation } from "./domain.js";
import type { ControlPlane, Clock } from "./control-plane.js";
import type { ControlPlaneStore } from "./store.js";

export interface LifecycleRecoveryConfig {
  maxAutomaticRecoveryAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface LifecycleSweepResult {
  escalationsVisited: number;
  callbacksVisited: number;
  recoveriesAttempted: number;
  recoveriesDeferred: number;
  recoveriesExhausted: number;
  errors: Array<{ kind: "escalation" | "callback"; id: string; message: string }>;
}

const systemClock: Clock = { now: () => new Date() };

export class LifecycleManager {
  private readonly maxAutomaticRecoveryAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly control: ControlPlane,
    private readonly store: ControlPlaneStore,
    private readonly clock: Clock = systemClock,
    config: LifecycleRecoveryConfig = {},
  ) {
    this.maxAutomaticRecoveryAttempts = nonNegativeInteger(config.maxAutomaticRecoveryAttempts ?? 3, "maxAutomaticRecoveryAttempts");
    this.baseBackoffMs = positiveInteger(config.baseBackoffMs ?? 5_000, "baseBackoffMs");
    this.maxBackoffMs = positiveInteger(config.maxBackoffMs ?? 60_000, "maxBackoffMs");
    if (this.maxBackoffMs < this.baseBackoffMs) throw new Error("maxBackoffMs must be >= baseBackoffMs");
  }

  async sweep(): Promise<LifecycleSweepResult> {
    const result: LifecycleSweepResult = {
      escalationsVisited: 0,
      callbacksVisited: 0,
      recoveriesAttempted: 0,
      recoveriesDeferred: 0,
      recoveriesExhausted: 0,
      errors: [],
    };

    const escalationIds = [...this.store.escalations.values()]
      .filter((item) => item.status === "pending" || item.status === "calling")
      .map((item) => item.id);

    for (const escalationId of escalationIds) {
      result.escalationsVisited += 1;
      try {
        const escalation = this.control.getEscalation(escalationId);
        if (escalation.callAttemptId) {
          const attempt = this.control.getCallAttempt(escalation.callAttemptId);
          if (attempt.status === "ambiguous") {
            const recovery = await this.recoverAmbiguous(attempt, result);
            if (!recovery.readyForReconcile) continue;
          }
        }
        await this.control.reconcileEscalation(escalationId);
      } catch (error) {
        result.errors.push({ kind: "escalation", id: escalationId, message: errorMessage(error) });
      }
    }

    const callbackIds = [...this.store.callAttempts.values()]
      .filter((attempt) => attempt.purpose === "owner_callback" && !["completed", "failed"].includes(attempt.status))
      .map((attempt) => attempt.id);

    for (const callAttemptId of callbackIds) {
      result.callbacksVisited += 1;
      try {
        const attempt = this.control.getCallAttempt(callAttemptId);
        if (attempt.status === "ambiguous") {
          const recovery = await this.recoverAmbiguous(attempt, result);
          if (!recovery.readyForReconcile) continue;
        }
        await this.control.reconcileCallback(callAttemptId);
      } catch (error) {
        result.errors.push({ kind: "callback", id: callAttemptId, message: errorMessage(error) });
      }
    }

    return result;
  }

  private async recoverAmbiguous(
    attempt: CallAttempt,
    result: LifecycleSweepResult,
  ): Promise<{ readyForReconcile: boolean }> {
    if (attempt.automaticRecoveryExhaustedAt) {
      result.recoveriesExhausted += 1;
      return { readyForReconcile: false };
    }

    const now = this.clock.now();
    if (attempt.nextAutomaticRecoveryAt && new Date(attempt.nextAutomaticRecoveryAt) > now) {
      result.recoveriesDeferred += 1;
      return { readyForReconcile: false };
    }

    const priorAttempts = attempt.automaticRecoveryAttempts ?? 0;
    if (priorAttempts >= this.maxAutomaticRecoveryAttempts) {
      this.markRecoveryExhausted(attempt);
      result.recoveriesExhausted += 1;
      return { readyForReconcile: false };
    }

    result.recoveriesAttempted += 1;
    const recovered = await this.control.recoverCallAttempt(attempt.id);
    const attemptNumber = priorAttempts + 1;

    if (recovered.status !== "ambiguous") {
      const updated: CallAttempt = {
        ...recovered,
        automaticRecoveryAttempts: attemptNumber,
        nextAutomaticRecoveryAt: undefined,
        automaticRecoveryExhaustedAt: undefined,
      };
      this.store.callAttempts.set(updated.id, updated);
      return { readyForReconcile: true };
    }

    if (attemptNumber >= this.maxAutomaticRecoveryAttempts) {
      this.markRecoveryExhausted({ ...recovered, automaticRecoveryAttempts: attemptNumber });
      result.recoveriesExhausted += 1;
      return { readyForReconcile: false };
    }

    const delayMs = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** (attemptNumber - 1));
    const nextAutomaticRecoveryAt = new Date(now.getTime() + delayMs).toISOString();
    const scheduled: CallAttempt = {
      ...recovered,
      automaticRecoveryAttempts: attemptNumber,
      nextAutomaticRecoveryAt,
      automaticRecoveryExhaustedAt: undefined,
    };
    this.store.callAttempts.set(scheduled.id, scheduled);
    this.auditRecovery("call_recovery_scheduled", scheduled, "Ambiguous phone-call recovery scheduled with bounded backoff", {
      attemptNumber,
      nextAutomaticRecoveryAt,
      delayMs,
    });
    return { readyForReconcile: false };
  }

  private markRecoveryExhausted(attempt: CallAttempt): void {
    if (attempt.automaticRecoveryExhaustedAt) return;
    const exhaustedAt = this.clock.now().toISOString();
    const exhausted: CallAttempt = {
      ...attempt,
      automaticRecoveryExhaustedAt: exhaustedAt,
      nextAutomaticRecoveryAt: undefined,
      updatedAt: exhaustedAt,
    };
    this.store.callAttempts.set(exhausted.id, exhausted);
    this.auditRecovery("call_recovery_exhausted", exhausted, "Automatic phone-call recovery exhausted; manual review required", {
      automaticRecoveryAttempts: exhausted.automaticRecoveryAttempts ?? 0,
      failClosed: true,
    });
  }

  private auditRecovery(
    type: "call_recovery_scheduled" | "call_recovery_exhausted",
    attempt: CallAttempt,
    summary: string,
    details: Record<string, unknown>,
  ): void {
    let sequence = 1;
    for (const existing of this.store.auditEvents.values()) sequence = Math.max(sequence, existing.sequence + 1);
    const escalation = attempt.purpose === "owner_decision"
      ? this.store.escalations.get(attempt.correlationId)
      : undefined;
    const event: AuditEvent = {
      id: randomUUID(),
      sequence,
      type,
      actor: "control_plane",
      runId: attempt.purpose === "owner_callback" ? attempt.correlationId : escalation?.runId ?? attempt.request.metadata.runId,
      escalationId: escalation?.id,
      callAttemptId: attempt.id,
      summary,
      details: { purpose: attempt.purpose, provider: attempt.provider, ...details },
      createdAt: this.clock.now().toISOString(),
    };
    this.store.auditEvents.set(event.id, event);
  }
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
