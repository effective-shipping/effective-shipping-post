import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { safeReturnPath, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { sealJson, sha256Base64Url } from "@/lib/crypto";
import { hasAllowedOrigin } from "@/lib/request";

const LoginSchema = z.object({
  password: z.string().min(1).max(256),
  returnTo: z.string().optional(),
});

const encoder = new TextEncoder();

export async function POST(request: NextRequest) {
  if (!hasAllowedOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Send a JSON request." }, { status: 415 });
  }
  const configuredPassword = env.APP_PASSWORD;
  if (!configuredPassword || !env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY.length < 32) {
    return NextResponse.json({ error: "Login is not configured." }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success || !(await passwordsMatch(parsed.data.password, configuredPassword))) {
    return NextResponse.json({ error: "That password is not correct." }, { status: 401 });
  }

  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const response = NextResponse.json({ returnTo: safeReturnPath(parsed.data.returnTo) });
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

export async function DELETE(request: NextRequest) {
  if (!hasAllowedOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", { expires: new Date(0), path: "/" });
  return response;
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
