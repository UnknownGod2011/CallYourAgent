"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({
  mode,
  initialMessage,
}: {
  mode: "login" | "signup";
  initialMessage?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | undefined>(initialMessage);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setMessage(undefined); const supabase = createClient();
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message); else router.replace(new URLSearchParams(window.location.search).get("next") || "/dashboard");
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (error) setMessage(error.message); else if (data.session) router.replace("/dashboard"); else setMessage("Check your inbox to confirm your email, then sign in.");
    }
    setLoading(false);
  }
  return <form className="auth-form" onSubmit={submit}>
    {mode === "signup" && <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={100} /></label>}
    <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
    <label>Password<input required minLength={6} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></label>
    {message && <p className="form-message">{message}</p>}
    <button className="button button-primary button-wide" disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
  </form>;
}
