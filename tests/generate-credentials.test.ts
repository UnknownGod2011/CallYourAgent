import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCredentialJson } from "../src/generate-credentials.js";

test("credential generator emits four unique least-privilege deployment credentials", () => {
  const credentials = JSON.parse(generateCredentialJson()) as Array<{
    id: string;
    token: string;
    scopes: string[];
  }>;

  assert.deepEqual(credentials.map((credential) => credential.id), [
    "agent",
    "owner",
    "operator-read",
    "reconciler",
  ]);
  assert.equal(new Set(credentials.map((credential) => credential.token)).size, 4);
  for (const credential of credentials) {
    assert.ok(credential.token.length >= 43);
    assert.equal(credential.scopes.includes("*"), false);
  }

  const owner = credentials.find((credential) => credential.id === "owner")!;
  assert.deepEqual(owner.scopes, ["agent:read", "audit:read", "owner:callback"]);
  assert.equal(owner.scopes.includes("decision:read"), false);
  assert.equal(owner.scopes.includes("calls:reconcile"), false);

  const operator = credentials.find((credential) => credential.id === "operator-read")!;
  assert.deepEqual(operator.scopes, ["agent:read", "audit:read"]);

  const agent = credentials.find((credential) => credential.id === "agent")!;
  assert.equal(agent.scopes.includes("decision:read"), true);

  const reconciler = credentials.find((credential) => credential.id === "reconciler")!;
  assert.deepEqual(reconciler.scopes, ["calls:reconcile"]);
});

test("credential generator refuses weak token sizes", () => {
  assert.throws(() => generateCredentialJson(15), /at least 16 bytes/);
});
