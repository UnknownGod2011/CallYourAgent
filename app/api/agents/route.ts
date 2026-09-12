import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { apiError, optionalText, requiredText } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new Error("Invalid request.");
    const input = body as Record<string, unknown>;
    const { data, error } = await supabase.from("agents").insert({
      user_id: user.id,
      name: requiredText(input.name, "Agent name", 100),
      description: optionalText(input.description, 600),
      system_prompt: optionalText(input.systemPrompt, 6000),
      status: "active",
    }).select("id").single();
    if (error || !data) throw new Error("We could not create the agent.");
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: apiError(error) }, { status: 400 }); }
}
