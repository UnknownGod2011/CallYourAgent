import { NextResponse } from "next/server";
import { getCalleCall, isTerminal, startCalleCall, toAppStatus } from "@/lib/calle";
import { createPublicClient } from "@/lib/supabase/public";
import { phoneNumber, requiredText } from "@/lib/validation";
import type { Json } from "@/lib/database.types";

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Agent = { agent_id: string; user_id: string; agent_name: string; description: string | null; system_prompt: string | null; status: string };

const tools = [
  { name: "request_phone_call", description: "Make a real CALL-E phone call when a human answer or action is needed. The caller's CallYourAgent account owns the credits; never request a CALL-E key.", inputSchema: { type: "object", required: ["phoneNumber", "instructions"], properties: { phoneNumber: { type: "string", description: "E.164 recipient phone number, for example +919920090093." }, contactName: { type: "string" }, instructions: { type: "string", description: "What the agent should ask or accomplish on this call." } } } },
  { name: "get_call_status", description: "Read or refresh the real status and result of a call started by this connected agent.", inputSchema: { type: "object", required: ["callId"], properties: { callId: { type: "string" } } } },
  { name: "pull_human_updates", description: "Pull durable instructions a human sent through the CallYourAgent dashboard. Use this at safe checkpoints; do not claim it interrupts an in-progress response.", inputSchema: { type: "object", properties: {} } },
];

export async function POST(request: Request) {
  const body: JsonRpcRequest = await request.json().catch(() => ({}));
  const id = body.id ?? null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(id, -32600, "Invalid JSON-RPC request.");
  if (body.method === "initialize") return rpcResult(id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "CallYourAgent", version: "1.0.0" } });
  if (body.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return rpcError(id, -32001, "A CallYourAgent connection token is required.");
  const supabase = createPublicClient();
  const { data: agents } = await supabase.rpc("cya_agent_authorize", { p_token: token });
  const agent = agents?.[0] as Agent | undefined;
  if (!agent) return rpcError(id, -32001, "This agent connection is invalid, paused, or revoked.");
  if (body.method === "tools/list") return rpcResult(id, { tools });
  if (body.method !== "tools/call") return rpcError(id, -32601, "Method not found.");
  const name = body.params?.name; const args = body.params?.arguments;
  if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) return rpcError(id, -32602, "Invalid tool arguments.");
  const toolArgs = args as Record<string, unknown>;
  try {
    if (name === "request_phone_call") return rpcResult(id, await requestCall(supabase, token, agent, toolArgs));
    if (name === "get_call_status") return rpcResult(id, await getCallStatus(supabase, token, toolArgs));
    if (name === "pull_human_updates") return rpcResult(id, await pullUpdates(supabase, token));
    return rpcError(id, -32602, "Unknown tool.");
  } catch (error) { return rpcResult(id, toolText(error instanceof Error ? error.message : "The request could not be completed.", true)); }
}

async function requestCall(supabase: ReturnType<typeof createPublicClient>, token: string, agent: Agent, args: Record<string, unknown>) {
  const number = phoneNumber(args.phoneNumber); const contact = typeof args.contactName === "string" ? args.contactName.trim().slice(0, 120) : ""; const context = requiredText(args.instructions, "Call instructions", 4000);
  const { data, error } = await supabase.rpc("cya_agent_create_call", { p_token: token, p_phone_number: number, p_contact_name: contact, p_context: context });
  const record = data?.[0]; if (error || !record) throw new Error("We could not create the call record.");
  const task = `You are ${record.agent_name}, making a phone call on behalf of a CallYourAgent user.\n\nPurpose: ${record.description || "No additional description provided."}\n\nInstructions: ${record.system_prompt || "Be helpful, clear, and respectful."}\n\nCall task: ${context}\n\nSpeak naturally, only ask for information needed for the task, and return a factual outcome and summary.`;
  try {
    const provider = await startCalleCall({ task, phoneNumber: number, idempotencyKey: record.call_id, metadata: { app: "callyouragent", app_call_id: record.call_id, agent_id: agent.agent_id } });
    await supabase.rpc("cya_agent_update_call", { p_token: token, p_call_id: record.call_id, p_calle_call_id: provider.id, p_status: toAppStatus(provider.status), p_started_at: provider.status === "in_progress" ? new Date().toISOString() : null });
    return toolText(JSON.stringify({ callId: record.call_id, status: toAppStatus(provider.status), message: "The real call was submitted to CALL-E. Use get_call_status to retrieve its result." }));
  } catch (error) {
    await supabase.rpc("cya_agent_update_call", { p_token: token, p_call_id: record.call_id, p_calle_call_id: null, p_status: "failed", p_ended_at: new Date().toISOString() });
    throw error;
  }
}

async function getCallStatus(supabase: ReturnType<typeof createPublicClient>, token: string, args: Record<string, unknown>) {
  const callId = requiredText(args.callId, "Call ID", 100); let details = await readCall(supabase, token, callId);
  const record = asRecord(details); const calleCallId = typeof record.calleCallId === "string" ? record.calleCallId : null; const status = typeof record.status === "string" ? record.status : "queued";
  if (calleCallId && !isTerminal(status)) {
    const provider = await getCalleCall(calleCallId); const nextStatus = toAppStatus(provider.status); const structured = provider.structured_result ?? null;
    await supabase.rpc("cya_agent_update_call", { p_token: token, p_call_id: callId, p_calle_call_id: provider.id, p_status: nextStatus, p_started_at: provider.started_at ?? null, p_ended_at: isTerminal(provider.status) ? provider.ended_at ?? new Date().toISOString() : null, p_duration_seconds: provider.duration_seconds ?? null, p_outcome: typeof structured?.outcome === "string" ? structured.outcome : null, p_summary: typeof structured?.summary === "string" ? structured.summary : provider.summary ?? null, p_structured_result: structured as Json | null, p_transcript: provider.transcript ?? null });
    details = await readCall(supabase, token, callId);
  }
  return toolText(JSON.stringify(details));
}
async function readCall(supabase: ReturnType<typeof createPublicClient>, token: string, callId: string) { const { data, error } = await supabase.rpc("cya_agent_get_call", { p_token: token, p_call_id: callId }); if (error || !data) throw new Error("Call not found."); return data; }
async function pullUpdates(supabase: ReturnType<typeof createPublicClient>, token: string) { const { data, error } = await supabase.rpc("cya_agent_pull_messages", { p_token: token }); if (error) throw new Error("We could not retrieve human updates."); return toolText(JSON.stringify({ updates: data ?? [] })); }
function asRecord(value: Json): Record<string, Json | undefined> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}; }
function toolText(text: string, isError = false) { return { content: [{ type: "text", text }], isError }; }
function rpcResult(id: string | number | null, result: unknown) { return NextResponse.json({ jsonrpc: "2.0", id, result }); }
function rpcError(id: string | number | null, code: number, message: string) { return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }); }
