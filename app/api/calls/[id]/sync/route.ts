import { NextResponse } from "next/server";
import { getCalleCall, isTerminal } from "@/lib/calle";
import { persistProviderObservation } from "@/lib/calls";
import { requireUser } from "@/lib/supabase/server";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const { data: call, error } = await supabase.from("calls").select("id, calle_call_id, status").eq("id", id).single();
  if (error || !call) return NextResponse.json({ error: "Call not found." }, { status: 404 });
  if (!call.calle_call_id || isTerminal(call.status)) return NextResponse.json({ status: call.status });
  try {
    const observation = await getCalleCall(call.calle_call_id);
    const status = await persistProviderObservation(supabase, call.id, observation);
    return NextResponse.json({ status });
  } catch { return NextResponse.json({ error: "We could not refresh this call right now." }, { status: 502 }); }
}
