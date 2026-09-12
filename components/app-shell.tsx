import Link from "next/link";
import { Bot, PhoneCall, Sparkles } from "@/components/icons";
import { SignOut } from "@/components/sign-out";
export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="app-shell"><header className="app-header"><Link href="/dashboard" className="brand"><span className="brand-mark"><PhoneCall size={18}/></span>CallYourAgent</Link><nav><Link href="/agents">Agents</Link><Link className="button button-small" href="/calls/new"><PhoneCall size={15}/> Make a call</Link><SignOut /></nav></header><main className="app-main">{children}</main></div>;
}
