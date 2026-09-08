import type { CallAttempt, Id, IsoDate } from "./domain.js";

export interface OwnerCallbackView {
  id: Id;
  runId: Id;
  status: CallAttempt["status"];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/**
 * Privacy-safe owner/browser projection of an internally replayable callback attempt.
 *
 * CallAttempt intentionally persists provider correlation, idempotency and the exact
 * phone task/metadata for safe recovery. Those fields are server-side recovery state
 * and must not cross the ordinary owner/read HTTP boundary.
 */
export function toOwnerCallbackView(attempt: CallAttempt): OwnerCallbackView {
  if (attempt.purpose !== "owner_callback") throw new Error(`Call attempt ${attempt.id} is not an owner callback`);
  return {
    id: attempt.id,
    runId: attempt.correlationId,
    status: attempt.status,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}
