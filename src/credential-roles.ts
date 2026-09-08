import type { ApiCredential, ApiScope } from "./http-server.js";

export type ApiCredentialRole = "agent" | "operator-read" | "owner" | "reconciler";

const ROLE_SCOPES: Record<ApiCredentialRole, readonly ApiScope[]> = {
  agent: ["agent:read", "agent:write", "decision:read", "audit:read"],
  "operator-read": ["agent:read", "audit:read"],
  owner: ["agent:read", "audit:read", "owner:callback"],
  reconciler: ["calls:reconcile"],
};

const STANDARD_ROLE_IDS: readonly [ApiCredentialRole, string][] = [
  ["agent", "agent"],
  ["owner", "owner"],
  ["operator-read", "operator-read"],
  ["reconciler", "reconciler"],
];

/**
 * Returns a fresh least-privilege scope list for a standard CallYourAgent role.
 *
 * Role presets deliberately never contain `*`. Deployments may still configure
 * custom credentials directly when they need a different split, but normal
 * agent, owner, operator, and reconciliation surfaces should start here instead
 * of accidentally inheriting the legacy full-access token semantics.
 */
export function scopesForCredentialRole(role: ApiCredentialRole): ApiScope[] {
  return [...ROLE_SCOPES[role]];
}

/**
 * Builds a scoped HTTP credential without widening the chosen role.
 * Token/id validation remains centralized in createControlPlaneHttpServer.
 */
export function credentialForRole(
  id: string,
  token: string,
  role: ApiCredentialRole,
): ApiCredential {
  return {
    id,
    token,
    scopes: scopesForCredentialRole(role),
  };
}

/**
 * Builds the recommended four-credential deployment split from a token factory.
 * A factory is injected so tests can stay deterministic while the CLI can use
 * cryptographically random values. The returned ids are stable and tokens are
 * rejected if the supplied factory accidentally repeats a value.
 */
export function standardCredentialBundle(tokenFactory: () => string): ApiCredential[] {
  const credentials = STANDARD_ROLE_IDS.map(([role, id]) => {
    const token = tokenFactory();
    if (!token.trim()) throw new Error("Credential token factory returned an empty token");
    return credentialForRole(id, token, role);
  });
  if (new Set(credentials.map((credential) => credential.token)).size !== credentials.length) {
    throw new Error("Credential token factory must return unique tokens");
  }
  return credentials;
}
