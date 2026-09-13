import { redirect } from "next/navigation";
import Link from "next/link";

import { getAppUser, safeReturnPath } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ returnTo?: string }>;
}) {
  const returnTo = safeReturnPath((await searchParams).returnTo);
  if (await getAppUser()) redirect(returnTo);

  return (
    <main className="login-shell">
      <section className="login-card">
        <Link className="brand" href="/" aria-label="Twofold home"><span className="brand-mark">2F</span><span>Twofold</span></Link>
        <p className="eyebrow">Private workspace</p>
        <h1>One password. Two places.</h1>
        <p className="login-intro">Your personal publishing desk for X and LinkedIn.</p>
        <LoginForm returnTo={returnTo} />
      </section>
    </main>
  );
}
