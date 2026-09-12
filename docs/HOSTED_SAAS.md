# Hosted SaaS onboarding

## Production URL

Use `https://callyouragent.vercel.app`.

## Account and email confirmation

1. Open `/signup` and create an account.
2. Open the confirmation email in the same browser.
3. The link returns to `https://callyouragent.vercel.app/auth/callback`, creates the Supabase session, and redirects to the dashboard.
4. If a confirmation link is expired or invalid, the application returns to sign-in with a recovery message instead of claiming success. Create the account again to request a new confirmation email.

Supabase Auth is configured with the production Site URL and an allowed `/auth/callback` redirect. Do not use a localhost link from an email generated before that configuration was corrected.

## User flow

1. From the dashboard, create an agent and set its name, description, instructions, and active state.
2. Use **Make a call** to select the agent, enter an E.164 phone number, optional contact name, and call context. The browser never receives the CALL-E API key.
3. Open the agent and create a private agent connection. Copy the displayed configuration or the complete setup prompt before dismissing it; the opaque token is only displayed once and can be revoked at any time.
4. Select the IDE/agent host. The generated configuration points to the hosted `/mcp` endpoint and uses the private agent token as a bearer token.
5. Restart or reload the IDE if that host requires it. Confirm the CallYourAgent tools are listed, then continue normal work. The agent calls `request_phone_call` only when human judgment is required and may poll the call using `get_call_status`.
6. Human updates entered in the dashboard are retained for that agent. The IDE agent uses `pull_human_updates` at a safe checkpoint; it must not claim to alter a response already being generated.

## Supported connection formats

| Host | Current hosted setup | Status |
| --- | --- | --- |
| Codex CLI | `codex mcp add` with remote URL and bearer token environment variable | Supported |
| Claude Code | Project `.mcp.json`, `type: "http"`, remote URL and `Authorization` header | Supported |
| Gemini CLI | `httpUrl` MCP entry with `Authorization` header | Supported |
| Kiro | Remote MCP `url` entry with `Authorization` header | Supported |
| Antigravity | Remote MCP `serverUrl` entry with `Authorization` header | Supported |
| Other IDE / custom agent | Remote HTTP MCP `url` plus bearer token, or the documented HTTP contract | Supported when the client supports remote HTTP MCP |
| Hosted ChatGPT / ChatGPT Work | Requires OAuth and a published remote integration | Not available yet |

The website intentionally generates the exact currently supported snippet for each host. Do not paste a token into a host or format not represented by its official MCP configuration.

## Product boundary

The hosted SaaS persists agents, manual calls, call results, agent connections, and human-update messages in the tenant's Supabase-backed account. It does not yet expose the legacy reference control plane's full owner-callback session, branch-scoped escalation state machine, or automatic transcript-to-instruction analysis through the hosted remote MCP endpoint. A dashboard human update is durable and is delivered only when the agent requests it at a safe checkpoint.

CALL-E is used only from server-side routes. The deterministic fake-provider end-to-end acceptance exists in the legacy control-plane test suite. A human-answered production CALL-E interaction has not been verified, so the hosted product must not claim that handset delivery or structured response capture is proven in every region.
