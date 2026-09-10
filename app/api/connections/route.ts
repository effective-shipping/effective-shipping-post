import { NextRequest, NextResponse } from "next/server";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { deleteConnection, listConnections } from "@/lib/connections";
import { ProviderSchema } from "@/lib/domain";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ connections: await listConnections(user.userId) });
}

export async function DELETE(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const provider = ProviderSchema.safeParse(request.nextUrl.searchParams.get("provider"));
  if (!provider.success) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  await deleteConnection(user.userId, provider.data);
  return new NextResponse(null, { status: 204 });
}

