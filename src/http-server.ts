import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { parseCalleTerminalWebhook } from "./calle-webhook.js";
import type { ControlPlane } from "./control-plane.js";

export interface HttpServerOptions {
  apiToken: string;
  calleWebhookToken?: string;
  maxBodyBytes?: number;
}

export function createControlPlaneHttpServer(controlPlane: ControlPlane, options: HttpServerOptions): Server {
  if (!options.apiToken.trim()) throw new Error("CYA_API_TOKEN is required");
  const maxBodyBytes = options.maxBodyBytes ?? 256_000;

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });

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

      if (!hasBearer(req, options.apiToken)) return json(res, 401, { error: "unauthorized" });

      const body = req.method === "POST" || req.method === "PATCH" ? await readJson(req, maxBodyBytes) : undefined;

      if (req.method === "POST" && url.pathname === "/v1/agents") {
        const value = record(body);
        return json(res, 201, controlPlane.registerAgent({
          name: text(value.name, "name"),
          platform: text(value.platform, "platform"),
          ownerId: text(value.ownerId, "ownerId"),
        }));
      }

      if (req.method === "POST" && url.pathname === "/v1/runs") {
        const value = record(body);
        return json(res, 201, controlPlane.startRun(
          text(value.agentId, "agentId"),
          text(value.summary, "summary"),
          optionalText(value.currentScope),
        ));
      }

      const auditMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/audit$/);
      if (req.method === "GET" && auditMatch) {
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 100 : Number(rawLimit);
        return json(res, 200, { events: controlPlane.listAuditEvents(decodeURIComponent(auditMatch[1]!), limit) });
      }

      const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
      if (req.method === "GET" && runMatch) return json(res, 200, controlPlane.getRun(decodeURIComponent(runMatch[1]!)));

      const heartbeatMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/heartbeat$/);
      if (req.method === "POST" && heartbeatMatch) {
        const value = record(body);
        return json(res, 200, controlPlane.heartbeat(decodeURIComponent(heartbeatMatch[1]!), {
          summary: optionalText(value.summary), currentScope: optionalText(value.currentScope),
        }));
      }

      const checkpointMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/checkpoint$/);
      if (req.method === "POST" && checkpointMatch) {
        const value = record(body);
        return json(res, 200, controlPlane.checkpoint(decodeURIComponent(checkpointMatch[1]!), value.consume === true));
      }

      if (req.method === "POST" && url.pathname === "/v1/escalations") {
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
        const id = decodeURIComponent(escalationMatch[1]!);
        return json(res, 200, { escalation: controlPlane.getEscalation(id), decision: controlPlane.getDecision(id) ?? null });
      }

      const reconcileEscalationMatch = url.pathname.match(/^\/v1\/escalations\/([^/]+)\/reconcile$/);
      if (req.method === "POST" && reconcileEscalationMatch) {
        return json(res, 200, await controlPlane.reconcileEscalation(decodeURIComponent(reconcileEscalationMatch[1]!)));
      }

      if (req.method === "POST" && url.pathname === "/v1/callbacks") {
        const value = record(body);
        return json(res, 201, await controlPlane.requestOwnerCallback({
          runId: text(value.runId, "runId"), idempotencyKey: text(value.idempotencyKey, "idempotencyKey"), prompt: optionalText(value.prompt),
        }));
      }

      const callbackMatch = url.pathname.match(/^\/v1\/callbacks\/([^/]+)$/);
      if (req.method === "GET" && callbackMatch) return json(res, 200, controlPlane.getCallAttempt(decodeURIComponent(callbackMatch[1]!)));

      const reconcileCallbackMatch = url.pathname.match(/^\/v1\/callbacks\/([^/]+)\/reconcile$/);
      if (req.method === "POST" && reconcileCallbackMatch) {
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

function hasBearer(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  return typeof header === "string" && header.startsWith("Bearer ") && safeEqual(header.slice(7), token);
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
function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
}
