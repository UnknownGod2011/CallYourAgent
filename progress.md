# CallYourAgent progress

## Current status

CallYourAgent is a durable Node 24 TypeScript control plane for asynchronous two-way voice coordination between autonomous AI agents and their owners. Agents can request important owner decisions without freezing unrelated scopes; owners can request context-aware callbacks; human input is persisted as structured state and consumed only at explicit safe checkpoints. The repository includes deterministic fake and production CALL-E providers, SQLite persistence, replayable/idempotent call attempts, polling/webhook convergence, branch-scoped blocking, durable decisions and instruction queues, quiet hours/call budgets, bounded recovery, privacy-aware audit history, scoped HTTP auth, typed SDK, stdio MCP, lifecycle worker, operator console, deterministic demos, and a single-instance Compose reference deployment.

## Exact repo state inspected this run

Started from `main` at commit `4492199f1743a96f34de0bd54fc5ea529628e7c8` before this run's changes. Inspected the complete repository tree and current source/test inventory, recent commits, `AGENTS.md`, this file, `README.md`, all architecture/integration/deployment/security/policy/acceptance documents under `docs/` plus `deploy/README.md`, and relevant issue/PR search results. No open issue or pull request required a different priority. The audit confirmed the main `ControlPlane.heartbeat(...)` and `ControlPlane.checkpoint(..., consume=true)` methods still use direct in-method mutations, while dedicated runtime seams exist for safe migration.

## Changes made this run

Added `src/checkpoint-audit.ts` with a pure helper that builds the `owner_instruction_consumed` audit payload only from instructions that actually won the conditional transition to `consumed`.

Added `tests/checkpoint-audit.test.ts` covering empty consumption and deterministic instruction-id/count payload generation.

Exported the helper from `src/index.ts`.

Commits created this run:

- `49c8f9ef24b27e6b34b38cbaf6a1501c22209115` — Add checkpoint instruction audit payload helper
- `3978d49b4803e1e2a3fc48755a39c0a4676d047e` — Test checkpoint instruction audit payload helper
- `c3cf6d343d79d62ca1189bd78576658a602c4929` — Export checkpoint audit helper

## Verification performed

- Full repository tree and architecture/integration docs inspected before changes.
- Recent commits and issue/PR search inspected; no relevant open issue or PR.
- New code and tests were committed through the GitHub connector.
- The connector does not expose a local clone/runtime, so fresh test/typecheck/build execution was not available during this run and is not claimed.
- Previous authoritative baseline remains: CI passed on Node `24.20.0` with `212/212` tests, container verification succeeded, and the full Compose fake-provider/MCP/restart acceptance succeeded.

No live CALL-E phone call was attempted or claimed.

## Architecture decisions made this run

1. Keep checkpoint state transition and audit-payload derivation separate so only the winning conditional consumer can produce `owner_instruction_consumed` details.
2. Preserve immutable snapshots and durable replay/race semantics.
3. Keep audit publication outside the pure helper so the eventual control-plane transaction can decide the exact event envelope.
4. Preserve branch-scoped blocking, callback semantics, and no-mid-generation-interruption behavior unchanged.

## CALL-E integration status

- Fake provider: deterministic, credential-free, idempotent, restart-rehydratable, and the complete acceptance provider.
- Production adapter: implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, fail-closed ambiguity, and strict authenticated base-URL validation.
- No live CALL-E connectivity or owner-phone authorization has been verified.

## Current blockers / external prerequisites

No repository-development blocker prevents further useful work.

A genuine Claude Code host acceptance still requires a real Claude Code environment/CLI. Live CALL-E acceptance still requires a valid authorized credential, owner phone destination, and stable externally reachable HTTPS webhook ingress. The automation connector lacks a local clone/runtime and safe multi-file patch workflow, so runtime verification must continue through GitHub Actions after code commits.

## Highest-value next actions

