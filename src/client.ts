import type {
  AgentRegistration,
  AgentRun,
  AuditEvent,
  CheckpointResult,
  Escalation,
  EscalationPriority,
  OwnerDecision,
  OwnerDecisionRequest,
  OwnerInstruction,
} from "./domain.js";
import type { OwnerCallbackView } from "./callback-view.js";
import type { EscalationLifecycleView } from "./escalation-view.js";
import type { CredentialCapabilities } from "./http-server.js";
import type { RunOverview } from "./run-overview.js";

export interface CallYourAgentClientOptions {
  baseUrl: string;
  apiToken: string;
  fetch?: typeof globalThis.fetch;
}

export interface RegisterAgentInput {
  name: string;
  platform: string;
  ownerId: string;
}

export interface StartRunInput {
  agentId: string;
  summary: string;
  currentScope?: string;
}

export interface HeartbeatInput {
  summary?: string;
  currentScope?: string;
}

export interface EscalationStatusResult {
  escalation: Escalation;
  decision: OwnerDecision | null;
}

export interface RequestCallbackInput {
  runId: string;
  idempotencyKey: string;
  prompt?: string;
}

export class CallYourAgentHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "CallYourAgentHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Thin typed client for the CallYourAgent control-plane HTTP API.
 *
 * This class intentionally contains no agent business logic. Platform adapters
 * (MCP, Claude Code, Codex, custom workers) should depend on this stable client
 * instead of duplicating authorization, URL construction, or response parsing.
 */
export class CallYourAgentClient {
  readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: CallYourAgentClientOptions) {
    if (!options.baseUrl.trim()) throw new Error("baseUrl is required");
    if (!options.apiToken.trim()) throw new Error("apiToken is required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("fetch implementation is required");
  }

  async health(): Promise<{ ok: boolean }> {
    return this.request("GET", "/health", undefined, false);
  }

  async getCredentialCapabilities(): Promise<CredentialCapabilities> {
    return this.request("GET", "/v1/auth/capabilities");
  }

  async registerAgent(input: RegisterAgentInput): Promise<AgentRegistration> {
    return this.request("POST", "/v1/agents", input);
  }

  async startRun(input: StartRunInput): Promise<AgentRun> {
    return this.request("POST", "/v1/runs", input);
  }

  async getRun(runId: string): Promise<AgentRun> {
    return this.request("GET", `/v1/runs/${encodeURIComponent(runId)}`);
  }

  async getRunOverview(runId: string): Promise<RunOverview> {
    return this.request("GET", `/v1/runs/${encodeURIComponent(runId)}/overview`);
  }

  async getAuditTimeline(runId: string, limit = 100): Promise<AuditEvent[]> {
    const result = await this.request<{ events: AuditEvent[] }>(
      "GET",
      `/v1/runs/${encodeURIComponent(runId)}/audit?limit=${encodeURIComponent(String(limit))}`,
    );
    return result.events;
  }

  async reportStatus(runId: string, input: HeartbeatInput): Promise<AgentRun> {
    return this.request("POST", `/v1/runs/${encodeURIComponent(runId)}/heartbeat`, input);
  }

  async checkpoint(runId: string, consume = false): Promise<CheckpointResult> {
    return this.request("POST", `/v1/runs/${encodeURIComponent(runId)}/checkpoint`, { consume });
  }

  async acknowledgeInstructions(runId: string, instructionIds: string[]): Promise<OwnerInstruction[]> {
    const result = await this.request<{ instructions: OwnerInstruction[] }>(
      "POST",
      `/v1/runs/${encodeURIComponent(runId)}/instructions/ack`,
      { instructionIds },
    );
    return result.instructions;
  }

  async requestOwnerDecision(input: OwnerDecisionRequest): Promise<Escalation> {
    return this.request("POST", "/v1/escalations", input);
  }

  async getEscalationLifecycleStatus(escalationId: string): Promise<EscalationLifecycleView> {
    return this.request("GET", `/v1/escalations/${encodeURIComponent(escalationId)}/status`);
  }

  async getEscalationStatus(escalationId: string): Promise<EscalationStatusResult> {
    return this.request("GET", `/v1/escalations/${encodeURIComponent(escalationId)}`);
  }

  async reconcileEscalation(escalationId: string): Promise<EscalationLifecycleView> {
    return this.request("POST", `/v1/escalations/${encodeURIComponent(escalationId)}/reconcile`, {});
  }

  async requestOwnerCallback(input: RequestCallbackInput): Promise<OwnerCallbackView> {
    return this.request("POST", "/v1/callbacks", input);
  }

  async getCallback(callbackId: string): Promise<OwnerCallbackView> {
    return this.request("GET", `/v1/callbacks/${encodeURIComponent(callbackId)}`);
  }

  async reconcileCallback(callbackId: string): Promise<OwnerCallbackView> {
    return this.request("POST", `/v1/callbacks/${encodeURIComponent(callbackId)}/reconcile`, {});
  }

  /** Convenience overload that keeps adapter code from importing the full request type. */
  async escalate(input: {
    runId: string;
    scopeId: string;
    question: string;
    context?: string;
    blocking: boolean;
    priority?: EscalationPriority;
    expiresAt?: string;
    idempotencyKey: string;
  }): Promise<Escalation> {
    return this.requestOwnerDecision(input);
  }

  private async request<T>(method: string, path: string, body?: unknown, authenticated = true): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (authenticated) headers.authorization = `Bearer ${this.apiToken}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try { parsed = JSON.parse(text); }
      catch { parsed = text; }
    }

    if (!response.ok) {
      const message =
        typeof parsed === "object" && parsed !== null && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `CallYourAgent request failed with HTTP ${response.status}`;
      throw new CallYourAgentHttpError(response.status, message, parsed);
    }

    return parsed as T;
  }
}
