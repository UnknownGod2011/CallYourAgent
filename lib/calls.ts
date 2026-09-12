import type { Database, Json } from "@/lib/database.types";
import { isTerminal, toAppStatus, type CalleCall } from "@/lib/calle";

type Supabase = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export function maskPhone(phone: string) { return phone.length < 5 ? "••••" : `${phone.slice(0, 3)} •••• ${phone.slice(-2)}`; }

export function callTask(agent: Database["public"]["Tables"]["agents"]["Row"], contactName: string | null, context: string) {
  const recipient = contactName ? `the contact ${contactName}` : "the recipient";
  return `You are ${agent.name}, making a phone call on behalf of the CallYourAgent user.\n\nAgent purpose: ${agent.description || "No additional description provided."}\n\nCore instructions:\n${agent.system_prompt || "Be helpful, clear, and respectful."}\n\nCall context: ${context}\n\nSpeak naturally and professionally to ${recipient}. Do not claim capabilities you do not have. Ask only for information needed to fulfill the stated context. End politely and return the requested structured outcome.`;
}

export async function persistProviderObservation(supabase: Supabase, callId: string, observation: CalleCall) {
  const status = toAppStatus(observation.status);
  const callUpdate: Database["public"]["Tables"]["calls"]["Update"] = {
    status,
    started_at: observation.started_at ?? (status === "in_progress" ? new Date().toISOString() : undefined),
  };
  if (isTerminal(observation.status)) {
    callUpdate.ended_at = observation.ended_at ?? new Date().toISOString();
    callUpdate.duration_seconds = observation.duration_seconds ?? null;
  }
  const { error: callError } = await supabase.from("calls").update(callUpdate).eq("id", callId);
  if (callError) throw new Error("We could not save the latest call status.");
  if (status === "completed") {
    const structured = observation.structured_result ?? null;
    const outcome = typeof structured?.outcome === "string" ? structured.outcome : null;
    const summary = typeof structured?.summary === "string" ? structured.summary : observation.summary ?? null;
    const { error } = await supabase.from("call_results").upsert({
      call_id: callId,
      outcome,
      summary,
      transcript: observation.transcript ?? null,
      structured_result: structured as Json | null,
    }, { onConflict: "call_id" });
    if (error) throw new Error("We could not save the call result.");
  }
  return status;
}