1. Wire `ControlPlane.heartbeat` through `applyHeartbeatAtRuntime(...)` and publish `run_status_reported` only when the CAS write wins.
2. Wire `ControlPlane.checkpoint(..., consume=true)` through `applyCheckpointAtRuntime(...)`, with conditional `owner_instruction_consumed` auditing using `checkpointInstructionAuditPayload(...)`.
3. Extend integration coverage with stale heartbeat rejection, newer terminal-state preservation, rollback, and multi-worker SQLite parity.
4. Add an exact persistence-level conditional acknowledgement primitive if the SQLite implementation needs stronger parity than the in-memory seam.
5. Audit escalation reservation/deferral/expiry, active-call progress, and ambiguous recovery for stale whole-entity writes.
6. Continue runtime string configuration and HTTP semantic-boundary hardening.
7. Preserve the fake-provider acceptance path while keeping UI work secondary.
8. Run the documented acceptance in a genuine Claude Code host when available.
9. Perform one tightly bounded live CALL-E acceptance only after user-controlled prerequisites are available.

## Latest Codex takeover record — 2026-09-12

### Repository state inspected

Started from clean `main` at commit `64e5615f48b3fa75bcdf0997d9dd9df7fdd89c04`. Inspected the complete repository tree; source, tests, manifests, runtime/deployment configuration, environment example, recent commits, branches, GitHub issues and pull requests; `AGENTS.md`, this file, `README.md`, and all architecture, integration, deployment, security, policy, persistence, and acceptance documents under `docs/` plus `deploy/README.md`. There are no open repository issues or PRs. Current CALL-E documentation was checked against the production adapter: authenticated `POST /v1/calls`, idempotency, status polling, webhooks, and server-side credentials align with the adapter's existing integration.

### Changes made

- Wired `ControlPlane.heartbeat(...)` to the CAS runtime seam. A heartbeat returns the durable winner and writes `run_status_reported` only when its conditional update succeeds. Timestamps advance monotonically even when two operations fall in the same millisecond.
- Wired consuming `ControlPlane.checkpoint(...)` calls to the safe-checkpoint runtime seam and its transaction. Only instructions that win the queued-to-consumed transition receive an `owner_instruction_consumed` audit event; a losing or replayed consumer emits none.
- Declared the existing `paused` run-state contract in the domain type, and converted two accidentally Vitest-based tests to the repository's Node built-in test runner so the advertised test command compiles without an undeclared dependency.
- Fixed SQLite audit-sequence initialization across reopen, enforced provider-call uniqueness at the SQL layer, and checkpointed WAL before shutdown so short-lived Windows workers can clean up their state directories.
- Added a control-plane heartbeat regression that simulates a competing CAS winner and proves the stale reporter receives the authoritative paused snapshot without a false progress audit.

### Tests and checks

- `npm ci` completed without vulnerabilities. The default shell Node 22 is below the project minimum and was not used for final verification.
- Bundled Node `24.19.0`: `tsc -p tsconfig.json --noEmit` — PASS.
- Bundled Node `24.19.0`: build — PASS.
- Bundled Node `24.19.0`: full test suite — PASS, `230/230` tests.
- Bundled Node `24.19.0`: deterministic fake-provider demo — PASS.
- `git diff --check` — PASS.

### CALL-E status and blockers

The fake provider is deterministic, credential-free, idempotent, restart-rehydratable, and the full local acceptance path. The production adapter is implemented with server-side `CALLE_API_KEY`, idempotency, bounded create/polling, persisted correlation, webhook/poll convergence, duplicate prevention, restart recovery, and fail-closed ambiguity. No live CALL-E connectivity or phone call has been attempted or verified.

Live acceptance requires a valid authorized credential, an owner phone number explicitly authorized for the test, and stable externally reachable HTTPS webhook ingress. A genuine Claude Code host acceptance also requires a Claude Code environment/CLI.

### Next actions

