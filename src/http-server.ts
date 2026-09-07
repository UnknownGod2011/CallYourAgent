import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { parseCalleTerminalWebhook } from "./calle-webhook.js";
import type { ControlPlane } from "./control-plane.js";
import { operatorConsoleHtml } from "./operator-ui.js";
import { getRunOverview } from "./run-overview.js";

export type ApiScope = "agent:read" | "agent:write" | "audit:read" | "owner:callback" | "calls:reconcile" | "*";

export interface ApiCredential {
  id: string;
  token: string;
  scopes: ApiScope[];
}

export interface CredentialCapabilities {
  credentialId: string;
  scopes: Exclude<ApiScope, "*">[];
}

const CONCRETE_API_SCOPES: Exclude<ApiScope, "*">[] = [
  "agent:read",
  "agent:write",
  "audit:read",
  "owner:callback",
  "calls:reconcile",
];

export interface HttpRateLimitOptions {
  ownerCallbacksPerWindow?: number;
  reconciliationsPerWindow?: number;
  windowMs?: number;
}

export interface ReadinessSnapshot {
  ready: boolean;
  providerMode: "fake" | "calle";
  storeMode: "memory" | "sqlite";
  liveCallConfiguration: "configured" | "not_applicable";
  publicWebhookConfiguration: "configured" | "not_applicable";
  providerNetworkChecked: false;
}

export interface HttpServerOptions {
  /** Backwards-compatible trusted token. Prefer apiCredentials for exposed deployments. */
  apiToken?: string;
  apiCredentials?: ApiCredential[];
  calleWebhookToken?: string;
  maxBodyBytes?: number;
  rateLimits?: HttpRateLimitOptions;
  readiness?: ReadinessSnapshot;
}

interface RateLimitEntry {
  windowStartedAt: number;
  count: number;
}

