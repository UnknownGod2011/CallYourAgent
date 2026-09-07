# Docker Compose reference deployment

This directory is the reproducible single-instance deployment recipe for the current SQLite-backed CallYourAgent architecture.

It intentionally runs **one** control-plane process and mounts the whole `/data` directory from a named Docker volume. SQLite WAL uses sibling `-wal` and `-shm` files, so persisting only the main `.db` file is not a safe runtime-storage model.

## Fake-provider bring-up

From the repository root:

```bash
export CYA_API_TOKEN="replace-with-a-long-random-token"
docker compose -f deploy/compose.yml up --build -d
curl --fail http://127.0.0.1:8787/health
```

Open `http://127.0.0.1:8787/operator` for the thin operator console. Keep using the deterministic fake provider until the full agent -> decision -> callback -> checkpoint flow works for your deployment.

To restart without losing SQLite state:

```bash
docker compose -f deploy/compose.yml restart callyouragent
```

To stop the service while keeping the volume:

```bash
docker compose -f deploy/compose.yml down
```

Do **not** add `--volumes` unless you intentionally want to delete the persisted control-plane state.

The repository's `Compose deployment` GitHub Actions workflow verifies more than process restart: it creates an agent and run through the authenticated HTTP API, updates the run state, restarts the same Compose service, and then verifies the run snapshot plus audit events are still available from the persisted SQLite volume. This is deployment-path evidence that API-created control-plane state survives restart; it does not replace the deeper domain/state-machine tests in the normal test suite.

## Live CALL-E mode

Only after fake-mode verification, set `CYA_CALL_PROVIDER=calle` and provide all required server-side values:

- `CALLE_API_KEY`
- `CYA_OWNER_PHONE`
- `CYA_PUBLIC_BASE_URL` pointing at a stable public HTTPS origin
- `CYA_CALLE_WEBHOOK_TOKEN` with high entropy

The Compose file does not terminate TLS or expose the service publicly by default; it binds to `127.0.0.1`. Put a trusted HTTPS reverse proxy or hosting ingress in front of it for live CALL-E webhook delivery. Redact `/webhooks/calle` query strings from proxy/APM logs because the application-owned webhook capability token is carried in the URL.

For an internet-exposed deployment, prefer scoped `CYA_API_CREDENTIALS_JSON` credentials as documented in `docs/API_SECURITY.md`. The legacy `CYA_API_TOKEN` is intentionally full-access.

## Architecture boundary

This recipe is not horizontally scalable. The current supported topology remains one Node process + one SQLite volume + process-local rate limiting. Moving to multiple application instances requires a shared transactional store and shared rate limiter that preserve existing idempotency and uniqueness guarantees.

`/health` is liveness only. It does not prove that CALL-E credentials, phone authorization, public webhook routing, or live calls are working.
