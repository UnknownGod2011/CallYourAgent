import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { FakeCallProvider } from "../src/call-provider.js";
import { ControlPlane } from "../src/control-plane.js";
import {
  createControlPlaneHttpServer,
  redactCalleWebhookRequestTarget,
} from "../src/http-server.js";
import { InMemoryControlPlaneStore } from "../src/store.js";

const servers: Array<ReturnType<typeof createControlPlaneHttpServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test("CALL-E webhook request target redaction removes capability material before downstream handling", () => {
  const secret = "hook-secret-with-phone-+15551234567";
  const redacted = redactCalleWebhookRequestTarget(
    `/webhooks/calle?trace=public-correlation&token=${encodeURIComponent(secret)}&mode=terminal`,
  );

  assert.equal(redacted.isCalleWebhook, true);
  assert.equal(redacted.token, secret);
  assert.equal(redacted.target, "/webhooks/calle?trace=public-correlation&mode=terminal");
  assert.equal(redacted.target.includes(secret), false);
  assert.equal(redacted.target.includes("token="), false);

  const unrelated = "/v1/runs/run-1?token=ordinary-query-value";
  assert.deepEqual(redactCalleWebhookRequestTarget(unrelated), {
    target: unrelated,
    isCalleWebhook: false,
  });
});

test("duplicate webhook capability parameters fail closed and are all redacted", () => {
  const target = "/webhooks/calle?token=first-secret&token=second-secret&trace=ok";
  const redacted = redactCalleWebhookRequestTarget(target);

  assert.equal(redacted.isCalleWebhook, true);
  assert.equal(redacted.token, undefined);
  assert.equal(redacted.target, "/webhooks/calle?trace=ok");
  assert.equal(redacted.target.includes("first-secret"), false);
  assert.equal(redacted.target.includes("second-secret"), false);
  assert.equal(redacted.target.includes("token="), false);
});

test("webhook HTTP responses never reflect capability tokens while the supported query contract still works", async () => {
  const secret = "hook-secret-never-reflect-+15559876543";
  const controlPlane = new ControlPlane(new InMemoryControlPlaneStore(), new FakeCallProvider());
  const server = createControlPlaneHttpServer(controlPlane, {
    apiToken: "agent-secret",
    calleWebhookToken: secret,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${base}/webhooks/calle?token=${encodeURIComponent(`${secret}-wrong`)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_private" },
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  const unauthorizedBody = await unauthorized.text();
  assert.equal(unauthorizedBody.includes(secret), false);
  assert.deepEqual(JSON.parse(unauthorizedBody), { error: "unauthorized_webhook" });

  const duplicate = await fetch(`${base}/webhooks/calle?token=${encodeURIComponent(secret)}&token=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_private" },
    body: "{}",
  });
  assert.equal(duplicate.status, 401);
  assert.equal((await duplicate.text()).includes(secret), false);

  const acceptedNonTerminal = await fetch(`${base}/webhooks/calle?token=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_active" },
    body: JSON.stringify({ id: "evt_active", data: { id: "call_active", status: "in_progress" } }),
  });
  assert.equal(acceptedNonTerminal.status, 202);
  const acceptedBody = await acceptedNonTerminal.text();
  assert.equal(acceptedBody.includes(secret), false);
  assert.deepEqual(JSON.parse(acceptedBody), { accepted: false, reason: "non_terminal_or_invalid" });
});
