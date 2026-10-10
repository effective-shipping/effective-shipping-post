import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Miniflare } from "miniflare";

// External requests are intercepted. These checks cannot reach a live account.
const calls = [];
let linkedInStatus = 201;
let linkedInPostId = "urn:li:share:456";
let xStatus = 201;
const worker = new Miniflare({
  modulesRoot: path.resolve("dist/server"),
  modules: ["index.js", ...readdirSync("dist/server", { recursive: true }).filter((file) => file.endsWith(".js") && file !== "index.js")]
    .map((file) => ({ type: "ESModule", path: path.resolve("dist/server", file) })),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  bindings: {
    APP_PASSWORD: "worker-test-password",
    API_TOKEN: "worker-test-api-token-with-at-least-32-characters",
    TOKEN_ENCRYPTION_KEY: "worker-test-encryption-key-at-least-32-characters",
    X_CLIENT_ID: "x-client",
    X_CLIENT_SECRET: "x-secret",
    LINKEDIN_CLIENT_ID: "linkedin-client",
    LINKEDIN_CLIENT_SECRET: "linkedin-secret",
    LINKEDIN_VERSION: "202608",
  },
  async outboundService(request) {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.text() : "";
    calls.push({ url: request.url, body, authorization: request.headers.get("Authorization") });
    if (url.href === "https://api.x.com/2/oauth2/token") {
      const parameters = new URLSearchParams(body);
      assert.ok(parameters.get("grant_type"));
      if (parameters.get("grant_type") === "authorization_code") assert.ok(parameters.get("code_verifier"));
      return Response.json({ access_token: "x-access", refresh_token: "x-refresh", expires_in: 7200 });
    }
    if (url.href === "https://api.x.com/2/users/me") return Response.json({ data: { id: "123", name: "Test X account", username: "testaccount" } });
    if (url.href === "https://www.linkedin.com/oauth/v2/accessToken") return Response.json({ access_token: "linkedin-access", expires_in: 3600 });
    if (url.href === "https://api.linkedin.com/v2/userinfo") return Response.json({ sub: "abc123", name: "Test LinkedIn account" });
    if (url.href === "https://api.x.com/2/tweets") return Response.json({ data: { id: "789" } }, { status: xStatus });
    if (url.href === "https://api.linkedin.com/rest/posts") {
      assert.equal(request.headers.get("Linkedin-Version"), "202608");
      const post = JSON.parse(body);
      assert.equal(post.author, "urn:li:person:abc123");
      assert.equal(post.commentary, "Hello \\[world\\]");
      return new Response(null, { status: linkedInStatus, headers: linkedInPostId ? { "x-restli-id": linkedInPostId } : {} });
    }
    throw new Error(`Unexpected external request: ${url.origin}${url.pathname}`);
  },
});

