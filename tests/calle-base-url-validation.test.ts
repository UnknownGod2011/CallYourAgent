import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CalleCallProvider, normalizeCalleBaseUrl } from "../src/calle-provider.js";
import { buildRuntimeFromEnv } from "../src/server.js";

test("CALL-E base URL accepts an exact HTTPS origin and normalizes a trailing slash", async () => {
  const requests: string[] = [];
  let requestCount = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    requests.push(String(input));
    requestCount += 1;
    const payload = requestCount === 1
      ? { id: "call_base_url", status: "queued", structured_result: null }
      : { id: "call_base_url", status: "in_progress", structured_result: null };
    return new Response(JSON.stringify(payload), {
      status: requestCount === 1 ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const provider = new CalleCallProvider({
    apiKey: "test-key",
    ownerPhone: "+15555550123",
    baseUrl: "https://callee.example.test/",
    fetchImpl,
  });

  await provider.start({
    idempotencyKey: "base-url:create",
    purpose: "owner_callback",
    task: "Call the owner.",
    metadata: { runId: "run_base_url" },
  });
  await provider.observe("call_base_url");

  assert.deepEqual(requests, [
    "https://callee.example.test/v1/calls",
    "https://callee.example.test/v1/calls/call_base_url",
  ]);
  assert.equal(normalizeCalleBaseUrl("https://callee.example.test/"), "https://callee.example.test");
});

test("CALL-E base URL rejects unsafe or ambiguous authenticated transport targets", () => {
  const cases: Array<[string, RegExp]> = [
    ["http://api.example.test", /must use https/],
    ["https://user:pass@api.example.test", /must not contain credentials/],
    ["https://api.example.test/v1", /must be an origin without a path/],
    ["https://api.example.test?tenant=other", /must not contain a query string/],
    ["https://api.example.test#fragment", /must not contain a fragment/],
    [" https://api.example.test", /valid absolute HTTPS origin/],
    ["https://api.example.test ", /valid absolute HTTPS origin/],
    ["not a url", /valid absolute HTTPS origin/],
  ];

  for (const [baseUrl, expected] of cases) {
    assert.throws(
      () => new CalleCallProvider({
        apiKey: "secret-key",
        ownerPhone: "+15555550123",
        baseUrl,
      }),
      expected,
    );
  }
});

test("unsafe live CALL-E base URL fails before durable SQLite initialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-calle-base-url-"));
  const databasePath = join(directory, "state.db");
  try {
    assert.throws(
      () => buildRuntimeFromEnv({
        CYA_API_TOKEN: "test-token",
        CYA_CALL_PROVIDER: "calle",
        CYA_STORE: "sqlite",
        CYA_SQLITE_PATH: databasePath,
        CALLE_API_KEY: "secret-calle-key",
        CALLE_BASE_URL: "http://api.example.test",
        CYA_OWNER_PHONE: "+15555550123",
        CYA_PUBLIC_BASE_URL: "https://cya.example.test",
        CYA_CALLE_WEBHOOK_TOKEN: "test-webhook-token",
      }),
      /CALL-E base URL must use https/,
    );
    await assert.rejects(access(databasePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
