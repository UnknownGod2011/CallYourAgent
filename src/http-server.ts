import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { parseCalleTerminalWebhook } from "./calle-webhook.js";
import { toOwnerCallbackView } from "./callback-view.js";
import { IDEMPOTENCY_CONFLICT_MESSAGE, type ControlPlane } from "./control-plane.js";
import type { EscalationPriority } from "./domain.js";
import { getEscalationLifecycleView } from "./escalation-view.js";
import { operatorConsoleHtml } from "./operator-ui.js";
import { getRunOverview } from "./run-overview.js";

export type ApiScope = "agent:read" | "agent:write" | "decision:read" | "audit:read" | "owner:callback" | "calls:reconcile" | "*";

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
  "decision:read",
  "audit:read",
  "owner:callback",
  "calls:reconcile",
];

const ESCALATION_PRIORITIES: readonly EscalationPriority[] = ["low", "normal", "high", "critical"];
const ISO_DATE_TIME_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const AUDIT_LIMIT_PATTERN = /^[1-9]\d{0,2}$/;
const INVALID_PATH_IDENTIFIER = "invalid_path_identifier";
const UNEXPECTED_QUERY_PARAMETER = "unexpected_query_parameter";

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

export interface RedactedCalleWebhookTarget {
  target: string;
  token?: string;
  isCalleWebhook: boolean;
}

/**
 * Extract the application-owned CALL-E webhook capability and return a request
 * target with every `token` query parameter removed. The HTTP server applies
 * this at the beginning of request handling and overwrites IncomingMessage.url
 * so later in-process diagnostics cannot accidentally serialize the secret URL.
 *
 * This cannot redact logs produced by a reverse proxy/CDN before Node receives
 * the request; exposed deployments must still suppress/redact webhook queries
 * at the ingress layer.
 */
export function redactCalleWebhookRequestTarget(target: string): RedactedCalleWebhookTarget {
  try {
    const url = new URL(target, "http://localhost");
    if (url.pathname !== "/webhooks/calle") return { target, isCalleWebhook: false };
    const tokens = url.searchParams.getAll("token");
    const token = tokens.length === 1 ? tokens[0] : undefined;
    url.searchParams.delete("token");
    const remainingQuery = url.searchParams.toString();
    return {
      target: `${url.pathname}${remainingQuery ? `?${remainingQuery}` : ""}`,
      token,
      isCalleWebhook: true,
    };
  } catch {
    return { target, isCalleWebhook: false };
  }
}

