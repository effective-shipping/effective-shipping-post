import { Effect } from "effect";
import { NextRequest, NextResponse } from "next/server";

import { getAppUser } from "@/lib/auth";
import { PublishRequestSchema } from "@/lib/domain";
import { publishDestination } from "@/lib/providers";
import { hasAllowedOrigin } from "@/lib/request";

export async function POST(request: NextRequest) {
  if (!hasAllowedOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Send a JSON request." }, { status: 415 });
  }
  const user = await getAppUser();
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
