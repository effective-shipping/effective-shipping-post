import { redirect } from "next/navigation";

import { getAppUser, LoginErrorSchema, safeReturnPath, type LoginError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const errorMessages = {
  password: "That password is not correct.",
  unconfigured: "Sign-in is not configured. Set APP_PASSWORD and TOKEN_ENCRYPTION_KEY.",
} satisfies Record<LoginError, string>;

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const parameters = await searchParams;
  const returnTo = safeReturnPath(parameters.returnTo);
  if (await getAppUser()) redirect(returnTo);
  const error = LoginErrorSchema.safeParse(parameters.error);

  return (
    <main className="login-shell">
      <section className="login-card">
        <span className="brand"><span className="brand-mark">ES</span><span>Post</span></span>
        <h1>Sign in</h1>
        <p className="login-intro">Your publishing desk for X and LinkedIn.</p>
        <form className="login-form" method="post" action="/api/session">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" autoFocus maxLength={256} required aria-invalid={error.success} aria-describedby={error.success ? "login-error" : undefined} />
          {error.success && <p id="login-error" className="login-error" role="alert">{errorMessages[error.data]}</p>}
          <button type="submit">Sign in</button>
        </form>
      </section>
    </main>
  );
}
