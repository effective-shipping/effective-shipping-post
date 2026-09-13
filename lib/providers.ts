import { env } from "cloudflare:workers";
import { Data, Effect } from "effect";
import { z } from "zod";

import { getConnection, saveConnection } from "./connections";
import { linkedInPlainText } from "./text";
import {
  type Destination,
  type DestinationResult,
  type Provider,
  type ProviderConnection,
} from "./domain";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
});

const XProfileSchema = z.object({
  data: z.object({ id: z.string(), name: z.string(), username: z.string() }),
});

const XPostSchema = z.object({ data: z.object({ id: z.string().regex(/^\d+$/u) }) });

const LinkedInProfileSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
});

export class ProviderFailure extends Data.TaggedError("ProviderFailure")<{
  readonly provider: Provider;
  readonly message: string;
  readonly reconnect: boolean;
}> {}

class ProviderUncertain extends Data.TaggedError("ProviderUncertain")<{
  readonly provider: Provider;
  readonly message: string;
}> {}

function requiredConfig(name: keyof Cloudflare.Env): string {
  const value = env[name];
  if (typeof value !== "string" || !value) throw new Error(`${name} is not configured.`);
  return value;
}

export function providerIsConfigured(provider: Provider): boolean {
  const encryptionConfigured = Boolean(env.TOKEN_ENCRYPTION_KEY && env.TOKEN_ENCRYPTION_KEY.length >= 32);
  if (provider === "x") return Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET && encryptionConfigured);
  return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET && encryptionConfigured);
}

export function authorizationUrl(args: {
  readonly provider: Provider;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  if (args.provider === "x") {
    const url = new URL("https://x.com/i/oauth2/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: requiredConfig("X_CLIENT_ID"),
      redirect_uri: args.redirectUri,
      scope: "tweet.read tweet.write users.read offline.access",
      state: args.state,
      code_challenge: args.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: requiredConfig("LINKEDIN_CLIENT_ID"),
    redirect_uri: args.redirectUri,
    state: args.state,
    scope: "openid profile w_member_social",
  }).toString();
  return url.toString();
}

async function parsedJson<T>(response: Response, schema: z.ZodType<T>, message: string): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(message);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`${message} The response shape was unexpected.`);
  return parsed.data;
}

function expiration(expiresIn: number | undefined): number | null {
  return expiresIn ? Date.now() + expiresIn * 1000 : null;
}

export async function exchangeOAuthCode(args: {
  readonly provider: Provider;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}): Promise<ProviderConnection> {
  if (args.provider === "x") {
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${requiredConfig("X_CLIENT_ID")}:${requiredConfig("X_CLIENT_SECRET")}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: args.code,
        grant_type: "authorization_code",
        redirect_uri: args.redirectUri,
        code_verifier: args.codeVerifier,
      }),
    });
    const token = await parsedJson(tokenResponse, TokenResponseSchema, "X did not accept the connection.");
    const profileResponse = await fetch("https://api.x.com/2/users/me", {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const profile = await parsedJson(profileResponse, XProfileSchema, "X did not return the connected account.");
    return {
      provider: "x",
      accountId: profile.data.id,
      accountName: profile.data.name,
      accountHandle: profile.data.username,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: expiration(token.expires_in),
    };
  }

  const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: requiredConfig("LINKEDIN_CLIENT_ID"),
      client_secret: requiredConfig("LINKEDIN_CLIENT_SECRET"),
    }),
  });
  const token = await parsedJson(tokenResponse, TokenResponseSchema, "LinkedIn did not accept the connection.");
  const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = await parsedJson(profileResponse, LinkedInProfileSchema, "LinkedIn did not return the connected account.");
  const fullName = profile.name ?? ([profile.given_name, profile.family_name].filter(Boolean).join(" ") || "LinkedIn member");
  return {
    provider: "linkedin",
    accountId: profile.sub,
    accountName: fullName,
    accountHandle: null,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: expiration(token.expires_in),
  };
}

