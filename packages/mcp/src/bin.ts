import { parseArgs } from "node:util";
import { createXbotRuntime, errorMessage, resolveConfig } from "@yu-iskw/xbot-core";
import { createXbotMcpServer } from "./server";
import { parseMcpTokens, startMcpHttp } from "./transport";

async function main() {
  const { values } = parseArgs({
    options: { mock: { type: "boolean" }, http: { type: "boolean" }, port: { type: "string" } },
  });
  const env = process.env;
  const runtime = await createXbotRuntime(
    await resolveConfig({ env, ...(values.mock ? { overrides: { x: { mode: "mock" } } } : {}) }),
  );
  const server = createXbotMcpServer(runtime);
  const shutdown = async () => {
    await server.close();
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (values.http) {
    const port = Number(values.port ?? env.XBOT_MCP_PORT ?? 4112);
    const tokens = parseMcpTokens(env.XBOT_MCP_TOKENS, env.XBOT_MCP_TOKEN, runtime.info.tenantId);
    await startMcpHttp(server, {
      port,
      tokens,
      ...(env.XBOT_MCP_HOST ? { hostname: env.XBOT_MCP_HOST } : {}),
      ...(env.XBOT_MCP_ALLOWED_HOSTS ? { allowedHosts: env.XBOT_MCP_ALLOWED_HOSTS.split(",") } : {}),
    });
    process.stderr.write(`xbot MCP (Streamable HTTP) listening on port ${port}/mcp\n`);
    return;
  }
  // stdio: stdout belongs to the protocol, so diagnostics go to stderr only.
  await server.startStdio();
}

main().catch((error: unknown) => {
  process.stderr.write(`xbot-mcp: ${errorMessage(error)}\n`);
  process.exit(1);
});
