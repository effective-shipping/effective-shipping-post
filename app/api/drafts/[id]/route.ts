import { NextResponse } from "next/server";

import { getAppUser } from "@/lib/auth";
import { DraftIdSchema } from "@/lib/draft";
import { getDraft } from "@/lib/drafts";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAppUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const id = DraftIdSchema.safeParse((await context.params).id);
  const draft = id.success ? await getDraft(user.userId, id.data) : null;
  if (!draft) return NextResponse.json({ error: "That draft is no longer available." }, { status: 404 });
  return NextResponse.json({ draft });
}
