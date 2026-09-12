import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { PhoneCall } from "@/components/icons";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmation?: string }>;
}) {
  const { confirmation } = await searchParams;
  const confirmationMessage = confirmation === "failed"
    ? "This confirmation link could not be completed. Sign in to continue, or create the account again to receive a new link."
    : undefined;

  return <main className="auth-page"><Link className="brand auth-brand" href="/"><span className="brand-mark"><PhoneCall size={18}/></span>CallYourAgent</Link><section className="auth-card"><p className="eyebrow">WELCOME BACK</p><h1>Sign in to your call desk.</h1><p className="muted">Manage your agents and their real conversations.</p><AuthForm mode="login" initialMessage={confirmationMessage}/><p className="auth-switch">New here? <Link href="/signup">Create an account</Link></p></section></main>;
}
