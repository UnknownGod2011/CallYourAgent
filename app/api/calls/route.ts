import { NextResponse } from "next/server";
import { startCalleCall, toAppStatus } from "@/lib/calle";
import { callTask, persistProviderObservation } from "@/lib/calls";
import { requireUser } from "@/lib/supabase/server";
import { apiError, optionalText, phoneNumber, requiredText } from "@/lib/validation";

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  let callId: string | undefined;
  try {
    const body: unknown = await request.json(); if (!body || typeof body !== "object") throw new Error("Invalid request.");
    const input = body as Record<string, unknown>;
    const agentId = requiredText(input.agentId, "Agent", 100);
    const number = phoneNumber(input.phoneNumber);
    const contactName = optionalText(input.contactName, 120);
    const context = requiredText(input.context, "Call instructions", 4000);
    const { data: agent, error: agentError } = await supabase.from("agents").select("*").eq("id", agentId).eq("status", "active").single();
    if (agentError || !agent) return NextResponse.json({ error: "Choose one of your active agents." }, { status: 404 });
    const { data: call, error: createError } = await supabase.from("calls").insert({
      user_id: user.id, agent_id: agent.id, phone_number: number, contact_name: contactName, status: "queued",
    }).select("id").single();
    if (createError || !call) throw new Error("We could not create the call record.");
    callId = call.id;
    const providerCall = await startCalleCall({
      task: callTask(agent, contactName, context), phoneNumber: number, idempotencyKey: call.id,
      metadata: { app: "callyouragent", app_call_id: call.id, agent_id: agent.id },
    });
    const { error: updateError } = await supabase.from("calls").update({
      calle_call_id: providerCall.id, status: toAppStatus(providerCall.status), started_at: providerCall.status === "in_progress" ? new Date().toISOString() : null,
    }).eq("id", call.id);
    if (updateError) throw new Error("The call started, but we could not save its tracking ID.");
    if (providerCall.status === "completed") await persistProviderObservation(supabase, call.id, providerCall);
    return NextResponse.json({ id: call.id, status: toAppStatus(providerCall.status) }, { status: 201 });
  } catch (error) {
    if (callId) await supabase.from("calls").update({ status: "failed", ended_at: new Date().toISOString() }).eq("id", callId);
    return NextResponse.json({ error: apiError(error) }, { status: 400 });
  }
}
