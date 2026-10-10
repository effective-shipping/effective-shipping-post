// Installs the /post skill and registers the ES Post MCP server for each agent CLI found on this machine.
// Safe to run again: it skips anything already installed and never overwrites files it did not create.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const skillSource = path.join(projectRoot, "skills/post");
const serverCommand = ["node", path.join(projectRoot, "mcp/server.ts")];

const harnesses = [
  { name: "Claude Code", cli: "claude", skillsDirectory: path.join(os.homedir(), ".claude/skills"), addArgs: ["mcp", "add", "--scope", "user", "es-post", "--", ...serverCommand] },
  { name: "Codex", cli: "codex", skillsDirectory: path.join(os.homedir(), ".codex/skills"), addArgs: ["mcp", "add", "es-post", "--", ...serverCommand] },
];

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function linkSkill(skillsDirectory) {
  const target = path.join(skillsDirectory, "post");
  if (existsSync(target) || isSymlink(target)) {
    if (isSymlink(target) && path.resolve(skillsDirectory, readlinkSync(target)) === skillSource) return "already linked";
    return `skipped: ${target} already exists and is not this project's skill`;
  }
  mkdirSync(skillsDirectory, { recursive: true });
  symlinkSync(skillSource, target, "dir");
  return `linked ${target}`;
}

function isSymlink(file) {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function registerServer(harness) {
  if (run(harness.cli, ["mcp", "get", "es-post"]).status === 0) return "already registered";
  const result = run(harness.cli, harness.addArgs);
  if (result.status !== 0) throw new Error(`${harness.cli} ${harness.addArgs.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return "registered";
}

let installed = 0;
for (const harness of harnesses) {
  if (run(harness.cli, ["--version"]).error) {
    console.info(`${harness.name}: not found, skipped.`);
    continue;
  }
  console.info(`${harness.name}: skill ${linkSkill(harness.skillsDirectory)}; MCP server ${registerServer(harness)}.`);
  installed += 1;
}

if (installed === 0) {
  console.info(`No supported agent CLI found. Register this MCP server manually: ${serverCommand.join(" ")}`);
} else {
  console.info("Start a new agent session, then run /post in Claude Code or $post in Codex. The MCP server starts ES Post on http://localhost:5173 when needed.");
}
