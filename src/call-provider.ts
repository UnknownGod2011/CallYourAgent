import { createHash } from "node:crypto";
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

export interface RehydrateCallInput extends StartCallInput {
  providerCallId: string;
  status: "queued" | "in_progress";
}

export type ActiveCallObservation =
  | { providerCallId: string; status: "queued" }
  | { providerCallId: string; status: "in_progress" };

export type CallProviderObservation = ActiveCallObservation | CallOutcome;

export function isActiveCallObservation(observation: CallProviderObservation): observation is ActiveCallObservation {
  return observation.status === "queued" || observation.status === "in_progress";
}

export interface CallProvider {
  readonly name: string;
  start(input: StartCallInput): Promise<StartCallResult>;
  observe(providerCallId: string): Promise<CallProviderObservation>;
  /**
   * Optional provider-local restoration hook for adapters whose active-call state is
   * intentionally process-local. The control plane supplies only state it already
   * persisted before the restart. Real remote providers normally do not need this.
   */
  rehydrate?(input: RehydrateCallInput): Promise<void> | void;
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
  /**
   * Optional deployment/demo mode that makes an accepted fake call terminal after
   * this many provider observations. It is disabled by default, so existing tests
   * retain explicit control through `progress`/`complete`.
   *
   * This exists so a separately running HTTP/container deployment can exercise the
   * complete fake-provider lifecycle without exposing a fake-provider mutation API.
   */
  autoCompleteAfterObservations?: number;
}

interface FakeCallState {
  id: string;
  purpose: StartCallInput["purpose"];
  status: "queued" | "in_progress";
  outcome: CallOutcome | null;
  observations: number;
}

function fakeProviderCallId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey, "utf8").digest("hex").slice(0, 24);
  return `fake_call_${digest}`;
}

export class FakeCallProvider implements CallProvider {
  readonly name = "fake";
  private readonly calls = new Map<string, FakeCallState>();
  private readonly byIdempotencyKey = new Map<string, StartCallResult>();
  private readonly initialStatus: "queued" | "in_progress";
  private readonly autoCompleteAfterObservations?: number;

  constructor(options: FakeCallProviderOptions = {}) {
    this.initialStatus = options.initialStatus ?? "queued";
    if (options.autoCompleteAfterObservations !== undefined) {
      if (!Number.isInteger(options.autoCompleteAfterObservations) || options.autoCompleteAfterObservations < 1) {
        throw new Error("FakeCallProvider autoCompleteAfterObservations must be a positive integer");
      }
      this.autoCompleteAfterObservations = options.autoCompleteAfterObservations;
    }
  }

  async start(input: StartCallInput): Promise<StartCallResult> {
    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) return { ...existing };

    const providerCallId = fakeProviderCallId(input.idempotencyKey);
    const result: StartCallResult = { providerCallId, status: this.initialStatus };
    this.byIdempotencyKey.set(input.idempotencyKey, result);
    this.calls.set(providerCallId, {
      id: providerCallId,
      purpose: input.purpose,
      status: this.initialStatus,
      outcome: null,
      observations: 0,
    });
    return { ...result };
  }

  rehydrate(input: RehydrateCallInput): void {
    const expectedProviderCallId = fakeProviderCallId(input.idempotencyKey);
    if (input.providerCallId !== expectedProviderCallId) {
      throw new Error(`Fake call id does not match persisted idempotency key: ${input.providerCallId}`);
    }

    const existingByKey = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existingByKey && existingByKey.providerCallId !== input.providerCallId) {
      throw new Error(`Fake idempotency key already maps to another call: ${input.idempotencyKey}`);
    }

    const existingCall = this.calls.get(input.providerCallId);
    if (existingCall) {
      if (existingCall.purpose !== input.purpose) {
        throw new Error(`Fake call purpose mismatch for ${input.providerCallId}`);
      }
      return;
    }

    const result: StartCallResult = {
      providerCallId: input.providerCallId,
      status: input.status,
    };
    this.byIdempotencyKey.set(input.idempotencyKey, result);
    this.calls.set(input.providerCallId, {
      id: input.providerCallId,
      purpose: input.purpose,
      status: input.status,
      outcome: null,
      observations: 0,
    });
  }

  async observe(providerCallId: string): Promise<CallProviderObservation> {
    const call = this.calls.get(providerCallId);
    if (!call) throw new Error(`Unknown fake call: ${providerCallId}`);
    if (call.outcome) return { ...call.outcome };

    call.observations += 1;
    if (this.autoCompleteAfterObservations !== undefined && call.observations >= this.autoCompleteAfterObservations) {
      call.outcome = this.deterministicOutcome(call);
      return { ...call.outcome };
    }

    return call.status === "queued"
      ? { providerCallId: call.id, status: "queued" }
      : { providerCallId: call.id, status: "in_progress" };
  }

  async getOutcome(providerCallId: string): Promise<CallOutcome | null> {
    const observation = await this.observe(providerCallId);
    return isActiveCallObservation(observation) ? null : observation;
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

  private deterministicOutcome(call: FakeCallState): CallOutcome {
    if (call.purpose === "owner_decision") {
      return {
        providerCallId: call.id,
        status: "completed",
        answer: "Proceed with the requested scope.",
        structured: { decision: "proceed", source: "deterministic_fake_provider" },
      };
    }
    return {
      providerCallId: call.id,
      status: "completed",
      instructions: ["Continue the current plan and report progress at the next safe checkpoint."],
      structured: { source: "deterministic_fake_provider" },
    };
  }
}
