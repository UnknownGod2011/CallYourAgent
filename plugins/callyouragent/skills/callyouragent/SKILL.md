---
name: callyouragent
description: Use CallYourAgent to request an owner decision or callback during autonomous work, while preserving unrelated work and consuming instructions only at safe checkpoints.
---

Use the configured CallYourAgent MCP tools only for genuine human judgment, progress callbacks, or durable owner steering.

1. Register the agent and start a run before requesting an escalation.
2. Report a compact status update after meaningful work units.
3. When a single scope needs a decision, call `request_owner_decision` with a stable `scopeId` and idempotency key. Set `blocking=true` only when that exact scope cannot safely proceed. Continue unrelated scopes.
4. Do not claim an owner instruction interrupts an in-progress generation. At explicit safe work boundaries, call `checkpoint` with `consume=false`.
5. Incorporate only the instructions returned by that checkpoint, then call `acknowledge_owner_instructions` with exactly the instruction IDs used.
6. Use `request_owner_callback` when the owner asks to hear progress or wants a phone conversation. Treat returned steering as queued state for the next checkpoint.
7. Keep provider keys, the owner token, phone numbers, transcripts, and decision content out of code, logs, and agent-facing configuration.

If CallYourAgent tools are not configured, direct the user to the deployed instance's `/connect` page. Do not invent a phone call or an answered decision.
