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

export interface FakeCallProviderOptions {
  /**
   * Status returned when the deterministic fake provider accepts a new call.
   * The default remains `queued`; tests may select `in_progress` to exercise
   * providers that begin dialing before the create response is returned.
   */
  initialStatus?: "queued" | "in_progress";
}

export class FakeCallProvider implements CallProvider {
  readonly name = "fake";
  private readonly calls = new Map<string, { id: string; outcome: CallOutcome | null }>();
  private readonly byIdempotencyKey = new Map<string, StartCallResult>();
  private readonly initialStatus: "queued" | "in_progress";

  constructor(options: FakeCallProviderOptions = {}) {
    this.initialStatus = options.initialStatus ?? "queued";
  }

  async start(input: StartCallInput): Promise<StartCallResult> {
    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) return { ...existing };

    const providerCallId = `fake_call_${this.calls.size + 1}`;
    const result: StartCallResult = { providerCallId, status: this.initialStatus };
    this.byIdempotencyKey.set(input.idempotencyKey, result);
    this.calls.set(providerCallId, { id: providerCallId, outcome: null });
    return { ...result };
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
