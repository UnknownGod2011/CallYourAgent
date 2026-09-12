import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { apiError, optionalText, requiredText } from "@/lib/validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const { supabase, user } = await requireUser();
    if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    const body: unknown = await request.json(); if (!body || typeof body !== "object") throw new Error("Invalid request.");
    const input = body as Record<string, unknown>;
    const status = input.status;
    if (status !== "active" && status !== "paused" && status !== "archived") throw new Error("Invalid agent status.");
    const { error } = await supabase.from("agents").update({
      name: requiredText(input.name, "Agent name", 100), description: optionalText(input.description, 600),
      system_prompt: optionalText(input.systemPrompt, 6000), status,
    }).eq("id", id);
    if (error) throw new Error("We could not update this agent.");
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: apiError(error) }, { status: 400 }); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const { error } = await supabase.from("agents").update({ status: "archived" }).eq("id", id);
  if (error) return NextResponse.json({ error: "We could not archive this agent." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
