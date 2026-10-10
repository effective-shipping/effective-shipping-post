import type { Provider } from "./domain";

export function hasAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin === null || origin === new URL(request.url).origin;
}

export function oauthCallbackUrl(request: Request, provider: Provider): string {
  return `${new URL(request.url).origin}/api/oauth/${provider}/callback`;
}
