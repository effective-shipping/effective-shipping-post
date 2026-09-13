import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";

import { projectRoot } from "./sites-env.mjs";

const { values } = parseArgs({ options: { port: { type: "string", default: "5174" } } });
if (!/^\d+$/u.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) {
  throw new Error("Choose a port between 1 and 65535.");
}
const preview = spawn(process.execPath, [
  path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
  "dev",
  "--config", path.join(projectRoot, "dist/server/wrangler.json"),
  "--env-file", path.join(projectRoot, ".env.local"),
  "--local",
  "--persist-to", path.join(projectRoot, ".wrangler/state"),
  "--ip", "127.0.0.1",
  "--port", values.port,
  "--inspector-port", "0",
  "--log-level", "warn",
], { cwd: projectRoot, stdio: "inherit" });

preview.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
preview.on("exit", (code) => { process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => preview.kill(signal));
console.info(`Built preview: http://127.0.0.1:${values.port}`);
