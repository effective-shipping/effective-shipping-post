import { NextRequest, NextResponse } from "next/server";

import { getAppUser } from "@/lib/auth";
import { deleteConnection, listConnections } from "@/lib/connections";
import { ProviderSchema, type Account } from "@/lib/domain";
import { providerIsConfigured } from "@/lib/providers";
import { hasAllowedOrigin, oauthCallbackUrl } from "@/lib/request";

export async function GET(request: NextRequest) {
  const user = await getAppUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const connections = await listConnections(user.userId);
  const accounts = ProviderSchema.options.map((provider): Account => {
    const connection = connections.find((item) => item.provider === provider);
    if (connection) return { status: "connected", ...connection };
    if (providerIsConfigured(provider)) return { status: "disconnected", provider };
    return { status: "unconfigured", provider, callbackUrl: oauthCallbackUrl(request, provider) };
  });
  return NextResponse.json({ accounts });
}

export async function DELETE(request: NextRequest) {
  if (!hasAllowedOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  const user = await getAppUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const provider = ProviderSchema.safeParse(request.nextUrl.searchParams.get("provider"));
  if (!provider.success) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  await deleteConnection(user.userId, provider.data);
  return new NextResponse(null, { status: 204 });
}