1. Add independent SQLite-worker tests for public heartbeat and consuming-checkpoint behavior, including a newer terminal/paused winner.
2. Add a persistence-level conditional instruction-acknowledgement primitive if multi-worker checkpoint testing exposes a gap.
3. Perform the documented Claude Code host acceptance when that host is available.
4. Perform one tightly bounded live CALL-E acceptance only after the user-controlled prerequisites are available.

## Live CALL-E and connection-kit update — 2026-09-12

### Real CALL-E result

CALL-E browser/CLI OAuth authorization was completed and verified with `calle auth status --json`; MCP tool discovery returned `plan_call`, `run_call`, and `get_call_run`. A real authorized CALL-E plan was created for the owner's provided test number and then started once. CALL-E run `xlKqea9vM_oDvUb00viB8Q` accepted the request, created provider call `7123d4167f644dc5a4a5dea30f2773a4`, rang, connected, and reached voicemail for 33 seconds. Its terminal result was `COMPLETED` with `task_completed=false`: no human response and no valid blue/green owner decision were captured.

This verifies live authentication, plan creation, one real dial attempt, provider execution, lifecycle tracking, and a durable structured terminal result. It does not verify the human-answer-to-persisted-decision-to-branch-resume path. CALL-E suggested an explicit retry choice; no retry was started automatically.

### Product direction and changes

Confirmed the product boundary: CallYourAgent is a reusable human-control connector for agent hosts, not a generic calling bot. The agent MCP/SDK persists an owner decision against a scoped run branch and keeps unrelated work active; the owner callback path turns progress questions and steering into a durable instruction queue consumed at safe checkpoints.

Added `GET /connect`, a privacy-preserving Connection Kit. It is a browser-local setup surface that does not submit or store phone numbers or tokens. It generates the exact live deployment environment, least-privilege MCP configuration for Codex, Claude Code, or generic stdio MCP hosts, an owner-console URL, and the checkpoint operating instruction for the connected agent. It reinforces the correct split: only the server receives CALL-E credentials; the agent receives only its scoped token; the browser owner surface receives only the owner token.

### Verification

- Bundled Node `24.19.0`: typecheck and build — PASS.
- Bundled Node `24.19.0`: Connection Kit and operator-console tests — PASS, `3/3`.
- `git diff --check` — PASS.

### Next actions

1. Run the full Node 24 test suite after committing the Connection Kit.
2. Deploy a public HTTPS instance, then use `/connect` to generate the real agent-host configuration.
3. Complete a live answered-call test during an available window and verify its structured decision is persisted and releases only its blocked scope.
4. Extend the Connection Kit into authenticated hosted multi-tenant onboarding; the current production reference deployment remains one owner phone per self-hosted instance.

## Live CALL-E retry outcome — 2026-09-12

With explicit owner authorization, a second tightly scoped live CALL-E attempt was made to collect a blue-or-green UI decision and one short non-sensitive agent instruction. CALL-E created provider call `c34790c15ce9463296c383d6e17b57c3`, but the call ended immediately with no conversation, transcript, or captured response. Its terminal result was `FAILED`, `task_completed=false`, with provider evidence indicating a normal dial that was hung up by the callee at zero seconds. No decision or instruction was persisted, and no further retry was scheduled or started.

The current documented CALL-E CLI/API integration surface accepts a task, recipients, result schema, metadata, and lifecycle configuration; it does not expose a supported voice, TTS-provider, or ElevenLabs voice-selection setting. Do not claim an ElevenLabs voice switch until CALL-E documents and exposes one. The test prompt was nonetheless shortened and made conversational to reduce avoidable robotic phrasing.

## Cross-host self-service setup increment — 2026-09-12

### What changed

