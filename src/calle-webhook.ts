import type { CallOutcome } from "./domain.js";

export interface CalleTerminalWebhook {
  eventId: string;
  providerCallId: string;
  outcome: CallOutcome;
}

/**
 * Parses CALL-E terminal webhook payloads into the provider-agnostic control-plane contract.
 *
 * CALL-E documents terminal webhook payloads with a top-level event `id` and the terminal
 * CallTask under `data`; the call task id is `data.id`. Non-terminal or malformed payloads
 * return null so an HTTP adapter can acknowledge/ignore them without mutating domain state.
 */
export function parseCalleTerminalWebhook(payload: unknown): CalleTerminalWebhook | null {
  if (!isRecord(payload) || typeof payload.id !== "string" || !isRecord(payload.data)) return null;

  const data = payload.data;
  if (typeof data.id !== "string" || !isTerminalStatus(data.status)) return null;

  const structured = isRecord(data.structured_result) ? data.structured_result : {};

  if (data.status === "failed" || data.status === "canceled") {
    return {
      eventId: payload.id,
      providerCallId: data.id,
      outcome: {
        status: "failed",
        providerCallId: data.id,
        structured: {
          failureCode: typeof data.failure_code === "string" ? data.failure_code : undefined,
          failureMessage: typeof data.failure_message === "string" ? data.failure_message : undefined,
        },
      },
    };
  }

  const answer = typeof structured.answer === "string"
    ? structured.answer
    : typeof data.summary === "string"
      ? data.summary
      : undefined;
  const instructions = Array.isArray(structured.instructions)
    ? structured.instructions.filter((value): value is string => typeof value === "string")
    : undefined;

  return {
    eventId: payload.id,
    providerCallId: data.id,
    outcome: {
      status: "completed",
      providerCallId: data.id,
      answer,
      instructions,
      structured,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalStatus(value: unknown): value is "completed" | "failed" | "canceled" {
  return value === "completed" || value === "failed" || value === "canceled";
}
