import type { OwnerInstruction } from "./domain.js";
import type { ControlPlaneStore } from "./store.js";

export interface InstructionConsumeResult {
  instruction: OwnerInstruction;
  consumed: boolean;
}

/**
 * Consume one instruction only if it is still queued. The returned instruction
 * is an isolated snapshot, and stale consumers receive the durable winner.
 * Callers should wrap this helper in store.transaction when combining it with
 * audit publication or other mutations.
 */
export function consumeInstructionIfQueued(
  store: ControlPlaneStore,
  instructionId: string,
  consumedAt: string,
): InstructionConsumeResult {
  const current = store.instructions.get(instructionId);
  if (!current) throw new Error(`Unknown instruction: ${instructionId}`);
  if (current.status !== "queued") return { instruction: structuredClone(current), consumed: false };

  const consumed: OwnerInstruction = {
    ...current,
    status: "consumed",
    consumedAt,
  };
  store.instructions.set(instructionId, consumed);
  return { instruction: structuredClone(consumed), consumed: true };
}
