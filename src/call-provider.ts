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

export type CallProviderObservation =
  | { providerCallId: string; status: "queued" | "in_progress" }
  | CallOutcome;

export interface CallProvider {
  readonly name: string;
  start(input: StartCallInput): Promise<StartCallResult>;
  observe(providerCallId: string): Promise<CallProviderObservation>;
  /**
   * Compatibility helper for integrations that only care about terminal evidence.
   * New reconciliation code should prefer `observe` so active provider progress is
   * not collapsed into `null`.
   */
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

interface FakeCallState {
  id: string;
  status: "queued" | "in_progress";
  outcome: CallOutcome | null;
}

export class FakeCallProvider implements CallProvider {
  readonly name = "fake";
  private readonly calls = new Map<string, FakeCallState>();
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
    this.calls.set(providerCallId, { id: providerCallId, status: this.initialStatus, outcome: null });
    return { ...result };
  }

  async observe(providerCallId: string): Promise<CallProviderObservation> {
    const call = this.calls.get(providerCallId);
    if (!call) throw new Error(`Unknown fake call: ${providerCallId}`);
    if (call.outcome) return { ...call.outcome };
    return { providerCallId: call.id, status: call.status };
  }

  async getOutcome(providerCallId: string): Promise<CallOutcome | null> {
    const observation = await this.observe(providerCallId);
    return observation.status === "queued" || observation.status === "in_progress" ? null : observation;
  }

  progress(providerCallId: string): void {
    const call = this.calls.get(providerCallId);
    if (!call) throw new Error(`Unknown fake call: ${providerCallId}`);
    if (call.outcome) throw new Error(`Fake call is already terminal: ${providerCallId}`);
    call.status = "in_progress";
  }

  complete(providerCallId: string, outcome: CallOutcome): void {
    const call = this.calls.get(providerCallId);
    if (!call) throw new Error(`Unknown fake call: ${providerCallId}`);
    call.outcome = outcome;
  }
}