const jar = new Map();
async function request(path, body, { form } = {}) {
  const response = await worker.dispatchFetch(`http://es-post.test${path}`, {
    redirect: "manual",
    ...(body !== undefined ? { method: "POST", body: JSON.stringify(body) } : {}),
    ...(form !== undefined ? { method: "POST", body: new URLSearchParams(form) } : {}),
    headers: {
      Cookie: [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; "),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

async function publish() {
  const response = await request("/api/posts", { destinations: [{ provider: "x", text: "Hello [world]" }, { provider: "linkedin", text: "Hello [world]" }] });
  assert.equal(response.status, 200);
  return (await response.json()).results;
}

try {
  const database = await worker.getD1Database("DB");
  for (const migration of readdirSync("drizzle").filter((file) => file.endsWith(".sql")).sort()) {
    await database.prepare(readFileSync(path.join("drizzle", migration), "utf8")).run();
  }
  const stage = (body, token = "worker-test-api-token-with-at-least-32-characters") => worker.dispatchFetch("http://es-post.test/api/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await stage({ text: "Hello" }, "wrong-token")).status, 401);
  assert.equal((await stage({ text: "  " })).status, 400);
  const staged = await stage({ text: "Long version", x: "Short version", providers: ["x"] });
  assert.equal(staged.status, 201);
  const { id, url } = await staged.json();
  const link = new URL(url);
  assert.equal(link.pathname, `/open/${id}`);
  assert.equal((await request(`/api/drafts/${id}`)).status, 401);
  assert.match((await request(`/?draft=${id}`)).headers.get("Location") ?? "", new RegExp(`returnTo=${encodeURIComponent(`/?draft=${id}`).replaceAll("?", "\\?")}`, "u"));

  // The draft link signs the browser in once. A reused or expired ticket falls back to the password.
  const expiredDraft = await (await stage({ text: "Expired link" })).json();
  await database.prepare("UPDATE drafts SET ticket_expires_at = ? WHERE id = ?").bind(Date.now() - 1, expiredDraft.id).run();
  const expiredOpen = await worker.dispatchFetch(expiredDraft.url, { redirect: "manual" });
  assert.match(expiredOpen.headers.get("Location") ?? "", /\/login\?returnTo=/u);
  assert.equal(expiredOpen.headers.get("set-cookie"), null);
  const opened = await request(`${link.pathname}${link.search}`);
  assert.equal(new URL(opened.headers.get("Location")).pathname + new URL(opened.headers.get("Location")).search, `/?draft=${id}`);
  assert.ok(jar.has("es_post_session"));
  const reused = await worker.dispatchFetch(url, { redirect: "manual" });
  assert.match(reused.headers.get("Location") ?? "", /\/login\?returnTo=/u);
  assert.equal((await request(link.pathname)).headers.get("Location"), `http://es-post.test/?draft=${id}`);

  assert.equal((await request("/api/session", undefined, { form: { password: "worker-test-password" } })).status, 303);
  assert.deepEqual((await (await request(`/api/drafts/${id}`)).json()).draft, {
    shared: "Long version", x: "Short version", linkedin: "Long version", tailored: true, selection: { x: true, linkedin: false },
  });
  assert.equal((await request(`/api/drafts/${"a".repeat(24)}`)).status, 404);
  assert.equal((await request("/api/drafts/not-a-draft-id")).status, 404);
  const unconnected = (await (await request("/api/connections")).json()).accounts;
  assert.deepEqual(unconnected, [{ status: "disconnected", provider: "x" }, { status: "disconnected", provider: "linkedin" }]);

  const xStart = await request("/api/oauth/x");
  const linkedinStart = await request("/api/oauth/linkedin");
  assert.equal(xStart.status, 307);
  assert.equal(linkedinStart.status, 307);
  assert.ok(jar.has("es_post_oauth_x"));
  assert.ok(jar.has("es_post_oauth_linkedin"));
  const xAuthorization = new URL(xStart.headers.get("Location"));
  assert.equal(xAuthorization.searchParams.get("code_challenge_method"), "S256");

  for (const [provider, start] of [["x", xStart], ["linkedin", linkedinStart]]) {
    const state = new URL(start.headers.get("Location")).searchParams.get("state");
    const callback = await request(`/api/oauth/${provider}/callback?code=test-code&state=${state}`);
    assert.equal(callback.status, 307);
    assert.ok(callback.headers.get("Location")?.includes("notice=connected"));
  }
  const accounts = (await (await request("/api/connections")).json()).accounts;
  assert.equal(accounts.length, 2);
  assert.ok(accounts.every((account) => account.status === "connected"));
  assert.ok(accounts.every((account) => !JSON.stringify(account).includes("access")));
  const rows = (await database.prepare("SELECT access_token, refresh_token FROM connections").all()).results;
  assert.ok(rows.every((row) => row.access_token !== "x-access" && row.access_token !== "linkedin-access"));
  assert.ok(rows.some((row) => row.refresh_token && row.refresh_token !== "x-refresh"));

  assert.ok((await publish()).every((result) => result.kind === "published"));
  linkedInStatus = 403;
  const partial = await publish();
  assert.equal(partial.find((result) => result.provider === "x").kind, "published");
  assert.equal(partial.find((result) => result.provider === "linkedin").kind, "failed");

  linkedInStatus = 201;
  linkedInPostId = null;
  assert.equal((await publish()).find((result) => result.provider === "linkedin").kind, "uncertain");
  linkedInPostId = "urn:li:share:456";
  xStatus = 500;
  assert.equal((await publish()).find((result) => result.provider === "x").kind, "uncertain");
  xStatus = 401;
  assert.equal((await publish()).find((result) => result.provider === "x").reconnect, true);

  xStatus = 201;
  await database.prepare("UPDATE connections SET expires_at = ? WHERE provider = 'x'").bind(Date.now() - 1).run();
  assert.ok((await publish()).every((result) => result.kind === "published"));
  assert.ok(calls.some((call) => call.url.endsWith("/oauth2/token") && call.body.includes("grant_type=refresh_token")));
  await database.prepare("UPDATE connections SET expires_at = ? WHERE provider = 'linkedin'").bind(Date.now() - 1).run();
  const expired = (await publish()).find((result) => result.provider === "linkedin");
  assert.equal(expired.kind, "failed");
  assert.equal(expired.reconnect, true);
  console.info("Worker checks passed: staged drafts, single-use draft links, simultaneous OAuth, PKCE, encrypted D1 tokens, publishing, partial failures, uncertain delivery, and token refresh. All provider requests were simulated.");
} finally {
  await worker.dispose();
}
