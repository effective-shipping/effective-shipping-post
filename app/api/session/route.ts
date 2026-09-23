import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { safeReturnPath, setSessionCookie, type LoginError } from "@/lib/auth";
import { secretsMatch } from "@/lib/crypto";
import { hasAllowedOrigin } from "@/lib/request";

const LoginSchema = z.object({
  password: z.string().min(1).max(256),
  returnTo: z.string().optional(),
});

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
  if (!parsed.success || !(await secretsMatch(parsed.data.password, configuredPassword))) {
    return loginFailed(request, "password", returnTo);
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  await setSessionCookie(response, request, configuredPassword);
  return response;
}

function loginFailed(request: NextRequest, error: LoginError, returnTo: string): NextResponse {
  const url = new URL("/login", request.url);
  url.search = new URLSearchParams({ error, returnTo }).toString();
  return NextResponse.redirect(url, 303);
}