- Reworked `GET /connect` into a browser-local setup wizard with explicit choices for Codex CLI/IDE, ChatGPT desktop, Claude Code, Gemini CLI, Kiro, generic local stdio MCP clients, and hosted ChatGPT/ChatGPT Work.
- The wizard generates exact scoped-token setup text for the local hosts, a server deployment environment, copy controls, and the safe-checkpoint operating instruction. It never submits entered phone numbers or credentials.
- Hosted ChatGPT/ChatGPT Work now deliberately reports its true state: it needs a remote Streamable HTTP MCP endpoint, per-user OAuth, tenant-scoped credentials, and a published plugin. The current self-hosted release is local stdio MCP plus HTTP/SDK; it must not be represented as directly pasteable into ChatGPT web.
- Added `plugins/callyouragent`, a validated credential-free Codex/ChatGPT-compatible plugin package containing the cross-tool safe-checkpoint workflow. It intentionally does not embed an MCP transport or any user credential; `/connect` supplies deployment-specific connection values.
- Documented the host support matrix, provider-delivery boundary, and voice/verified-caller-ID requirement in `README.md` and `docs/INTEGRATIONS.md`.

### Verification

- Bundled Node `24.19.0`: TypeScript build and full Node test suite — PASS, `233/233`.
- Plugin Creator validator: `plugins/callyouragent` — PASS.
- `git diff --check` — PASS before commit.

### Current external limitations

- CALL-E accepted two owner-authorized live attempts but neither produced a handset conversation: the first went to voicemail and the second ended immediately at zero seconds. This does not prove reliable delivery to the handset. A verified/branded caller identity or bring-your-own telephony provider is required before production India delivery claims.
- No CALL-E API/CLI voice or ElevenLabs provider-selection option is documented or wired. An ElevenLabs or alternate-telephony adapter must preserve the existing `CallProvider` lifecycle contract and be independently tested.
- Hosted ChatGPT/ChatGPT Work onboarding remains future work until remote MCP/OAuth and multi-tenant hosting exist. Local ChatGPT desktop, Codex, Claude Code, Gemini CLI, Kiro, generic MCP, HTTP, and TypeScript SDK onboarding are now documented and generated by `/connect`.

### Highest-value next actions

1. Deploy a public HTTPS control plane and run `/connect` with generated least-privilege credentials in a real local host, beginning with Codex or Claude Code.
2. Implement and test a provider adapter backed by a verified/branded caller-ID route before further live delivery experiments.
3. Build remote Streamable HTTP MCP plus OAuth and tenant-scoped onboarding, then package/publish the hosted ChatGPT/ChatGPT Work plugin.
4. Run real-host acceptance for Codex, Claude Code, Gemini CLI, and Kiro using the generated configurations.

## Hosted onboarding site increment — 2026-09-12

Added a standalone responsive Vercel marketing/onboarding surface in `site/index.html` and `vercel.json`. It explains the real branch-safe phone-control flow, shows the local agent-host configurations for Codex, ChatGPT desktop, Claude Code, Gemini CLI, and Kiro, and explicitly keeps hosted ChatGPT/ChatGPT Work marked as pending remote MCP/OAuth work. The site deliberately does not collect phone numbers, credentials, or falsely claim that a static Vercel page alone provides a durable phone-control backend.

Vercel CLI authentication was verified for the account owner. The first Vercel build attempt revealed that the directory-derived project name contains uppercase letters, which Vercel rejects. The deployment must use a lowercase project slug such as `callyouragent`; this is a deployment naming correction, not an application failure.

The production Vercel project was created as `callyouragent`, built successfully, and assigned the stable alias `https://callyouragent.vercel.app`. This is the public onboarding/marketing site. It is intentionally static at this stage: it does not claim to host the durable SQLite-backed control plane or receive phone webhooks. A real hosted phone-control plane still requires a persistent store plus remote MCP/OAuth backend, then the site can point each tenant’s setup directly at that service.

## Hosted SaaS and remote MCP build — 2026-09-12

### What changed

