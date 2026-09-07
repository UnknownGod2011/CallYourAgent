import type { CallOutcome } from "./domain.js";
import type { CallProvider, StartCallInput, StartCallResult } from "./call-provider.js";

type FetchLike = typeof fetch;

type CalleStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

interface CalleCallTask {
  id: string;
  status: CalleStatus;
  structured_result: Record<string, unknown> | null;
  summary?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
}

export interface CalleCallProviderOptions {
  apiKey: string;
  ownerPhone: string;
  baseUrl?: string;
  webhookUrl?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const decisionSchema = {
  type: "object",
  required: ["answer"],
  properties: {
    answer: {
      type: "string",
      description: "The owner's direct answer to the agent's question, preserving important conditions or caveats.",
    },
  },
  additionalProperties: false,
} as const;

const callbackSchema = {
  type: "object",
  required: ["instructions"],
  properties: {
    instructions: {
      type: "array",
      description: "Concise action items or steering instructions the owner wants the running agent to consume at its next safe checkpoint.",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

export class CalleCallProvider implements CallProvider {
  readonly name = "call-e";
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: CalleCallProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("CALL-E API key is required");
    if (!options.ownerPhone.trim()) throw new Error("Owner phone is required");
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
      throw new Error("CALL-E request timeout must be a positive integer");
    }
    this.baseUrl = (options.baseUrl ?? "https://api.heycall-e.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async start(input: StartCallInput): Promise<StartCallResult> {
    const body = {
      task: input.task,
      recipients: [{ phones: [this.options.ownerPhone] }],
      result_schema: input.purpose === "owner_decision" ? decisionSchema : callbackSchema,
      metadata: input.metadata,
      ...(this.options.webhookUrl ? { webhook_url: this.options.webhookUrl } : {}),
    };

    const response = await this.fetchImpl(`${this.baseUrl}/v1/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`CALL-E create failed (${response.status}): ${await safeText(response)}`);
    }

    const call = await parseCall(response);
    if (call.status === "failed" || call.status === "canceled") {
      throw new Error(`CALL-E create returned terminal status ${call.status}`);
    }

    return {
      providerCallId: call.id,
      status: call.status === "completed" ? "completed" : call.status,
    };
  }

  async getOutcome(providerCallId: string): Promise<CallOutcome | null> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/calls/${encodeURIComponent(providerCallId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`CALL-E get failed (${response.status}): ${await safeText(response)}`);
    }

    const call = await parseCall(response);
    if (call.status === "queued" || call.status === "in_progress") return null;
    if (call.status === "failed" || call.status === "canceled") {
      return {
        status: "failed",
        providerCallId: call.id,
        structured: {
          failureCode: call.failure_code ?? undefined,
          failureMessage: call.failure_message ?? undefined,
        },
      };
    }

    const structured = call.structured_result ?? {};
    const answer = typeof structured.answer === "string" ? structured.answer : call.summary ?? undefined;
    const instructions = Array.isArray(structured.instructions)
      ? structured.instructions.filter((value): value is string => typeof value === "string")
      : undefined;

    return {
      status: "completed",
      providerCallId: call.id,
      answer,
      instructions,
      structured,
    };
  }
}

async function parseCall(response: Response): Promise<CalleCallTask> {
  const value: unknown = await response.json();
  if (!isRecord(value) || typeof value.id !== "string" || !isStatus(value.status)) {
    throw new Error("CALL-E returned an invalid call payload");
  }
  return {
    id: value.id,
    status: value.status,
    structured_result: isRecord(value.structured_result) ? value.structured_result : null,
    summary: typeof value.summary === "string" ? value.summary : null,
    failure_code: typeof value.failure_code === "string" ? value.failure_code : null,
    failure_message: typeof value.failure_message === "string" ? value.failure_message : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is CalleStatus {
  return value === "queued" || value === "in_progress" || value === "completed" || value === "failed" || value === "canceled";
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "unreadable response";
  }
}
