#!/usr/bin/env node
// Enforces the dependency rule: interfaces -> core -> X/storage abstractions, never the reverse,
// and no interface package may depend on another interface package.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SCOPE = "@yu-iskw/xbot-";
const allowed = { core: [], cli: ["core"], http: ["core"], mcp: ["core"], slack: ["core"] };
// Core must stay interface-agnostic: no CLI, HTTP server, MCP, or Slack libraries.
const forbiddenInCore = [
  /^commander$/,
  /^hono$/,
  /^@hono\//,
  /^@mastra\/hono$/,
  /^@mastra\/mcp$/,
  /^@chat-adapter\//,
];

const errors = [];
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|mts|js)$/.test(name) ? [p] : [];
  });
}

for (const [pkg, deps] of Object.entries(allowed)) {
  const dir = join(root, "packages", pkg);
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
  for (const d of declared) {
    if (d.startsWith(SCOPE) && !deps.includes(d.slice(SCOPE.length)))
      errors.push(`${pkg}: must not depend on ${d}`);
    if (pkg === "core" && forbiddenInCore.some((re) => re.test(d)))
      errors.push(`core: must not depend on ${d}`);
  }
  for (const file of files(join(dir, "src"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
      const spec = m[1];
      const rel = file.slice(root.length);
      if (spec.startsWith(SCOPE) && !deps.includes(spec.slice(SCOPE.length).split("/")[0])) {
        errors.push(`${rel}: imports ${spec}`);
      }
      if (spec.includes("../") && /packages\/|\.\.\/\.\.\/(cli|http|mcp|slack|core)/.test(spec)) {
        errors.push(`${rel}: relative import across packages (${spec})`);
      }
      if (pkg === "core" && forbiddenInCore.some((re) => re.test(spec)))
        errors.push(`${rel}: core imports ${spec}`);
      const bare = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!spec.startsWith(".") && !spec.startsWith("node:") && !declared.includes(bare)) {
        errors.push(`${rel}: imports undeclared dependency ${bare}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`Dependency boundary violations:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("Dependency boundaries OK");
