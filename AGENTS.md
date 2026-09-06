# AGENTS.md

## Mission

Build CallYourAgent as a real, cross-platform human-escalation layer for autonomous AI agents.

The non-negotiable product core is:

1. An AI agent can call its owner through CALL-E when an important decision, clarification, or approval genuinely requires human judgment.
2. The owner can request a voice callback to ask an active agent for progress, ask questions, or provide new instructions.
3. The voice interaction must not unnecessarily stop unrelated agent work. Blocking applies only to the affected task branch/scope when possible.
4. Human answers and steering instructions must become durable structured state consumed by the agent at safe checkpoints. Never pretend to inject instructions into an in-flight token generation.
5. The system must be designed to integrate with Claude/Claude Code, Codex, ChatGPT/ChatGPT Work/automations where current platform capabilities allow, and generic custom agents.
6. MCP is an integration surface, not the whole product. The core must also expose stable HTTP/SDK contracts so platform-specific adapters can be added without redesigning the backend.

## Mandatory workflow for every coding run

Before changing code:

1. Inspect the entire repository tree and current architecture.
2. Read this file in full.
3. Read `progress.md` in full.
4. Read all architecture/integration docs that exist.
5. Inspect recent commits and any relevant issues/PRs.
6. Identify the smallest high-value coherent increment that advances a working end-to-end product.
7. Preserve existing working behavior unless a change is intentionally documented.

After changing code:

1. Run all relevant tests, typechecks, lint, and build checks available in the repo.
2. Fix regressions where possible.
3. Update `progress.md` with:
   - what was inspected,
   - what changed,
   - exact verification performed,
   - current blockers,
   - best next actions.
4. Commit only coherent working changes.
5. Do not claim unsupported platform capabilities or successful live CALL-E behavior without evidence.

## Architecture principles

- Persistent backend/control plane owns agent registrations, runs, escalation state, owner decisions, instruction queues, policies, and call records.
- CALL-E is the phone transport, not the source of truth.
- Keep `CALLE_API_KEY` server-side only.
- Use idempotency for every real-world call side effect.
- Build and maintain a deterministic fake CALL-E provider so the full flow can be tested without credentials or credits.
- Prefer explicit state machines over implicit prompt behavior.
- Separate blocking vs non-blocking escalations.
- Use branch/scope identifiers so one blocked branch does not freeze unrelated work.
- Incoming human instructions are queued and consumed at safe checkpoints.
- Support deduplication, quiet hours, call budgets, retry bounds, and clear auditability.
- Fail closed on ambiguous provider outcomes that could create duplicate calls.
- Avoid storing unnecessary phone transcripts or sensitive content.
- Keep integration adapters thin; platform-specific limitations belong in adapters/docs, not in the core domain model.

## Initial target interfaces

Core API concepts should include equivalents of:

- `register_agent`
- `heartbeat/report_status`
- `request_owner_decision`
- `get_escalation_status`
- `checkpoint/pull_owner_instructions`
- `request_owner_callback_to_agent`
- `complete_callback_session`

Names may evolve, but the semantics above must remain represented.

## Integration targets

### Claude / Claude Code
Prefer MCP plus hooks/adapter patterns where supported. Build one real, testable path before adding broad claims.

### Codex
Use an adapter/checkpoint model compatible with Codex workflows where supported. Do not claim mid-generation interruption.

### ChatGPT / ChatGPT Work / automations
Expose an OpenAI-compatible MCP/app/tool surface where platform support allows. Document plan/workspace limitations honestly. The generic HTTP API must still make the core usable even when first-party custom MCP write access is restricted.

### Generic agents
Provide a small TypeScript SDK or clean HTTP examples so any long-running agent can integrate.

## Scope discipline

Do not turn this into:
- a generic robocalling app,
- a browser agent,
- a notification-only app,
- a fake scripted demo disconnected from the integration contracts.

UI polish is secondary until the full fake-provider end-to-end path works.

## Definition of a credible MVP

A deterministic local/demo flow must prove:

1. an agent registers and starts a run,
2. agent creates a non-blocking or blocking escalation,
3. call orchestration is scheduled through the fake provider,
4. a simulated human response becomes a structured owner decision,
5. unrelated work can continue for non-blocking escalation,
6. affected work resumes after the decision,
7. owner requests a callback to a running agent,
8. callback has access to current agent status,
9. owner instruction enters a durable queue,
10. agent consumes it at a safe checkpoint,
11. duplicate retries do not create duplicate calls,
12. tests cover the critical state transitions.

Only after that should live CALL-E wiring and broader platform adapters be considered complete.