export function createControlPlaneHttpServer(controlPlane: ControlPlane, options: HttpServerOptions): Server {
  const credentials = normalizeCredentials(options);
  const maxBodyBytes = options.maxBodyBytes ?? 256_000;
  const rateWindowMs = positive(options.rateLimits?.windowMs ?? 60_000, "rate limit window");
  const callbackLimit = nonNegative(options.rateLimits?.ownerCallbacksPerWindow ?? 6, "owner callback rate limit");
  const reconcileLimit = nonNegative(options.rateLimits?.reconciliationsPerWindow ?? 60, "reconciliation rate limit");
  const rateLimits = new Map<string, RateLimitEntry>();

  return createServer(async (req, res) => {
    const webhookTarget = redactCalleWebhookRequestTarget(req.url ?? "/");
    if (webhookTarget.isCalleWebhook) req.url = webhookTarget.target;

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
        if (!options.calleWebhookToken || !safeEqual(webhookTarget.token ?? "", options.calleWebhookToken)) {
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

      if (url.pathname.startsWith("/v1/")) {
        const allowedQueryKeys = /^\/v1\/runs\/[^/]+\/audit$/.test(url.pathname) ? ["limit"] : [];
        assertAllowedQueryParameters(url.searchParams, allowedQueryKeys);
      }

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
          optionalText(value.currentScope, "currentScope"),
        ));
      }

      const auditMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/audit$/);
      if (req.method === "GET" && auditMatch) {
        if (!hasScope(credential, "audit:read")) return forbidden(res, "audit:read");
        const limit = auditLimit(url.searchParams);
        return json(res, 200, { events: controlPlane.listAuditEvents(pathIdentifier(auditMatch[1]!), limit) });
      }

      const overviewMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/overview$/);
      if (req.method === "GET" && overviewMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        return json(res, 200, getRunOverview(controlPlane, pathIdentifier(overviewMatch[1]!)));
      }

      const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
      if (req.method === "GET" && runMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        return json(res, 200, controlPlane.getRun(pathIdentifier(runMatch[1]!)));
      }

      const heartbeatMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/heartbeat$/);
      if (req.method === "POST" && heartbeatMatch) {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 200, controlPlane.heartbeat(pathIdentifier(heartbeatMatch[1]!), {
          summary: optionalText(value.summary, "summary"), currentScope: optionalText(value.currentScope, "currentScope"),
        }));
      }

      const checkpointMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/checkpoint$/);
      if (req.method === "POST" && checkpointMatch) {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 200, controlPlane.checkpoint(
          pathIdentifier(checkpointMatch[1]!),
          optionalBoolean(value.consume, "consume") ?? false,
        ));
      }

      const acknowledgeMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/instructions\/ack$/);
      if (req.method === "POST" && acknowledgeMatch) {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        return json(res, 200, {
          instructions: controlPlane.acknowledgeInstructions(
            pathIdentifier(acknowledgeMatch[1]!),
            stringArray(value.instructionIds, "instructionIds"),
          ),
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/escalations") {
        if (!hasScope(credential, "agent:write")) return forbidden(res, "agent:write");
        const value = record(body);
        const escalation = await controlPlane.requestOwnerDecision({
          runId: text(value.runId, "runId"), scopeId: text(value.scopeId, "scopeId"),
          question: text(value.question, "question"), context: optionalText(value.context, "context"),
          blocking: boolean(value.blocking, "blocking"),
          priority: optionalEscalationPriority(value.priority),
          expiresAt: optionalIsoDateTime(value.expiresAt, "expiresAt"), idempotencyKey: text(value.idempotencyKey, "idempotencyKey"),
        });
        return json(res, 201, escalation);
      }

      const escalationLifecycleMatch = url.pathname.match(/^\/v1\/escalations\/([^/]+)\/status$/);
      if (req.method === "GET" && escalationLifecycleMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        return json(res, 200, getEscalationLifecycleView(controlPlane, pathIdentifier(escalationLifecycleMatch[1]!)));
      }

      const escalationMatch = url.pathname.match(/^\/v1\/escalations\/([^/]+)$/);
      if (req.method === "GET" && escalationMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        if (!hasScope(credential, "decision:read")) return forbidden(res, "decision:read");
        const id = pathIdentifier(escalationMatch[1]!);
        return json(res, 200, { escalation: controlPlane.getEscalation(id), decision: controlPlane.getDecision(id) ?? null });
      }

      const reconcileEscalationMatch = url.pathname.match(/^\/v1\/escalations\/([^/]+)\/reconcile$/);
      if (req.method === "POST" && reconcileEscalationMatch) {
        if (!hasScope(credential, "calls:reconcile")) return forbidden(res, "calls:reconcile");
        const id = pathIdentifier(reconcileEscalationMatch[1]!);
        if (!consumeRateLimit(rateLimits, credential.id, "reconcile", reconcileLimit, rateWindowMs, res)) return;
        await controlPlane.reconcileEscalation(id);
        return json(res, 200, getEscalationLifecycleView(controlPlane, id));
      }

      if (req.method === "POST" && url.pathname === "/v1/callbacks") {
        if (!hasScope(credential, "owner:callback")) return forbidden(res, "owner:callback");
        if (!consumeRateLimit(rateLimits, credential.id, "callback", callbackLimit, rateWindowMs, res)) return;
        const value = record(body);
        const attempt = await controlPlane.requestOwnerCallback({
          runId: text(value.runId, "runId"), idempotencyKey: text(value.idempotencyKey, "idempotencyKey"), prompt: optionalText(value.prompt, "prompt"),
        });
        return json(res, 201, toOwnerCallbackView(attempt));
      }

      const callbackMatch = url.pathname.match(/^\/v1\/callbacks\/([^/]+)$/);
      if (req.method === "GET" && callbackMatch) {
        if (!hasScope(credential, "agent:read")) return forbidden(res, "agent:read");
        return json(res, 200, toOwnerCallbackView(controlPlane.getCallAttempt(pathIdentifier(callbackMatch[1]!))));
      }

      const reconcileCallbackMatch = url.pathname.match(/^\/v1\/callbacks\/([^/]+)\/reconcile$/);
      if (req.method === "POST" && reconcileCallbackMatch) {
        if (!hasScope(credential, "calls:reconcile")) return forbidden(res, "calls:reconcile");
        const id = pathIdentifier(reconcileCallbackMatch[1]!);
        if (!consumeRateLimit(rateLimits, credential.id, "reconcile", reconcileLimit, rateWindowMs, res)) return;
        return json(res, 200, toOwnerCallbackView(await controlPlane.reconcileCallback(id)));
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      const response = publicHttpError(error);
      return json(res, response.status, { error: response.error });
    }
  });
}

