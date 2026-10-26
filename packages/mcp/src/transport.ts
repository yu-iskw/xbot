import { createServer, type IncomingMessage, type Server } from "node:http";
import type { MCPServer } from "@mastra/mcp";
import { createBearerResolver, parseTokenTenants } from "@yu-iskw/xbot-core";

/** Token → tenant map, e.g. from XBOT_MCP_TOKENS="tokenA:tenant-a,tokenB:tenant-b". */
export function parseMcpTokens(value: string | undefined, defaultToken?: string, defaultTenant = "default") {
  return parseTokenTenants(value, defaultToken, defaultTenant, "MCP token");
}

export interface McpHttpOptions {
  port: number;
  hostname?: string;
  httpPath?: string;
  tokens: Record<string, string>;
  /** Hostnames accepted in the Host header (DNS-rebinding protection). */
  allowedHosts?: string[];
}

/**
 * Serve MCP over authenticated Streamable HTTP. The bearer token selects the tenant, which tools
 * read from `authInfo` so remote callers only see their own reports and runs.
 */
export function startMcpHttp(server: MCPServer, options: McpHttpOptions): Promise<Server> {
  if (Object.keys(options.tokens).length === 0) {
    throw new Error("Remote MCP requires at least one token (XBOT_MCP_TOKEN or XBOT_MCP_TOKENS)");
  }
  const resolveTenant = createBearerResolver(options.tokens);
  const httpPath = options.httpPath ?? "/mcp";
  const hostname = options.hostname ?? "127.0.0.1";
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? hostname}`);
    if (url.pathname !== httpPath) {
      res.writeHead(404).end();
      return;
    }
    const tenantId = resolveTenant(req.headers.authorization);
    if (!tenantId) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    (req as IncomingMessage & { auth?: unknown }).auth = {
      token: "redacted",
      clientId: tenantId,
      scopes: [],
      extra: { tenantId },
    };
    await server.startHTTP({
      url,
      httpPath,
      req,
      res,
      options: {
        enableDnsRebindingProtection: true,
        allowedHosts: options.allowedHosts ?? ["localhost", "127.0.0.1", "[::1]"],
      },
    });
  });
  return new Promise((resolve) => http.listen(options.port, hostname, () => resolve(http)));
}
