#!/usr/bin/env bash
# Pack every published package and install the tarballs into a clean npm project, then run the
# library API, the CLI, and the MCP entry point from there.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

for pkg in core cli http mcp slack; do
  (cd "${root}/packages/${pkg}" && pnpm pack --pack-destination "${work}" >/dev/null)
done

mkdir -p "${work}/consumer"
cd "${work}/consumer"
npm init -y >/dev/null
npm install --no-audit --no-fund "${work}"/yu-iskw-xbot-*.tgz >/dev/null

cat > check.mjs <<'JS'
import { createXbotRuntime } from "@yu-iskw/xbot-core";
import { createXbotHttpApp } from "@yu-iskw/xbot-http";
import { createXbotMcpServer } from "@yu-iskw/xbot-mcp";
import { createSlackAccessControl } from "@yu-iskw/xbot-slack";

const runtime = await createXbotRuntime({ x: { mode: "mock" }, storage: { url: ":memory:" } });
const { report } = await runtime.research({ query: "Mastra" });
if (report.sources.length === 0) throw new Error("no sources");
await createXbotHttpApp({ runtime, insecureNoAuth: true });
createXbotMcpServer(runtime);
createSlackAccessControl();
await runtime.close();
console.log("library imports OK");
JS
node check.mjs
XBOT_HOME="${work}/home" npx xbot research "What are developers discussing about Mastra?" --mock | grep -q "## Sources"
echo "consumer smoke test passed"
