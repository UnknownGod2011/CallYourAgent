import type { CallOutcome } from "./domain.js";

export interface StartCallInput {
  idempotencyKey: string;
  purpose: "owner_decision" | "owner_callback";
  task: string;
  metadata: Record<string, string>;
}

export interface StartCallResult {
  providerCallId: string;
  status: "queued" | "in_progress" | "completed";
}

export interface CallProvider {
  readonly name: string;
  start(input: StartCallInput): Promise<StartCallResult>;
  getOutcome(providerCallId: string): Promise<CallOutcome | null>;
}

export class FakeCallProvider implements CallProvider {
  readonly name = "fake";
  private readonly calls = new Map<string, { id: string; outcome: CallOutcome | null }>();
  private readonly byIdempotencyKey = new Map<string, string>();

  async start(input: StartCallInput): Promise<StartCallResult> {
    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) return { providerCallId: existing, status: "queued" };

    const providerCallId = `fake_call_${this.calls.size + 1}`;
    this.byIdempotencyKey.set(input.idempotencyKey, providerCallId);
    this.calls.set(providerCallId, { id: providerCallId, outcome: null });
    return { providerCallId, status: "queued" };
  }

  async getOutcome(providerCallId: string): Promise<CallOutcome | null> {
    return this.calls.get(providerCallId)?.outcome ?? null;
  }

  complete(providerCallId: string, outcome: CallOutcome): void {
    const call = this.calls.get(providerCallId);
    if (!call) throw new Error(`Unknown fake call: ${providerCallId}`);
    call.outcome = outcome;
  }
}
