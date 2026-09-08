import assert from "node:assert/strict";
import { test } from "node:test";
import {
  credentialForRole,
  scopesForCredentialRole,
  standardCredentialBundle,
  type ApiCredentialRole,
} from "../src/credential-roles.js";

const expected: Record<ApiCredentialRole, string[]> = {
  agent: ["agent:read", "agent:write", "decision:read", "audit:read"],
  "operator-read": ["agent:read", "audit:read"],
  owner: ["agent:read", "audit:read", "owner:callback"],
  reconciler: ["calls:reconcile"],
};

test("standard credential roles are least privilege and never inherit wildcard access", () => {
  for (const [role, scopes] of Object.entries(expected) as [ApiCredentialRole, string[]][]) {
    const actual = scopesForCredentialRole(role);
    assert.deepEqual(actual, scopes);
    assert.equal(actual.includes("*"), false);
  }
});

test("owner role can observe and request callbacks without decision, agent mutation, or reconciliation authority", () => {
  const credential = credentialForRole("owner-ui", "owner-secret", "owner");

  assert.deepEqual(credential, {
    id: "owner-ui",
    token: "owner-secret",
    scopes: ["agent:read", "audit:read", "owner:callback"],
  });
  assert.equal(credential.scopes.includes("decision:read"), false);
  assert.equal(credential.scopes.includes("agent:write"), false);
  assert.equal(credential.scopes.includes("calls:reconcile"), false);
  assert.equal(credential.scopes.includes("*"), false);
});

test("operator-read role cannot read owner decision answers", () => {
  assert.equal(scopesForCredentialRole("operator-read").includes("decision:read"), false);
  assert.equal(scopesForCredentialRole("agent").includes("decision:read"), true);
});

test("scope arrays are copied so one integration cannot mutate the shared role preset", () => {
  const first = scopesForCredentialRole("operator-read");
  first.push("agent:write");

  assert.deepEqual(scopesForCredentialRole("operator-read"), ["agent:read", "audit:read"]);
});

test("standard deployment bundle preserves the four least-privilege role boundaries", () => {
  const tokens = ["agent-token", "owner-token", "operator-token", "reconciler-token"];
  const bundle = standardCredentialBundle(() => tokens.shift()!);

  assert.deepEqual(bundle, [
    { id: "agent", token: "agent-token", scopes: expected.agent },
    { id: "owner", token: "owner-token", scopes: expected.owner },
    { id: "operator-read", token: "operator-token", scopes: expected["operator-read"] },
    { id: "reconciler", token: "reconciler-token", scopes: expected.reconciler },
  ]);
  assert.equal(bundle.find((credential) => credential.id === "owner")!.scopes.includes("decision:read"), false);
  assert.equal(bundle.find((credential) => credential.id === "operator-read")!.scopes.includes("calls:reconcile"), false);
});

test("standard deployment bundle rejects empty or duplicate generated tokens", () => {
  assert.throws(() => standardCredentialBundle(() => ""), /empty token/);
  assert.throws(() => standardCredentialBundle(() => "same-token"), /unique tokens/);
});
