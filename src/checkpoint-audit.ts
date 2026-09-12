import type { AgentRun, OwnerInstruction } from "./domain.js";

export interface CheckpointInstructionAuditPayload {
  runId: string;
  instructionIds: string[];
  count: number;
}

/**
 * Builds the audit payload for a safe-checkpoint instruction acknowledgement.
 * Only instructions that actually transitioned to `consumed` belong here;
 * replayed or losing consumers must not emit a duplicate acknowledgement.
 */
export function checkpointInstructionAuditPayload(
  run: AgentRun,
  consumedInstructions: OwnerInstruction[],
): CheckpointInstructionAuditPayload | undefined {
  if (consumedInstructions.length === 0) return undefined;
  return {
    runId: run.id,
    instructionIds: consumedInstructions.map((instruction) => instruction.id),
    count: consumedInstructions.length,
  };
}
