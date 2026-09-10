import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildRuntimeFromEnv, calleWebhookUrl } from "../src/server.js";

const token = "secret token/with?reserved&chars";

test("calleWebhookUrl constructs the exact webhook target with WHATWG URL semantics", () => {
  assert.equal(
    calleWebhookUrl(" https://cya.example.com/ ", token),
    "https://cya.example.com/webhooks/calle?token=secret+token%2Fwith%3Freserved%26chars",
  );
});

test("calleWebhookUrl rejects unsafe or ambiguous public base URLs", () => {
  const invalid = [
    ["http://cya.example.com", /must use https/],
    ["https://user:pass@cya.example.com", /must not contain credentials/],
    ["https://cya.example.com?tenant=one", /must not contain a query string/],
    ["https://cya.example.com#fragment", /must not contain a fragment/],
    ["https://cya.example.com/base", /must be an origin without a path/],
    ["not a url", /valid absolute HTTPS origin/],
  ] as const;

  for (const [value, expected] of invalid) {
    assert.throws(() => calleWebhookUrl(value, token), expected);
  }
});

test("invalid live public base URL fails before durable SQLite storage is opened", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cya-public-base-"));
  const databasePath = join(directory, "state.db");
  try {
    assert.throws(() => buildRuntimeFromEnv({
      CYA_API_TOKEN: "test-token",
      CYA_CALL_PROVIDER: "calle",
      CYA_STORE: "sqlite",
      CYA_SQLITE_PATH: databasePath,
      CALLE_API_KEY: "test-calle-key",
      CYA_OWNER_PHONE: "+15555550123",
      CYA_CALLE_WEBHOOK_TOKEN: "test-webhook-token",
      CYA_PUBLIC_BASE_URL: "http://unsafe.example.com",
    }), /CYA_PUBLIC_BASE_URL must use https/);

    await assert.rejects(access(databasePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