- Replaced the static Vercel landing surface with a Next.js App Router SaaS application: Supabase email authentication, protected dashboard, agent CRUD, real CALL-E call initiation, real status/result sync, and private per-user history.
- CALL-E remains server-side only. Browser code receives neither the CALL-E credential nor a Supabase secret/service-role key.
- Added a remote MCP endpoint at `/mcp` with `request_phone_call`, `get_call_status`, and `pull_human_updates`. The endpoint uses an opaque, revocable per-agent connection token; it does not require an external user to supply a CALL-E key.
- Added an unapplied Supabase migration at `supabase/migrations/202609120001_remote_agent_connections.sql`. It adds tenant-scoped connection records and durable human updates, plus narrowly scoped database functions needed by token-authenticated remote MCP callers.
- Hardened the existing Supabase RLS policy execution and revoked unintended public access to the profile trigger function through the project connector earlier in this run.

### Verification

- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- Local Next smoke test: `/` and `/login` return 200; `/dashboard` redirects unauthenticated users; `POST /mcp` completes MCP `initialize` with a valid JSON-RPC response.
- Existing control-plane suite: 230 passed; three existing timeout tests were cancelled under the default local Node 22 runtime. The repository requires Node 24 for authoritative legacy-suite verification.

### Remaining external prerequisite

The Supabase connector was unavailable after the local implementation session, and the Supabase CLI has no authenticated access token on this host. The remote-agent migration is therefore committed but not yet applied to the CallYourAgent database. Core web authentication, agent management, and manual real calls use existing tables; remote MCP connection creation and dashboard-to-agent update delivery activate immediately after this migration is applied. Do not describe remote MCP as externally ready until that database migration is confirmed.

### Production deployment

Vercel production environment now contains the Supabase public URL and publishable key, the existing server-only `CALLE_API_KEY`, `CALLE_BASE_URL`, and the production site URL. The hosted Next.js build deployed successfully as Vercel deployment `callyouragent-qcgtiu4ks-tanush-shahs-projects-5e868e6e.vercel.app` and is Ready. The production domain alias remains managed by the existing `callyouragent` Vercel project.

## Public setup prompt kit — 2026-09-12

- Added the public `/connect` route. It has host-specific setup prompts for Codex, ChatGPT desktop, Claude Code, Gemini CLI, and Kiro, each with a one-click clipboard control.
- Added a connection-screen copy control for the agent operating instruction, alongside the private agent-specific MCP configuration.
- Verified typecheck and production build. Vercel production deployment `callyouragent-47rgfgon6-tanush-shahs-projects-5e868e6e.vercel.app` is Ready and the stable project alias points to the latest production deployment.

## Release audit and remote-connection activation — 2026-09-12

### Audit fixes

- Corrected the Vercel project framework/output configuration earlier in this run so the production alias serves the Next.js application rather than the retired static `site/` content. Removed `site/index.html` from the repository to prevent that stale surface from reappearing in a future misconfiguration.
- Added `.vercelignore` in the prior release increment so local `.env` files are excluded from Vercel uploads. Verified the subsequent deployment did not report uploading an env file.
- Added `app/icon.svg` in the prior release increment, resolving the public favicon 404 observed during browser smoke testing.
- Migrated the Next.js request gate from deprecated `middleware.ts`/`middleware()` to the Next 16 `proxy.ts`/`proxy()` convention.
- Reworked public `/connect`: the page now presents technical connection steps and a ready-to-paste remote MCP JSON shape. The detailed operating prompt is intentionally copied to the clipboard only; it is not displayed as the primary setup UI.

### Supabase activation

- Applied `supabase/migrations/202609120001_remote_agent_connections.sql` through the SQL Editor for the dedicated CallYourAgent project. Supabase returned `Success. No rows returned`.
- The production database now has the RLS-protected agent connection and human instruction queue required for scoped remote MCP connections. No other Supabase project was accessed or changed.

### Verification

- `npm run typecheck` — PASS.
- `npm run build` — PASS (all application routes compile; no deprecated middleware warning).
- `npm audit --omit=dev` — PASS, 0 vulnerabilities.
- Vercel production deployment `callyouragent-n2feonb3a-tanush-shahs-projects-5e868e6e.vercel.app` — Ready and assigned to `https://callyouragent.vercel.app` before the final proxy/static-source cleanup deployment.

