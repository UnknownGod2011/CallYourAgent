import assert from "node:assert/strict";
import { test } from "node:test";
import {
  credentialForRole,
  scopesForCredentialRole,
  type ApiCredentialRole,
} from "../src/credential-roles.js";

const expected: Record<ApiCredentialRole, string[]> = {
  agent: ["agent:read", "agent:write", "audit:read"],
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

test("owner role can observe and request callbacks without agent mutation or reconciliation authority", () => {
  const credential = credentialForRole("owner-ui", "owner-secret", "owner");

  assert.deepEqual(credential, {
    id: "owner-ui",
    token: "owner-secret",
    scopes: ["agent:read", "audit:read", "owner:callback"],
  });
  assert.equal(credential.scopes.includes("agent:write"), false);
  assert.equal(credential.scopes.includes("calls:reconcile"), false);
  assert.equal(credential.scopes.includes("*"), false);
});

test("scope arrays are copied so one integration cannot mutate the shared role preset", () => {
  const first = scopesForCredentialRole("operator-read");
  first.push("agent:write");

  assert.deepEqual(scopesForCredentialRole("operator-read"), ["agent:read", "audit:read"]);
});
