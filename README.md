# CallYourAgent

**The human escalation layer for autonomous AI agents.**

CallYourAgent lets an AI agent call its owner when an important decision needs human judgment, while allowing unrelated work to continue. The owner can also request a voice callback to ask for progress, ask questions, or steer the running agent.

## Core product

Two-way voice communication between humans and long-running AI agents:

1. **Agent → Human**
   - Agent raises an escalation.
   - CallYourAgent decides whether the issue is important enough to call.
   - CALL-E calls the owner.
   - The owner's answer is captured as a structured decision.
   - The blocked branch resumes; independent work need not stop.

2. **Human → Agent**
   - Owner requests a callback for a running agent.
   - CALL-E calls the owner.
   - CallYourAgent provides current agent/task context.
   - The owner can ask for progress or give new instructions.
   - Instructions enter the agent's durable instruction queue and are consumed at a safe checkpoint.

## Product principle

> Remote apps let you check on your agents. CallYourAgent means you do not have to.

The system is not a generic phone dialer and not tied to one AI vendor. It is a control plane that can be integrated through MCP, SDK/API adapters, hooks, or platform-specific plugins.

## Deterministic product demo

Run the complete no-credentials product story with the fake CALL-E provider:

```bash
npm ci
npm run demo
```

The command fails if a core invariant regresses. It proves that a non-blocking decision leaves unrelated work running, a blocking decision pauses only its scope and later resumes, an owner callback receives the current agent status, callback steering becomes queued structured state, and that steering is consumed only at a safe checkpoint. The emitted JSON includes the resulting run/call ids and durable audit-event sequence. It does **not** claim a live CALL-E phone call.

For a judge-friendly browser demo, run:

```bash
npm run demo:operator
```

This starts a localhost-only fake-provider server and prints the `/operator` URL, run id, a local read/audit-only bearer token, and a separate owner-callback token. The seeded run deliberately shows `documentation` still active while `production-deploy` is blocked and one owner steering instruction is pending.

The operator console includes a privacy-safe **Branch-safe execution** visualization derived only from the authenticated run overview and persisted audit events. While an owner decision is pending, it explicitly contrasts the independent active scope with the owner-gated blocked scope. After the trusted demo process records the owner decision, the same card shows that no scopes remain blocked and that the run has resumed active work. The browser never receives owner decision answers or queued steering text.

The read token can observe the overview and audit timeline but cannot checkpoint/acknowledge instructions, reconcile provider calls, mutate agent state, or request a callback. The separately scoped owner token adds only `owner:callback`; it can create a fresh callback through the normal `POST /v1/callbacks` contract but still cannot reconcile the provider call or consume steering. The trusted demo process completes fake-provider calls and agent checkpoints through the existing control-plane services when you advance the terminal stages. Stop the demo with Ctrl+C.

This is deterministic fake-provider orchestration over the real control-plane semantics, not evidence of a live CALL-E call.

## Initial integration targets

- Claude / Claude Code via MCP + adapter/hooks where supported.
- Codex via MCP/adapter/checkpoint integration where supported.
- ChatGPT / ChatGPT Work / scheduled or event-triggered workflows through an OpenAI-compatible app/MCP surface where supported.
- Generic custom agents through an HTTP/TypeScript SDK.

## Non-blocking model

An escalation belongs to a branch/scope, not necessarily to the whole agent run.

- `blocking=true`: only the affected branch must wait.
- `blocking=false`: agent continues; answer is consumed later at a safe checkpoint.
- Incoming owner instructions are queued rather than injected mid-token-generation.

## Operator console

A built-in browser console is available at `/operator`. It is a thin shell over the existing authenticated run/audit/callback APIs: it can display the current run summary and durable causal timeline, make branch-level blocking/resume semantics visually obvious, auto-refresh during a demo, and request an owner callback when the supplied token has `owner:callback`.

The page itself contains no server credentials or run data. Entered bearer tokens stay in page memory and normal API scopes still apply. The deterministic `demo:operator` launcher supplies separate least-privilege read and owner credentials. See [docs/OPERATOR_CONSOLE.md](docs/OPERATOR_CONSOLE.md).

## Architecture and operations

See:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)
- [docs/CALL_POLICY.md](docs/CALL_POLICY.md)
- [docs/API_SECURITY.md](docs/API_SECURITY.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/OPERATOR_CONSOLE.md](docs/OPERATOR_CONSOLE.md)
- [progress.md](progress.md)

## CALL-E

CALL-E is the phone transport. The application must keep `CALLE_API_KEY` server-side and use idempotency keys for real calls. Development must support a fake provider so the full system can be tested without spending credits.

## Development rules

Read [AGENTS.md](AGENTS.md) before changing the repository.

This repository is intentionally being built architecture-first so Codex/Claude can extend it without redesigning the core.
