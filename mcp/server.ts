// Twofold MCP server: lets a coding agent stage a post for the person to review and publish.
// Run with `node mcp/server.ts` (Node 22.18+ runs TypeScript directly). It never publishes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const startupTimeoutMs = 90_000;

type Config = {
  readonly baseUrl: URL;
  readonly apiToken: string | null;
  // Only a loopback app can be started on demand; a hosted Twofold must already be running.
  readonly selfHosted: boolean;
};

const StageResponseSchema = z.object({ url: z.string().url() });
const ErrorResponseSchema = z.object({ error: z.string() });

function readConfig(): Config {
  const envFile = path.join(projectRoot, ".env.local");
  const localSettings = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const baseUrl = new URL(process.env.TWOFOLD_URL ?? "http://localhost:5173");
  return {
    baseUrl,
    apiToken: process.env.TWOFOLD_API_TOKEN ?? localSettings.API_TOKEN ?? null,
    selfHosted: ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname),
  };
}

async function isReachable(baseUrl: URL): Promise<boolean> {
  try {
    const response = await fetch(new URL("/login", baseUrl), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function ensureAppRunning(config: Config): Promise<void> {
  if (await isReachable(config.baseUrl)) return;
  if (!config.selfHosted) throw new Error(`Twofold is not reachable at ${config.baseUrl.origin}.`);

  const stateDirectory = path.join(projectRoot, ".wrangler");
  mkdirSync(stateDirectory, { recursive: true });
  const logFile = path.join(stateDirectory, "twofold-app.log");
  const log = openSync(logFile, "a");
  const app = spawn(path.join(projectRoot, "node_modules/.bin/vinext"), ["dev", "--port", config.baseUrl.port || "80"], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", log, log],
  });
  app.unref();
  // The app outlives this session so the person can finish reviewing. Stop it with the PID in this file.
  if (app.pid) writeFileSync(path.join(stateDirectory, "twofold-app.pid"), `${app.pid}\n`);

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (await isReachable(config.baseUrl)) return;
  }
  throw new Error(`Twofold did not start within ${startupTimeoutMs / 1000} seconds. See ${logFile}.`);
}

function openInBrowser(url: string): void {
  const [command, args]: [string, ReadonlyArray<string>] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  const opener = spawn(command, args, { detached: true, stdio: "ignore" });
  opener.on("error", () => {
    // The tool result still contains the URL for the person to open.
  });
  opener.unref();
}

async function stagePost(config: Config, draft: { readonly text: string; readonly x?: string; readonly providers?: ReadonlyArray<"x" | "linkedin"> }): Promise<string> {
  if (!config.apiToken) throw new Error("No Twofold API token. Set TWOFOLD_API_TOKEN, or run `npm run setup:local` in the Twofold project.");
  await ensureAppRunning(config);
  const response = await fetch(new URL("/api/drafts", config.baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(draft),
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = ErrorResponseSchema.safeParse(body);
    throw new Error(`Twofold did not accept the draft (${response.status}): ${error.success ? error.data.error : "unexpected response"}`);
  }
  return StageResponseSchema.parse(body).url;
}

const server = new McpServer({ name: "twofold", version: "0.1.0" });

server.registerTool(
  "stage_post",
  {
    title: "Stage a post for review",
    description: [
      "Open a draft social post in Twofold so the user can edit it and publish to X and/or LinkedIn.",
      "This never publishes: the user reviews, edits, and publishes in the browser.",
      "Use when the user asks to tweet, post, or share something from this session.",
    ].join(" "),
    inputSchema: {
      text: z.string().min(1).max(10_000).describe("The post. Used for LinkedIn, and for X unless `x` is given."),
      x: z.string().min(1).max(10_000).optional().describe("A shorter X version (280 weighted characters; links count as 23). Omit to use `text` on both networks."),
      providers: z.array(z.enum(["x", "linkedin"])).min(1).max(2).optional().describe("Networks to preselect. Defaults to both."),
      open: z.boolean().default(true).describe("Open the draft in the browser. Defaults to true."),
    },
    outputSchema: { url: z.string().url() },
  },
  async ({ open, ...draft }) => {
    const url = await stagePost(readConfig(), draft);
    if (open) openInBrowser(url);
    return {
      content: [{ type: "text", text: `Staged for review at ${url}${open ? " (opened in the browser)" : ""}. Nothing was published; the user edits and publishes it in Twofold.` }],
      structuredContent: { url },
    };
  },
);

await server.connect(new StdioServerTransport());