function publicHttpError(error: unknown): { status: number; error: string } {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Unknown ")) return { status: 404, error: "not_found" };
  if (message === "request_body_too_large") return { status: 413, error: message };
  if (message === "Run is not running" || /^Run .+ is not running$/.test(message)) return { status: 409, error: "run_not_running" };
  if (/^Instruction .+ does not belong to run .+$/.test(message)) return { status: 409, error: "instruction_run_mismatch" };
  if (message === "Call attempt is not an owner callback") return { status: 409, error: "callback_purpose_mismatch" };
  if (message === IDEMPOTENCY_CONFLICT_MESSAGE) return { status: 409, error: "idempotency_conflict" };
  if (message === INVALID_PATH_IDENTIFIER) return { status: 400, error: INVALID_PATH_IDENTIFIER };
  if (message === UNEXPECTED_QUERY_PARAMETER) return { status: 400, error: UNEXPECTED_QUERY_PARAMETER };
  if (
    message === "invalid_json"
    || message === "JSON object body required"
    || message === "Provider webhook event id is required"
    || message === "Provider call id is required"
    || message === "Audit event limit must be an integer from 1 to 500"
    || message === "priority must be one of: low, normal, high, critical"
    || message === "expiresAt must be an ISO 8601 date-time with timezone"
    || /^[A-Za-z][A-Za-z0-9]* is required$/.test(message)
    || /^[A-Za-z][A-Za-z0-9]* must be a string$/.test(message)
    || /^[A-Za-z][A-Za-z0-9]* must be boolean$/.test(message)
    || /^[A-Za-z][A-Za-z0-9]* must be an array of non-empty strings$/.test(message)
  ) return { status: 400, error: message };
  return { status: 500, error: "internal_error" };
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
function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value.trim() ? value : undefined;
}
function boolean(value: unknown, field: string): boolean { if (typeof value !== "boolean") throw new Error(`${field} must be boolean`); return value; }
function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  return boolean(value, field);
}
function optionalEscalationPriority(value: unknown): EscalationPriority | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !ESCALATION_PRIORITIES.includes(value as EscalationPriority)) {
    throw new Error("priority must be one of: low, normal, high, critical");
  }
  return value as EscalationPriority;
}
function optionalIsoDateTime(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be an ISO 8601 date-time with timezone`);
  const match = ISO_DATE_TIME_WITH_ZONE.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const maxDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
    if (day >= 1 && day <= maxDay && Number.isFinite(Date.parse(value))) return value;
  }
  throw new Error(`${field} must be an ISO 8601 date-time with timezone`);
}
function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${field} must be an array of non-empty strings`);
  return value as string[];
}
function auditLimit(searchParams: URLSearchParams): number {
  const values = searchParams.getAll("limit");
  if (values.length === 0) return 100;
  if (values.length !== 1 || !AUDIT_LIMIT_PATTERN.test(values[0]!)) {
    throw new Error("Audit event limit must be an integer from 1 to 500");
  }
  const limit = Number(values[0]);
  if (limit < 1 || limit > 500) throw new Error("Audit event limit must be an integer from 1 to 500");
  return limit;
}
function assertAllowedQueryParameters(searchParams: URLSearchParams, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key)) throw new Error(UNEXPECTED_QUERY_PARAMETER);
  }
}
function pathIdentifier(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(INVALID_PATH_IDENTIFIER);
  }
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
