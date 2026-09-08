import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCredentialBundle } from "../src/credential-roles.js";
import { startRuntimeFromEnv } from "../src/server.js";

const TOKENS = ["agent-runtime-secret", "owner-runtime-secret", "operator-runtime-secret", "reconciler-runtime-secret"] as const;

function generatedBundle() {
  let index = 0;
  return standardCredentialBundle(() => TOKENS[index++]!);
}

async function request(
  base: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  return { response, body: await response.json() as Record<string, unknown> };
}

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

test("generated four-role bundle survives env parsing and enforces runtime HTTP boundaries", async () => {
  const credentials = generatedBundle();
  const byId = new Map(credentials.map((credential) => [credential.id, credential]));
  const runtime = await startRuntimeFromEnv({
    CYA_API_CREDENTIALS_JSON: JSON.stringify(credentials),
    CYA_CALL_PROVIDER: "fake",
    CYA_STORE: "memory",
    CYA_LIFECYCLE_SWEEP_INTERVAL_MS: "60000",
    PORT: "0",
  });

  try {
    const base = `http://127.0.0.1:${runtime.port}`;
    const expectedScopes = new Map(credentials.map((credential) => [credential.id, credential.scopes]));

    for (const credential of credentials) {
      const capabilities = await request(base, credential.token, "/v1/auth/capabilities");
      assert.equal(capabilities.response.status, 200);
      assert.deepEqual(capabilities.body, {
        credentialId: credential.id,
        scopes: expectedScopes.get(credential.id),
      });
      assert.doesNotMatch(JSON.stringify(capabilities.body), new RegExp(credential.token));
    }

    const agentToken = byId.get("agent")!.token;
    const ownerToken = byId.get("owner")!.token;
    const operatorToken = byId.get("operator-read")!.token;
    const reconcilerToken = byId.get("reconciler")!.token;

    const createAgent = await request(base, agentToken, "/v1/agents", post({
      name: "runtime-worker",
      platform: "test",
      ownerId: "owner-1",
    }));
    assert.equal(createAgent.response.status, 201);
    const agentId = String(createAgent.body.id);

    const createRun = await request(base, agentToken, "/v1/runs", post({
      agentId,
      summary: "Testing generated deployment credentials",
      currentScope: "credential-runtime-acceptance",
    }));
    assert.equal(createRun.response.status, 201);
    const runId = String(createRun.body.id);

    const ownerRead = await request(base, ownerToken, `/v1/runs/${encodeURIComponent(runId)}`);
    assert.equal(ownerRead.response.status, 200);
    const operatorRead = await request(base, operatorToken, `/v1/runs/${encodeURIComponent(runId)}`);
    assert.equal(operatorRead.response.status, 200);

    const ownerWriteDenied = await request(base, ownerToken, "/v1/agents", post({
      name: "forbidden-owner-write",
      platform: "test",
      ownerId: "owner-1",
    }));
    assert.equal(ownerWriteDenied.response.status, 403);
    assert.deepEqual(ownerWriteDenied.body, { error: "forbidden", requiredScope: "agent:write" });

    const operatorCallbackDenied = await request(base, operatorToken, "/v1/callbacks", post({
      runId,
      idempotencyKey: "operator-must-not-call",
    }));
    assert.equal(operatorCallbackDenied.response.status, 403);
    assert.deepEqual(operatorCallbackDenied.body, { error: "forbidden", requiredScope: "owner:callback" });

    const agentCallbackDenied = await request(base, agentToken, "/v1/callbacks", post({
      runId,
      idempotencyKey: "agent-must-not-owner-callback",
    }));
    assert.equal(agentCallbackDenied.response.status, 403);

    const callback = await request(base, ownerToken, "/v1/callbacks", post({
      runId,
      idempotencyKey: "owner-runtime-callback",
      prompt: "Give me a concise progress update",
    }));
    assert.equal(callback.response.status, 201);
    const callbackId = String(callback.body.id);

    const ownerReconcileDenied = await request(
      base,
      ownerToken,
      `/v1/callbacks/${encodeURIComponent(callbackId)}/reconcile`,
      post({}),
    );
    assert.equal(ownerReconcileDenied.response.status, 403);
    assert.deepEqual(ownerReconcileDenied.body, { error: "forbidden", requiredScope: "calls:reconcile" });

    const reconcilerReadDenied = await request(base, reconcilerToken, `/v1/runs/${encodeURIComponent(runId)}`);
    assert.equal(reconcilerReadDenied.response.status, 403);
    assert.deepEqual(reconcilerReadDenied.body, { error: "forbidden", requiredScope: "agent:read" });

    const reconcile = await request(
      base,
      reconcilerToken,
      `/v1/callbacks/${encodeURIComponent(callbackId)}/reconcile`,
      post({}),
    );
    assert.equal(reconcile.response.status, 200);

    const operatorAudit = await request(base, operatorToken, `/v1/runs/${encodeURIComponent(runId)}/audit`);
    assert.equal(operatorAudit.response.status, 200);
    const reconcilerAuditDenied = await request(base, reconcilerToken, `/v1/runs/${encodeURIComponent(runId)}/audit`);
    assert.equal(reconcilerAuditDenied.response.status, 403);
    assert.deepEqual(reconcilerAuditDenied.body, { error: "forbidden", requiredScope: "audit:read" });
  } finally {
    await runtime.shutdown();
  }
});