### Remaining acceptance evidence

1. Deploy the final proxy/static-source cleanup commit.
2. Complete a signed-in Kiro connection creation and verify its remote MCP handshake with a generated scoped token.
3. Complete one answered real CALL-E test and verify its actual provider result is persisted. Prior provider attempts did not establish a handset conversation, so delivery/voice quality must remain unclaimed until that evidence exists.

### Final production verification

- Final deployment `callyouragent-6e3uw265g-tanush-shahs-projects-5e868e6e.vercel.app` is Ready and the stable `https://callyouragent.vercel.app` alias resolves to it.
- Production smoke checks: `/connect` returned 200 and contains the technical setup content; `/dashboard` returned the expected 307 redirect to login for an unauthenticated browser; `/icon.svg` returned 200; `POST /mcp` `initialize` returned 200 with a valid MCP protocol response.

## Production authentication redirect correction — 2026-09-12

### Defect found and fixed

A real external signup exposed a production release defect: Supabase Auth still had its default Site URL, `http://localhost:3000`, and no allowed production callback. Confirmation emails therefore sent users to localhost rather than the deployed application.

The CallYourAgent Supabase project's Auth URL configuration has now been changed and visibly saved as:

- Site URL: `https://callyouragent.vercel.app`
- Allowed Redirect URL: `https://callyouragent.vercel.app/auth/callback`

The web application already supplies that exact callback with `emailRedirectTo`; the redirect is now accepted by Supabase. The `/auth/callback` route has also been hardened: it sends a user to `/dashboard` only after `exchangeCodeForSession` succeeds. Missing, invalid, expired, or failed codes instead return to `/login?confirmation=failed` with a clear recovery message. It no longer gives an apparent authenticated success after a failed confirmation exchange.

### Verification

- `npm run typecheck` — PASS.
- Node 24.19: legacy TypeScript compilation and full deterministic control-plane suite — PASS, `235/235`.
- Node 24.19: `next build` — PASS after correcting a build-time `useSearchParams` suspense violation discovered during the first build attempt.
- `git diff --check` — PASS.
- Supabase dashboard visibly confirmed the saved production Site URL and callback allow-list.

The repository does not define an `npm run lint` script or a configured lint command; this is recorded rather than misreported as a passed lint check.

### Remaining proof

A fresh confirmation email must be opened by the account holder to provide the final human-email proof of the new redirect. The existing localhost email cannot be repaired; it was already generated with the old URL. Create the account again (or request a new confirmation email) after the production deployment containing this callback hardening. No user email was sent by the audit process.

### Publication and documentation evidence

Committed callback and recovery-route fix as `de64beb` (`Fix production auth confirmation redirects`). Deployed it only to the existing `callyouragent` Vercel production project: deployment `dpl_ABzH5p2emKS3xmbbVfRks46V5pBG`, Ready, with alias `https://callyouragent.vercel.app`.

Production smoke checks after deployment:

- `GET /auth/callback` — `307` to `/login?confirmation=failed`.
- `GET /auth/callback?code=invalid-confirmation-code` — `307` to `/login?confirmation=failed`.
- `GET /login?confirmation=failed` — `200` and renders the recovery message.
- `GET /signup` — `200`.
- unauthenticated `GET /dashboard` — `307` to the login route with `next=/dashboard`.
- authenticated-shape `POST /mcp` `initialize` — `200` with protocol version `2025-06-18`.

`README.md` and new `docs/HOSTED_SAAS.md` now distinguish the actual Vercel/Supabase SaaS onboarding path from the older self-hosted Node control-plane reference. The hosted limitations are explicit: dashboard updates are delivered only at an agent safe checkpoint; a production human-answered CALL-E interaction and the legacy callback/session model are not claimed as available through the hosted MCP service.

## Legacy container and Compose CI correction — 2026-09-12

