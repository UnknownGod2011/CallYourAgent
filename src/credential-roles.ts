import type { ApiCredential, ApiScope } from "./http-server.js";

export type ApiCredentialRole = "agent" | "operator-read" | "owner" | "reconciler";

const ROLE_SCOPES: Record<ApiCredentialRole, readonly ApiScope[]> = {
  agent: ["agent:read", "agent:write", "audit:read"],
  "operator-read": ["agent:read", "audit:read"],
  owner: ["agent:read", "audit:read", "owner:callback"],
  reconciler: ["calls:reconcile"],
};

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
