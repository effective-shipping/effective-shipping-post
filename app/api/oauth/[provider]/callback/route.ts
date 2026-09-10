import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { saveConnection } from "@/lib/connections";
import { openJson } from "@/lib/crypto";
import { OAuthStateSchema, ProviderSchema } from "@/lib/domain";
import { exchangeOAuthCode } from "@/lib/providers";

const OAUTH_COOKIE = "twofold_oauth";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.redirect(new URL("/signin-with-chatgpt?return_to=/", request.url));
  const providerResult = ProviderSchema.safeParse((await context.params).provider);
  if (!providerResult.success) return NextResponse.redirect(new URL("/?notice=oauth-failed", request.url));

  const cookieStore = await cookies();
  const sealedState = cookieStore.get(OAUTH_COOKIE)?.value;
  cookieStore.delete(OAUTH_COOKIE);

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
      Date.now() > oauthState.expiresAt
    ) throw new Error("OAuth state did not match.");

    const redirectUri = `${new URL(request.url).origin}/api/oauth/${oauthState.provider}/callback`;
    const connection = await exchangeOAuthCode({
      provider: oauthState.provider,
      code,
      codeVerifier: oauthState.codeVerifier,
      redirectUri,
    });
    await saveConnection(user.userId, connection);
    return NextResponse.redirect(new URL(`/?notice=connected&provider=${connection.provider}`, request.url));
  } catch (error) {
    console.error("OAuth callback failed", { provider: providerResult.data, error });
    return NextResponse.redirect(new URL(`/?notice=oauth-failed&provider=${providerResult.data}`, request.url));
  }
}
