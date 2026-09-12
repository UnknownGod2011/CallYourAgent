"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "@/components/icons";
export function SignOut() { const router = useRouter(); return <button className="nav-link" onClick={async () => { await createClient().auth.signOut(); router.replace("/"); router.refresh(); }}><LogOut size={16}/> Sign out</button>; }
