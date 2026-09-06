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

## Architecture

See:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)
- [progress.md](progress.md)

## CALL-E

CALL-E is the phone transport. The application must keep `CALLE_API_KEY` server-side and use idempotency keys for real calls. Development must support a fake provider so the full system can be tested without spending credits.

## Development rules

Read [AGENTS.md](AGENTS.md) before changing the repository.

This repository is intentionally being built architecture-first so Codex/Claude can extend it without redesigning the core.
