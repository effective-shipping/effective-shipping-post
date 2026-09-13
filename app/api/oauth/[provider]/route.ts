import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getAppUser } from "@/lib/auth";
import { randomBase64Url, sealJson, sha256Base64Url } from "@/lib/crypto";
import { ProviderSchema } from "@/lib/domain";
import { authorizationUrl, providerIsConfigured } from "@/lib/providers";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const user = await getAppUser();
  if (!user) return NextResponse.redirect(new URL("/login?returnTo=/", request.url));

  const parsedProvider = ProviderSchema.safeParse((await context.params).provider);
  if (!parsedProvider.success) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  const provider = parsedProvider.data;
  if (!providerIsConfigured(provider)) return NextResponse.redirect(new URL(`/?notice=configure&provider=${provider}`, request.url));

  const state = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  const redirectUri = `${new URL(request.url).origin}/api/oauth/${provider}/callback`;
  const sealedState = await sealJson({
    provider,
    state,
    codeVerifier,
    userId: user.userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const cookieStore = await cookies();
  cookieStore.set(`twofold_oauth_${provider}`, sealedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 10 * 60,
    path: "/",
  });

  return NextResponse.redirect(authorizationUrl({
    provider,
    redirectUri,
    state,
    codeChallenge: await sha256Base64Url(codeVerifier),
  }));
}
