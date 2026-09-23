import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const envFile = new URL("../.env.local", import.meta.url);
let source = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const values = parseEnv(source);
const defaults = {
  TOKEN_ENCRYPTION_KEY: randomBytes(48).toString("base64"),
  APP_PASSWORD: randomBytes(24).toString("base64url"),
  API_TOKEN: randomBytes(32).toString("base64url"),
  X_CLIENT_ID: "",
  X_CLIENT_SECRET: "",
  LINKEDIN_CLIENT_ID: "",
  LINKEDIN_CLIENT_SECRET: "",
  LINKEDIN_VERSION: "202608",
};

for (const [key, value] of Object.entries(defaults)) {
  if (values[key] && !values[key].startsWith("replace-with-")) continue;
  if (key in values) {
    source = source.replace(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, "mu"), `${key}=${value}`);
  } else {
    source += `${source.endsWith("\n") || !source ? "" : "\n"}${key}=${value}\n`;
  }
}

const temporaryFile = new URL(`../.env.local.${randomBytes(8).toString("hex")}.tmp`, import.meta.url);
writeFileSync(temporaryFile, source, { mode: 0o600 });
renameSync(temporaryFile, envFile);
console.info("Local settings are ready in .env.local. Use APP_PASSWORD to sign in, and add your provider credentials there. The MCP server reads API_TOKEN from the same file.");
