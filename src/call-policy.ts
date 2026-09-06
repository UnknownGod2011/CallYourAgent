import type { AgentRegistration, AgentRun, CallAttempt, EscalationPriority } from "./domain.js";

export interface QuietHoursConfig {
  startHour: number;
  endHour: number;
  timeZone: string;
  bypassPriority?: EscalationPriority;
}

export interface CallPolicyConfig {
  minimumDecisionPriority?: EscalationPriority;
  maxDecisionCallsPerRun?: number;
  maxDecisionCallsPerOwner24h?: number;
  quietHours?: QuietHoursConfig;
}

export interface DecisionCallPolicyContext {
  run: AgentRun;
  owner: AgentRegistration;
  priority: EscalationPriority;
  now: Date;
  attempts: Iterable<CallAttempt>;
  runs: ReadonlyMap<string, AgentRun>;
  agents: ReadonlyMap<string, AgentRegistration>;
}

export interface CallPolicyDecision {
  allowed: boolean;
  reason?: "below_priority_gate" | "quiet_hours" | "run_budget_exhausted" | "owner_budget_exhausted";
}

const PRIORITY_RANK: Record<EscalationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

export class CallPolicy {
  constructor(private readonly config: CallPolicyConfig = {}) {
    validateConfig(config);
  }

  assessDecisionCall(context: DecisionCallPolicyContext): CallPolicyDecision {
    const minimum = this.config.minimumDecisionPriority ?? "normal";
    if (PRIORITY_RANK[context.priority] < PRIORITY_RANK[minimum]) {
      return { allowed: false, reason: "below_priority_gate" };
    }

    if (this.config.quietHours && this.isQuietHours(context.now, this.config.quietHours)) {
      const bypass = this.config.quietHours.bypassPriority ?? "critical";
      if (PRIORITY_RANK[context.priority] < PRIORITY_RANK[bypass]) {
        return { allowed: false, reason: "quiet_hours" };
      }
    }

    const decisionAttempts = [...context.attempts].filter(
      (attempt) => attempt.purpose === "owner_decision" && countsTowardBudget(attempt),
    );

    if (this.config.maxDecisionCallsPerRun !== undefined) {
      const runCalls = decisionAttempts.filter((attempt) => attempt.request.metadata.runId === context.run.id).length;
      if (runCalls >= this.config.maxDecisionCallsPerRun) {
        return { allowed: false, reason: "run_budget_exhausted" };
      }
    }

    if (this.config.maxDecisionCallsPerOwner24h !== undefined) {
      const cutoff = context.now.getTime() - 24 * 60 * 60 * 1000;
      const ownerCalls = decisionAttempts.filter((attempt) => {
        if (new Date(attempt.createdAt).getTime() < cutoff) return false;
        const runId = attempt.request.metadata.runId;
        const run = runId ? context.runs.get(runId) : undefined;
        const agent = run ? context.agents.get(run.agentId) : undefined;
        return agent?.ownerId === context.owner.ownerId;
      }).length;
      if (ownerCalls >= this.config.maxDecisionCallsPerOwner24h) {
        return { allowed: false, reason: "owner_budget_exhausted" };
      }
    }

    return { allowed: true };
  }

  private isQuietHours(now: Date, config: QuietHoursConfig): boolean {
    const hour = zonedHour(now, config.timeZone);
    if (config.startHour === config.endHour) return true;
    if (config.startHour < config.endHour) return hour >= config.startHour && hour < config.endHour;
    return hour >= config.startHour || hour < config.endHour;
  }
}

function countsTowardBudget(attempt: CallAttempt): boolean {
  return attempt.status !== "failed" || Boolean(attempt.providerCallId);
}

function zonedHour(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (!Number.isInteger(hour)) throw new Error(`Could not determine hour for timezone ${timeZone}`);
  return hour;
}

function validateConfig(config: CallPolicyConfig): void {
  for (const [name, value] of [
    ["maxDecisionCallsPerRun", config.maxDecisionCallsPerRun],
    ["maxDecisionCallsPerOwner24h", config.maxDecisionCallsPerOwner24h],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }

  if (config.quietHours) {
    for (const [name, value] of [
      ["quietHours.startHour", config.quietHours.startHour],
      ["quietHours.endHour", config.quietHours.endHour],
    ] as const) {
      if (!Number.isInteger(value) || value < 0 || value > 23) throw new Error(`${name} must be an hour from 0 to 23`);
    }
    // Fail during startup rather than on the first escalation if the timezone is invalid.
    zonedHour(new Date(0), config.quietHours.timeZone);
  }
}
