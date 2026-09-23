import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import { getAppUser, setSessionCookie } from "@/lib/auth";
import { DraftIdSchema } from "@/lib/draft";
import { redeemTicket } from "@/lib/drafts";

// The link an agent hands back. Its single-use ticket signs the browser in, so going from a
// session to the editor needs no password. The redirect drops the ticket from the address bar.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const id = DraftIdSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.redirect(new URL("/", request.url));
  const draftPath = `/?draft=${id.data}`;
  const response = NextResponse.redirect(new URL(draftPath, request.url));
  if (await getAppUser()) return response;

  const ticket = request.nextUrl.searchParams.get("ticket");
  const userId = ticket && env.APP_PASSWORD ? await redeemTicket(id.data, ticket) : null;
  if (userId !== "personal" || !env.APP_PASSWORD) {
    return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(draftPath)}`, request.url));
  }
  await setSessionCookie(response, request, env.APP_PASSWORD);
  return response;
}
