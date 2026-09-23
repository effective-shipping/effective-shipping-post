import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getAppUser } from "@/lib/auth";
import { saveConnection } from "@/lib/connections";
import { openJson } from "@/lib/crypto";
import { OAuthStateSchema, ProviderSchema } from "@/lib/domain";
import { exchangeOAuthCode } from "@/lib/providers";
import { oauthCallbackUrl } from "@/lib/request";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const user = await getAppUser();
  if (!user) return NextResponse.redirect(new URL("/login?returnTo=/", request.url));
  const providerResult = ProviderSchema.safeParse((await context.params).provider);
  if (!providerResult.success) return NextResponse.redirect(new URL("/?notice=oauth-failed", request.url));

  const cookieStore = await cookies();
  const oauthCookie = `twofold_oauth_${providerResult.data}`;
  const sealedState = cookieStore.get(oauthCookie)?.value;
  cookieStore.delete(oauthCookie);

  try {
    if (!sealedState) throw new Error("Missing OAuth state.");
    const oauthState = OAuthStateSchema.parse(await openJson(sealedState));
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    if (
      !code ||
      !state ||
      state !== oauthState.state ||
      providerResult.data !== oauthState.provider ||
      user.userId !== oauthState.userId ||
      Date.now() >= oauthState.expiresAt
    ) throw new Error("OAuth state did not match.");

    const connection = await exchangeOAuthCode({
      provider: oauthState.provider,
      code,
      codeVerifier: oauthState.codeVerifier,
      redirectUri: oauthCallbackUrl(request, oauthState.provider),
    });
    await saveConnection(user.userId, connection);
    return NextResponse.redirect(new URL(`/?notice=connected&provider=${connection.provider}`, request.url));
  } catch (error) {
    console.error("OAuth callback failed", { provider: providerResult.data, error });
    return NextResponse.redirect(new URL(`/?notice=oauth-failed&provider=${providerResult.data}`, request.url));
  }
}
