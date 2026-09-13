"use client";

import { FormEvent, useState } from "react";
import { z } from "zod";

const LoginResponseSchema = z.object({ returnTo: z.string() });
const ErrorResponseSchema = z.object({ error: z.string() });

export function LoginForm({ returnTo }: { readonly returnTo: string }) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/session", {
        signal: AbortSignal.timeout(15_000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.get("password"), returnTo }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const result = ErrorResponseSchema.safeParse(body);
        setError(result.success ? result.data.error : "Twofold could not sign you in.");
        return;
      }
      window.location.assign(LoginResponseSchema.parse(body).returnTo);
    } catch {
      setError("Twofold could not sign you in. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="password">Personal password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" autoFocus maxLength={256} disabled={submitting} required />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>{submitting ? "Opening…" : "Open Twofold"}</button>
    </form>
  );
}