The fresh GitHub Actions audit found two release-blocking failures in the self-hosted reference path. The Next.js SaaS changed `npm run build` to mean `next build`, but the Dockerfile, demos, credential generator, and Compose workflow still treated it as the legacy TypeScript build. That left container images without `dist/` and made credential generation fail before Compose could start.

Fixed the boundary explicitly:

- Dockerfile now runs `npm run legacy:build` before assembling the legacy runtime image.
- Legacy demos and credential generation use `legacy:build` rather than the SaaS `build` command.
- Compose first compiles the legacy control plane and then invokes the generated credential program directly, preserving its JSON stdout for `jq` without exposing it in logs.
- The credential generator's CLI entry-point test now resolves paths with `fileURLToPath` and `path.resolve`, so it works on Windows as well as Linux.
- Legacy Claude/stdio documentation now tells users to run `npm run legacy:build`.

Verification:

- `npm run typecheck` — PASS.
- Node 24.19 legacy compile — PASS.
- Direct Windows credential CLI generation parses exactly four expected least-privilege roles — PASS; token values were not emitted.
- Node 24.19 full deterministic control-plane suite — PASS, `235/235`.
- `git diff --check` — PASS.
- Local Docker/Compose execution could not be performed because Docker Desktop's Linux engine is stopped on this host (`//./pipe/dockerDesktopLinuxEngine` is unavailable). The corrected GitHub Container and Compose workflows are the pending independent container proof.

### Follow-up container audit

The first corrected Container/Compose run narrowed the remaining build failure to a missing Docker build input: `tsconfig.legacy.json` was not copied into the legacy image build stage. The Dockerfile now copies both TypeScript configurations before `npm run legacy:build`. This is a source-only Docker context correction; the local Docker engine remains unavailable, so the new GitHub Container and Compose runs are the authoritative verification.

### Second follow-up container audit

The next Container run found one more Docker build-context omission: the legacy compiler includes `tests/**/*.ts`, including the hosted onboarding contract test that imports `lib/connection-setup.ts`. The Docker build stage now copies `lib/` alongside `src/` and `tests/`, so the declared combined test inventory compiles consistently inside the image.

Verification after the correction:

- `npm run typecheck` — PASS.
- Node 24.19 `tsc -p tsconfig.legacy.json` — PASS.
- Node 24.19 hosted connection-contract test — PASS, `2/2`.
- `git diff --check` — PASS.

Docker Desktop remains stopped locally; GitHub Container and Compose checks remain the authoritative image/runtime verification.

## Final CI evidence — 2026-09-12

The corrected self-hosted reference pipeline was independently verified on GitHub at commit `7e00fb3a3e8e2acbb660955f5fa62fceaec6234b`:

- CI: success — TypeScript, full Node 24 test suite, and Next build.
- Container: success — production legacy image builds and starts its fake-provider runtime health check.
- Compose deployment: success — scoped credential generation, image build, fake-provider orchestration, restart recovery, MCP deployment acceptance, owner-decision branch release, owner callback, durable instruction queue, exact acknowledgement, and cleanup.

The previous Container/Compose failures are resolved. Docker Desktop was unavailable locally, but the GitHub runner supplied the authoritative Linux Docker/Compose evidence. The hosted Vercel auth redirect correction remains deployed at `https://callyouragent.vercel.app`; the only missing end-user evidence is a human opening a fresh confirmation email, because the previous email link was irreversibly generated with the old localhost setting.

## Confirmation-email recovery — 2026-09-12

Added a first-class recovery action to the hosted sign-in/sign-up form. A user can enter the email used for sign-up and choose **Resend confirmation email**; Supabase's signup resend endpoint receives the same production `emailRedirectTo` callback as new signups. This makes the prior localhost confirmation-email incident recoverable without requiring a database or admin intervention.

Verification:

- `npm run typecheck` — PASS.
- Node 24.19 `next build` — PASS.
- `git diff --check` — PASS.

No confirmation email was sent during this code audit because it would deliver to the account holder's email address. The live action must be pressed by the intended account holder after deployment.