export function createControlPlaneHttpServer(controlPlane: ControlPlane, options: HttpServerOptions): Server {
  const credentials = normalizeCredentials(options);
  const maxBodyBytes = options.maxBodyBytes ?? 256_000;
  const rateWindowMs = positive(options.rateLimits?.windowMs ?? 60_000, "rate limit window");
  const callbackLimit = nonNegative(options.rateLimits?.ownerCallbacksPerWindow ?? 6, "owner callback rate limit");
  const reconcileLimit = nonNegative(options.rateLimits?.reconciliationsPerWindow ?? 60, "reconciliation rate limit");
  const rateLimits = new Map<string, RateLimitEntry>();

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/ready") {
        const readiness = options.readiness ?? {
          ready: true,
          providerMode: "fake" as const,
          storeMode: "memory" as const,
          liveCallConfiguration: "not_applicable" as const,
          publicWebhookConfiguration: "not_applicable" as const,
          providerNetworkChecked: false as const,
        };
        return json(res, readiness.ready ? 200 : 503, readiness);
      }
      if (req.method === "GET" && url.pathname === "/operator") return html(res, 200, operatorConsoleHtml());

      if (req.method === "POST" && url.pathname === "/webhooks/calle") {
        if (!options.calleWebhookToken || !safeEqual(url.searchParams.get("token") ?? "", options.calleWebhookToken)) {
          return json(res, 401, { error: "unauthorized_webhook" });
        }
        const payload = await readJson(req, maxBodyBytes);
        const parsed = parseCalleTerminalWebhook(payload);
        if (!parsed) return json(res, 202, { accepted: false, reason: "non_terminal_or_invalid" });
        const headerEventId = req.headers["call-e-event-id"];
        if (typeof headerEventId !== "string" || headerEventId !== parsed.eventId) {
          return json(res, 400, { error: "event_id_mismatch" });
        }
        const result = controlPlane.ingestProviderWebhook(parsed);
        return json(res, 200, { accepted: true, duplicate: result.duplicate });
      }

      const credential = authenticate(req, credentials);
      if (!credential) return json(res, 401, { error: "unauthorized" });

      if (req.method === "GET" && url.pathname === "/v1/auth/capabilities") {
        return json(res, 200, credentialCapabilities(credential));
      }

      const body = req.method === "POST" || req.method === "PATCH" ? await readJson(req, maxBodyBytes) : undefined;

      if (req.method === "POST" && url.pathname === "/v1/agents") {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 201, controlPlane.registerAgent({
          name: text(value.name, "name"),
          platform: text(value.platform, "platform"),
          ownerId: text(value.ownerId, "ownerId"),
        }));
      }

      if (req.method === "POST" && url.pathname === "/v1/runs") {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 201, controlPlane.startRun(
          text(value.agentId, "agentId"),
          text(value.summary, "summary"),
          optionalText(value.currentScope),
        ));
      }

      const auditMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/audit$/);
      if (req.method === "GET" && auditMatch) {
        if (!hasScope(credential, "audit:read")) return forbidden(res, "audit:read");
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 100 : Number(rawLimit);
        return json(res, 200, { events: controlPlane.listAuditEvents(decodeURIComponent(auditMatch[1]!), limit) });
      }

      const overviewMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/overview$/);
      if (req.method === "GET" && overviewMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        return json(res, 200, getRunOverview(controlPlane, decodeURIComponent(overviewMatch[1]!)));
      }

      const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
      if (req.method === "GET" && runMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        return json(res, 200, controlPlane.getRun(decodeURIComponent(runMatch[1]!)));
      }

      const heartbeatMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/heartbeat$/);
      if (req.method === "POST" && heartbeatMatch) {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 200, controlPlane.heartbeat(decodeURIComponent(heartbeatMatch[1]!), {
          summary: optionalText(value.summary), currentScope: optionalText(value.currentScope),
        }));
      }

      const checkpointMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/checkpoint$/);
      if (req.method === "POST" && checkpointMatch) {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 200, controlPlane.checkpoint(decodeURIComponent(checkpointMatch[1]!), value.consume === true));
      }

      const acknowledgeMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/instructions\/ack$/);
      if (req.method === "POST" && acknowledgeMatch) {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 200, {
          instructions: controlPlane.acknowledgeInstructions(
            decodeURIComponent(acknowledgeMatch[1]!),
            stringArray(value.instructionIds, "instructionIds"),
          ),
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/escalations") {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        const escalation = await controlPlane.requestOwnerDecision({
          runId: text(value.runId, "runId"), scopeId: text(value.scopeId, "scopeId"),
          question: text(value.question, "question"), context: optionalText(value.context),
          blocking: boolean(value.blocking, "blocking"),
          priority: value.priority as "low" | "normal" | "high" | "critical" | undefined,
          expiresAt: optionalText(value.expiresAt), idempotencyKey: text(value.idempotencyKey, "idempotencyKey"),
        });
        return json(res, 201, escalation);
      }

      const escalationMatch = url.pathname.match(/^\/v1\/escalations\/([^/]+)$/);
      if (req.method === "GET" && escalationMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        const id = decodeURIComponent(escalationMatch[1]!);
        return json(res, 200, { escalation: controlPlane.getEscalation(id), decision: controlPlane.getDecision(id) ?? null });
      }

      const reconcileEscalationMatch = url.pathname.match(/^\/v1\/escalations\/([^/]+)\/reconcile$/);
      if (req.method === "POST" && reconcileEscalationMatch) {
        if (!hasScope(credential, "calls:reconcile")) return forbidden(res, "calls:reconcile");
        if (!consumeRateLimit(rateLimits, credential.id, "reconcile", reconcileLimit, rateWindowMs, res)) return;
        return json(res, 200, await controlPlane.reconcileEscalation(decodeURIComponent(reconcileEscalationMatch[1]!)));
      }

      if (req.method === "POST" && url.pathname === "/v1/callbacks") {
        if (!hasScope(credential, "owner:callback")) return forbidden(res, "owner:callback");
        if (!consumeRateLimit(rateLimits, credential.id, "callback", callbackLimit, rateWindowMs, res)) return;
        const value = record(body);
        return json(res, 201, await controlPlane.requestOwnerCallback({
          runId: text(value.runId, "runId"), idempotencyKey: text(value.idempotencyKey, "idempotencyKey"), prompt: optionalText(value.prompt),
        }));
      }

      const callbackMatch = url.pathname.match(/^\/v1\/callbacks\/([^/]+)$/);
      if (req.method === "GET" && callbackMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        return json(res, 200, controlPlane.getCallAttempt(decodeURIComponent(callbackMatch[1]!)));
      }

      const reconcileCallbackMatch = url.pathname.match(/^\/v1\/callbacks\/([^/]+)\/reconcile$/);
      if (req.method === "POST" && reconcileCallbackMatch) {
        if (!hasScope(credential, "calls:reconcile")) return forbidden(res, "calls:reconcile");
        if (!consumeRateLimit(rateLimits, credential.id, "reconcile", reconcileLimit, rateWindowMs, res)) return;
        return json(res, 200, await controlPlane.reconcileCallback(decodeURIComponent(reconcileCallbackMatch[1]!)));
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown ") ? 404 : 400;
      return json(res, status, { error: message });
    }
  });
}

