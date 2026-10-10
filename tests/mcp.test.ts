import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../mcp/server.ts", import.meta.url));
const token = "test-token-with-at-least-32-characters";
const staged: Array<{ readonly authorization: string | undefined; readonly body: unknown }> = [];
let stageStatus = 201;
const home = mkdtempSync(path.join(tmpdir(), "es-post-home-"));
mkdirSync(path.join(home, ".es-post"));
writeFileSync(path.join(home, ".es-post/voice.md"), "Short sentences. Mention Belgrade when it fits.");

// Stands in for ES Post so the MCP server can be tested without the app or a live network.
const fakeApp = createServer(async (request, response) => {
  if (request.url === "/login") return void response.writeHead(200).end();
  if (request.method === "POST" && request.url === "/api/drafts") {
    staged.push({ authorization: request.headers.authorization, body: JSON.parse(await readBody(request)) });
    const body = stageStatus === 201 ? { id: "draft-id", url: `${origin()}/?draft=draft-id` } : { error: "A valid API token is required." };
    return void response.writeHead(stageStatus, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  }
  response.writeHead(404).end();
});

function origin(): string {
  return `http://127.0.0.1:${(fakeApp.address() as AddressInfo).port}`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

async function connect(appUrl: string): Promise<Client> {
  const client = new Client({ name: "es-post-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { PATH: process.env.PATH ?? "", HOME: home, ES_POST_URL: appUrl, ES_POST_API_TOKEN: token },
  }));
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  return content.map((item) => item.text ?? "").join("\n");
}

before(() => new Promise<void>((resolve) => fakeApp.listen(0, "127.0.0.1", resolve)));
after(() => new Promise<void>((resolve) => fakeApp.close(() => resolve())));

test("agents can stage a post but have no way to publish", async () => {
  const client = await connect(origin());
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["stage_post"]);
    // Every client gets the drafting rules and the user's voice guide, with or without the skill.
    assert.match(tools[0].description ?? "", /Never invent experiences/u);
    assert.match(tools[0].description ?? "", /Mention Belgrade when it fits\./u);
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((prompt) => prompt.name), ["post"]);
    const prompt = await client.getPrompt({ name: "post", arguments: { angle: "the login bug" } });
    assert.match(JSON.stringify(prompt.messages), /about the login bug from this session/u);

    const result = await client.callTool({ name: "stage_post", arguments: { text: "Long LinkedIn post", x: "Short X post", open: false } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, { url: `${origin()}/?draft=draft-id` });
    assert.match(text(result), /Nothing was published/u);
    assert.deepEqual(staged.at(-1), {
      authorization: `Bearer ${token}`,
      body: { text: "Long LinkedIn post", x: "Short X post" },
    });
  } finally {
    await client.close();
  }
});

test("rejected drafts come back to the agent as tool errors", async () => {
  stageStatus = 401;
  const client = await connect(origin());
  try {
    const result = await client.callTool({ name: "stage_post", arguments: { text: "Hello", open: false } });
    assert.equal(result.isError, true);
    assert.match(text(result), /\(401\): A valid API token is required\./u);
  } finally {
    stageStatus = 201;
    await client.close();
  }
});

test("an unreachable hosted ES Post is reported instead of started", async () => {
  const client = await connect("https://es-post.invalid");
  try {
    const result = await client.callTool({ name: "stage_post", arguments: { text: "Hello", open: false } });
    assert.equal(result.isError, true);
    assert.match(text(result), /not reachable at https:\/\/es-post\.invalid/u);
  } finally {
    await client.close();
  }
});
