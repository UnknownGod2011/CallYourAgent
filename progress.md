# progress.md

## Current status

Repository initialized for architecture-first development.

### Inspected

- Repository root
- Existing README
- Repository is effectively blank apart from initial product documentation

### Completed

- Defined core product direction: two-way voice communication between an autonomous AI agent and its owner.
- Defined non-blocking escalation principle: unrelated work should continue while an owner decision is pending.
- Defined safe-checkpoint instruction model rather than pretending to interrupt an in-flight model generation.
- Defined platform-agnostic direction: persistent backend + MCP + generic API/SDK + platform adapters.
- README establishes CALL-E as the phone transport and requires a deterministic fake provider for development.

### Not yet implemented

- Application/package structure
- Persistent storage/schema
- Core state machines
- CALL-E fake provider
- Production CALL-E adapter
- HTTP API
- MCP server
- TypeScript SDK
- Claude adapter
- Codex adapter
- ChatGPT/Work integration surface
- Dashboard/demo UI
- Tests/CI

### Current blockers

None. The repository is ready for implementation.

### Best next actions

1. Create the monorepo/application structure and architecture docs.
2. Define typed domain models and state machines for agents, runs, escalations, decisions, instructions, callback sessions, and call attempts.
3. Implement deterministic in-memory/fake-provider end-to-end tests before adding persistence.
4. Add persistence abstraction and database implementation.
5. Add MCP/HTTP interfaces over the same core services.
6. Integrate production CALL-E only behind a provider interface and keep fake mode as the default.