function normalizeCredentials(options: HttpServerOptions): ApiCredential[] {
  const credentials: ApiCredential[] = [];
  if (options.apiToken?.trim()) credentials.push({ id: "legacy", token: options.apiToken, scopes: ["*"] });
  for (const credential of options.apiCredentials ?? []) {
    if (!credential.id.trim()) throw new Error("API credential id is required");
    if (!credential.token.trim()) throw new Error(`API credential ${credential.id} token is required`);
    if (credential.scopes.length === 0) throw new Error(`API credential ${credential.id} must have at least one scope`);
    credentials.push({ ...credential, scopes: [...credential.scopes] });
  }
  if (credentials.length === 0) throw new Error("At least one API credential is required");
  if (new Set(credentials.map((credential) => credential.id)).size !== credentials.length) throw new Error("API credential ids must be unique");
  if (new Set(credentials.map((credential) => credential.token)).size !== credentials.length) throw new Error("API credential tokens must be unique");
  return credentials;
}

function authenticate(req: IncomingMessage, credentials: ApiCredential[]): ApiCredential | undefined {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice(7);
  return credentials.find((credential) => safeEqual(token, credential.token));
}

function credentialCapabilities(credential: ApiCredential): CredentialCapabilities {
  return {
    credentialId: credential.id,
    scopes: credential.scopes.includes("*")
      ? [...CONCRETE_API_SCOPES]
      : CONCRETE_API_SCOPES.filter((scope) => credential.scopes.includes(scope)),
  };
}

function hasScope(credential: ApiCredential, scope: ApiScope): boolean {
  return credential.scopes.includes("*") || credential.scopes.includes(scope);
}

function forbidden(res: ServerResponse, requiredScope: ApiScope): void {
  json(res, 403, { error: "forbidden", requiredScope });
}

function consumeRateLimit(
  entries: Map<string, RateLimitEntry>, credentialId: string, bucket: string, limit: number, windowMs: number, res: ServerResponse,
): boolean {
  const now = Date.now();
  const key = `${credentialId}:${bucket}`;
  const current = entries.get(key);
  const entry = !current || now - current.windowStartedAt >= windowMs ? { windowStartedAt: now, count: 0 } : current;
  if (entry.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStartedAt + windowMs - now) / 1000));
    res.setHeader("retry-after", String(retryAfterSeconds));
    json(res, 429, { error: "rate_limited", retryAfterSeconds });
    return false;
  }
  entry.count += 1;
  entries.set(key, entry);
  return true;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("request_body_too_large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("invalid_json"); }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("JSON object body required");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`); return value; }
function optionalText(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function boolean(value: unknown, field: string): boolean { if (typeof value !== "boolean") throw new Error(`${field} must be boolean`); return value; }
function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${field} must be an array of non-empty strings`);
  return value as string[];
}
function positive(value: number, name: string): number { if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`); return value; }
function nonNegative(value: number, name: string): number { if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`); return value; }
function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
}
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}