async function refreshConnection(userId: string, connection: ProviderConnection): Promise<ProviderConnection> {
  if (!connection.expiresAt || connection.expiresAt > Date.now() + 60_000) return connection;
  if (!connection.refreshToken) {
    throw new ProviderFailure({ provider: connection.provider, message: "Your connection expired. Connect it again.", reconnect: true });
  }

  const isX = connection.provider === "x";
  const clientId = requiredConfig(isX ? "X_CLIENT_ID" : "LINKEDIN_CLIENT_ID");
  const clientSecret = requiredConfig(isX ? "X_CLIENT_SECRET" : "LINKEDIN_CLIENT_SECRET");
  const tokenResponse = await fetch(
    isX ? "https://api.x.com/2/oauth2/token" : "https://www.linkedin.com/oauth/v2/accessToken",
    {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: isX
        ? { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }
        : { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
        ...(isX ? {} : { client_id: clientId, client_secret: clientSecret }),
      }),
    },
  );
  if (tokenResponse.status === 400 || tokenResponse.status === 401 || tokenResponse.status === 403) {
    throw new ProviderFailure({ provider: connection.provider, message: "Your connection expired. Connect it again.", reconnect: true });
  }
  const token = await parsedJson(tokenResponse, TokenResponseSchema, `${isX ? "X" : "LinkedIn"} could not refresh the connection. Try again later.`);
  const refreshed: ProviderConnection = {
    ...connection,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? connection.refreshToken,
    expiresAt: expiration(token.expires_in),
  };
  await saveConnection(userId, refreshed);
  return refreshed;
}

async function publish(userId: string, destination: Destination): Promise<string> {
  const stored = await getConnection(userId, destination.provider);
  if (!stored) throw new ProviderFailure({ provider: destination.provider, message: "Connect this account before publishing.", reconnect: true });
  const connection = await refreshConnection(userId, stored);

  if (destination.provider === "x") {
    const response = await sendPost("x", "https://api.x.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: destination.text }),
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = XPostSchema.safeParse(body);
    if (!parsed.success) throw uncertainDelivery("x");
    const post = parsed.data;
    return `https://x.com/${connection.accountHandle ?? "i"}/status/${post.data.id}`;
  }

  const response = await sendPost("linkedin", "https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json",
      "Linkedin-Version": env.LINKEDIN_VERSION ?? "202608",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${connection.accountId}`,
      commentary: linkedInPlainText(destination.text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  const postId = response.headers.get("x-restli-id");
  if (!postId || !/^urn:li:(share|ugcPost):\d+$/u.test(postId)) throw uncertainDelivery("linkedin");
  return `https://www.linkedin.com/feed/update/${postId}`;
}

function uncertainDelivery(provider: Provider): ProviderUncertain {
  return new ProviderUncertain({
    provider,
    message: "Delivery could not be confirmed. Check your feed before publishing again.",
  });
}

async function sendPost(provider: Provider, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw uncertainDelivery(provider);
  }
  if (response.status >= 500) throw uncertainDelivery(provider);
  if (!response.ok) {
    const label = provider === "x" ? "X" : "LinkedIn";
    const reconnect = response.status === 401;
    const message = reconnect ? "Your connection expired. Connect it again."
      : response.status === 429 ? `${label} is rate limiting requests. Try again later.`
      : response.status === 403 ? `${label} denied posting access. Check your app permissions and API plan.`
      : `${label} rejected this post. Check its text and try again.`;
    throw new ProviderFailure({ provider, message, reconnect });
  }
  return response;
}

export function publishDestination(userId: string, destination: Destination): Effect.Effect<DestinationResult> {
  return Effect.tryPromise({
    try: () => publish(userId, destination),
    catch: (error) => error instanceof ProviderFailure || error instanceof ProviderUncertain
      ? error
      : new ProviderFailure({ provider: destination.provider, message: error instanceof Error ? error.message : "Publishing failed.", reconnect: false }),
  }).pipe(
    Effect.map((postUrl): DestinationResult => ({ kind: "published", provider: destination.provider, postUrl })),
    Effect.catchAll((error) => Effect.succeed<DestinationResult>(error instanceof ProviderUncertain ? {
      kind: "uncertain",
      provider: error.provider,
      message: error.message,
    } : {
      kind: "failed",
      provider: error.provider,
      message: error.message,
      reconnect: error.reconnect,
    })),
  );
}
