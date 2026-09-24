import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "cloudflare:workers";

import { openJson, sealJson, secretsMatch, sha256Base64Url } from "@/lib/crypto";

export const SESSION_COOKIE = "es_post_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SessionSchema = z.object({
  userId: z.literal("personal"),
  displayName: z.string().min(1).max(80),
  expiresAt: z.number().int().positive(),
  passwordHash: z.string().min(1),
});

export type AppUser = z.infer<typeof SessionSchema>;

export const LoginErrorSchema = z.enum(["password", "unconfigured"]);
export type LoginError = z.infer<typeof LoginErrorSchema>;

export async function getAppUser(): Promise<AppUser | null> {
  const sealedSession = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sealedSession) return null;

  try {
    const session = SessionSchema.parse(await openJson(sealedSession));
    return session.expiresAt > Date.now() && env.APP_PASSWORD && session.passwordHash === await sha256Base64Url(env.APP_PASSWORD)
      ? session : null;
  } catch {
    return null;
  }
}

// Agents authenticate with a bearer token instead of the browser session. Self-hosted ES Post has one
// token for its single user; a hosted plan would map each issued token to its own user.
export async function getApiUserId(request: Request): Promise<AppUser["userId"] | null> {
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/u)?.[1];
  const expected = env.API_TOKEN;
  if (!token || !expected || expected.length < 32) return null;
  return await secretsMatch(token, expected) ? "personal" : null;
}

// Signs the browser in as the single personal user. The session records a fingerprint of the
// password, so changing APP_PASSWORD signs every browser out.
export async function setSessionCookie(response: NextResponse, request: NextRequest, password: string): Promise<void> {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  response.cookies.set(
    SESSION_COOKIE,
    await sealJson({ userId: "personal", displayName: "Ilija", expiresAt, passwordHash: await sha256Base64Url(password) }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    },
  );
}

export async function requireAppUser(returnTo: string): Promise<AppUser> {
  const user = await getAppUser();
  if (user) return user;

  redirect(`/login?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`);
}

export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, "https://es-post.local");
    if (url.origin !== "https://es-post.local" || url.pathname === "/login") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
