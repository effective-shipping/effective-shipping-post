import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const origin = process.argv[2] ?? "http://localhost:5173";
const settings = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
assert.ok(settings.APP_PASSWORD, "Run npm run setup:local before testing.");
let cookie;

async function request(path, { method = "GET", body, headers = {}, authenticated = true } = {}) {
  return fetch(new URL(path, origin), {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie && authenticated ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

assert.equal((await request("/")).status, 307);
assert.equal((await request("/login")).status, 200);
assert.equal((await request("/api/connections")).status, 401);
assert.equal((await request("/api/posts", { method: "POST", body: {} })).status, 401);
assert.equal((await request("/api/session", { method: "POST", body: { password: "wrong-password" } })).status, 401);
assert.equal((await request("/api/session", { method: "POST", body: { password: settings.APP_PASSWORD }, headers: { Origin: "https://untrusted.example" } })).status, 403);

const login = await request("/api/session", { method: "POST", body: { password: settings.APP_PASSWORD, returnTo: "//untrusted.example" } });
assert.equal(login.status, 200);
assert.equal((await login.json()).returnTo, "/");
const setCookie = login.headers.get("set-cookie");
assert.ok(setCookie?.includes("HttpOnly"));
assert.match(setCookie ?? "", /SameSite=Lax/iu);
cookie = setCookie.split(";")[0];
assert.equal((await request("/")).status, 200);
assert.equal((await request("/login")).status, 307);

const connections = await request("/api/connections");
assert.equal(connections.status, 200);
const accounts = (await connections.json()).connections;
assert.ok(Array.isArray(accounts));
assert.ok(accounts.every((account) => !("accessToken" in account) && !("refreshToken" in account)));
assert.equal((await request("/api/posts", { method: "POST", body: { destinations: [] } })).status, 400);
assert.equal((await request("/api/posts", { method: "POST", body: { destinations: [{ provider: "x", text: "😀".repeat(141) }] } })).status, 400);
assert.equal((await request("/api/posts", { method: "POST", body: {}, headers: { "Content-Type": "text/plain" } })).status, 415);
assert.equal((await request("/api/posts", { method: "POST", body: {}, headers: { Origin: "https://untrusted.example" } })).status, 403);
assert.equal((await request("/api/connections?provider=x", { method: "DELETE", headers: { Origin: "https://untrusted.example" } })).status, 403);
assert.equal((await request("/api/oauth/unknown")).status, 404);
assert.equal((await request("/api/oauth/x/callback?code=invalid&state=invalid")).status, 307);

if (!accounts.some((account) => account.provider === "x")) {
  const result = await request("/api/posts", { method: "POST", body: { destinations: [{ provider: "x", text: "Unconnected smoke test" }] } });
  assert.equal(result.status, 200);
  const outcomes = (await result.json()).results;
  assert.equal(outcomes[0].kind, "failed");
  assert.equal(outcomes[0].reconnect, true);
}

const tampered = cookie.slice(0, -2) + "!!";
assert.equal((await request("/api/connections", { headers: { Cookie: tampered } })).status, 401);
const logout = await request("/api/session", { method: "DELETE" });
assert.equal(logout.status, 204);
assert.ok(logout.headers.get("set-cookie")?.includes("1970"));
cookie = undefined;
assert.equal((await request("/api/connections")).status, 401);
console.info("Smoke checks passed: login, protected composer, D1, validation, OAuth rejection, and logout. No live posts were sent.");
