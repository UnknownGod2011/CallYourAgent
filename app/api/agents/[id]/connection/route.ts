import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { apiError } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const { supabase, user } = await requireUser();
    if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    const body: unknown = await request.json().catch(() => ({}));
    const host = body && typeof body === "object" && typeof (body as Record<string, unknown>).host === "string" ? (body as Record<string, string>).host : "generic";
    const { data, error } = await supabase.rpc("cya_create_agent_connection", { p_agent_id: id, p_host: host });
    if (error || !data) throw new Error("We could not create the agent connection. Apply the hosted connector migration first.");
    return NextResponse.json(data);
  } catch (error) { return NextResponse.json({ error: apiError(error) }, { status: 400 }); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; const { supabase, user } = await requireUser(); if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 }); const { error } = await supabase.rpc("cya_revoke_agent_connection", { p_agent_id: id }); if (error) throw new Error("We could not revoke this connection."); return NextResponse.json({ ok: true }); } catch (error) { return NextResponse.json({ error: apiError(error) }, { status: 400 }); }
}
