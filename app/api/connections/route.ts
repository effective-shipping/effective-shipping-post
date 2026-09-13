import { NextRequest, NextResponse } from "next/server";

import { getAppUser } from "@/lib/auth";
import { deleteConnection, listConnections } from "@/lib/connections";
import { ProviderSchema } from "@/lib/domain";
import { hasAllowedOrigin } from "@/lib/request";

export async function GET() {
  const user = await getAppUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ connections: await listConnections(user.userId) });
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
