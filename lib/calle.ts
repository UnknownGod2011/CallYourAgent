const DEFAULT_BASE_URL = "https://api.heycall-e.com";

type CalleStatus = "queued" | "ringing" | "in_progress" | "completed" | "failed" | "cancelled" | "canceled";

export interface CalleCall {
  id: string;
  status: CalleStatus;
  summary?: string | null;
  transcript?: string | null;
  structured_result?: Record<string, unknown> | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
}

function config() {
  const apiKey = process.env.CALLE_API_KEY?.trim();
  if (!apiKey) throw new Error("Call provider is not configured.");
  const baseUrl = (process.env.CALLE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  if (!baseUrl.startsWith("https://")) throw new Error("Call provider configuration is invalid.");
  return { apiKey, baseUrl };
}

async function request(path: string, init: RequestInit) {
  const { apiKey, baseUrl } = config();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("Call provider timed out.");
    throw new Error("Call provider could not be reached.");
  }
  if (!response.ok) throw new Error(`Call provider request failed (${response.status}).`);
  const payload: unknown = await response.json();
  if (!isCall(payload)) throw new Error("Call provider returned an invalid response.");
  return payload;
}

export async function startCalleCall(input: { task: string; phoneNumber: string; idempotencyKey: string; metadata: Record<string, string> }) {
  return request("/v1/calls", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      task: input.task,
      recipients: [{ phones: [input.phoneNumber] }],
      result_schema: {
        type: "object",
        required: ["outcome", "summary"],
        properties: {
          outcome: { type: "string", description: "The concrete outcome of the call." },
          summary: { type: "string", description: "A concise, factual summary for the user." },
          next_steps: { type: "array", items: { type: "string" }, description: "Any agreed follow-up actions." },
        },
        additionalProperties: false,
      },
      metadata: input.metadata,
    }),
  });
}

export async function getCalleCall(calleCallId: string) {
  return request(`/v1/calls/${encodeURIComponent(calleCallId)}`, { method: "GET" });
}

export function isTerminal(status: string) { return status === "completed" || status === "failed" || status === "cancelled" || status === "canceled"; }
export function toAppStatus(status: string): "queued" | "ringing" | "in_progress" | "completed" | "failed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "ringing") return "ringing";
  if (status === "in_progress") return "in_progress";
  return "queued";
}

function isCall(value: unknown): value is CalleCall {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).id === "string"
    && typeof (value as Record<string, unknown>).status === "string";
}
