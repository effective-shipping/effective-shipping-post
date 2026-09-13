import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth";

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(SESSION_COOKIE, "", { expires: new Date(0), path: "/" });
  return response;
}
