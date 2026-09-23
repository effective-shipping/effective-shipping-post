import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { safeReturnPath, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, type LoginError } from "@/lib/auth";
import { sealJson, sha256Base64Url } from "@/lib/crypto";
import { hasAllowedOrigin } from "@/lib/request";

const LoginSchema = z.object({
  password: z.string().min(1).max(256),
  returnTo: z.string().optional(),
});

const encoder = new TextEncoder();

// The login page posts a native form, so sign-in works before any JavaScript loads.
export async function POST(request: NextRequest) {
  if (!hasAllowedOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const parsed = LoginSchema.safeParse(form ? Object.fromEntries(form) : null);
  const returnTo = safeReturnPath(parsed.success ? parsed.data.returnTo : null);

  const configuredPassword = env.APP_PASSWORD;
  if (!configuredPassword || !env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY.length < 32) {
    return loginFailed(request, "unconfigured", returnTo);
  }
  if (!parsed.success || !(await passwordsMatch(parsed.data.password, configuredPassword))) {
    return loginFailed(request, "password", returnTo);
  }

  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(
    SESSION_COOKIE,
    await sealJson({ userId: "personal", displayName: "Ilija", expiresAt, passwordHash: await sha256Base64Url(configuredPassword) }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    },
  );
  return response;
}

function loginFailed(request: NextRequest, error: LoginError, returnTo: string): NextResponse {
  const url = new URL("/login", request.url);
  url.search = new URLSearchParams({ error, returnTo }).toString();
  return NextResponse.redirect(url, 303);
}

async function passwordsMatch(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
