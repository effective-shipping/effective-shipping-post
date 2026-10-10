import { NextRequest, NextResponse } from "next/server";

import { getApiUserId } from "@/lib/auth";
import { StageDraftRequestSchema, stagedDraft } from "@/lib/draft";
import { saveDraft } from "@/lib/drafts";

// Agents stage drafts here. Staging never publishes; the person reviews and publishes in the editor.
export async function POST(request: NextRequest) {
  const userId = await getApiUserId(request);
  if (!userId) return NextResponse.json({ error: "A valid API token is required." }, { status: 401 });
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Send a JSON request." }, { status: 415 });
  }
  const parsed = StageDraftRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid draft." }, { status: 400 });
  }

  const { id, ticket } = await saveDraft(userId, stagedDraft(parsed.data));
  const url = new URL(`/open/${id}`, request.url);
  url.searchParams.set("ticket", ticket);
  return NextResponse.json({ id, url: url.href }, { status: 201 });
}
