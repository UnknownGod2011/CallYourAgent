import type { AgentRun, OwnerInstruction } from "./domain.js";
import { consumeInstructionIfQueued } from "./instruction-consume.js";
import type { ControlPlaneStore } from "./store.js";

export interface CheckpointRuntimeResult {
  run: AgentRun;
  queuedInstructions: OwnerInstruction[];
  unresolvedBlockingScopes: string[];
  consumedInstructions: OwnerInstruction[];
}

/**
 * Runtime-facing safe-checkpoint operation. It snapshots queued instructions
 * before optional consumption and only marks each instruction consumed through
 * the conditional queue primitive. Callers should wrap this function in the
 * store transaction used for audit publication when they need an atomic
 * checkpoint-plus-audit boundary.
 */
export function applyCheckpointAtRuntime(
  store: ControlPlaneStore,
  run: AgentRun,
  consume: boolean,
  consumedAt: string,
): CheckpointRuntimeResult {
  const queuedInstructions = [...store.instructions.values()]
    .filter((instruction) => instruction.runId === run.id && instruction.status === "queued")
    .map((instruction) => structuredClone(instruction));
  const unresolvedBlockingScopes = [...store.escalations.values()]
    .filter((escalation) => escalation.runId === run.id && escalation.blocking && (escalation.status === "pending" || escalation.status === "calling"))
    .map((escalation) => escalation.scopeId);

  const consumedInstructions = consume
    ? queuedInstructions.flatMap((instruction) => {
      const result = consumeInstructionIfQueued(store, instruction.id, consumedAt);
      return result.consumed ? [result.instruction] : [];
    })
    : [];

  return {
    run: structuredClone(run),
    queuedInstructions,
    unresolvedBlockingScopes,
    consumedInstructions,
  };
}
