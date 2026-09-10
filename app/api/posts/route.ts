import { Effect } from "effect";
import { NextRequest, NextResponse } from "next/server";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { PublishRequestSchema } from "@/lib/domain";
import { publishDestination } from "@/lib/providers";

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const parsed = PublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid post." }, { status: 400 });
  }

  const results = await Effect.runPromise(
    Effect.all(
      parsed.data.destinations.map((destination) => publishDestination(user.userId, destination)),
      { concurrency: "unbounded" },
    ),
  );
  return NextResponse.json({ results });
}

