import { createBearerResolver, parseTokenTenants, type TokenTenantMap } from "@yu-iskw/xbot-core";
import type { MiddlewareHandler } from "hono";

export type { TokenTenantMap };

export interface AuthVariables {
  tenantId: string;
}

/**
 * Parse `XBOT_HTTP_TOKENS="tokenA:tenant-a,tokenB:tenant-b"` and/or `XBOT_HTTP_TOKEN=token` (default tenant).
 */
export function parseTokens(env: NodeJS.ProcessEnv, defaultTenant = "default"): TokenTenantMap {
  return parseTokenTenants(env.XBOT_HTTP_TOKENS, env.XBOT_HTTP_TOKEN, defaultTenant, "HTTP API token");
}

/** Constant-time bearer token check that resolves the caller's tenant. */
export function bearerAuth<E extends { Variables: AuthVariables } = { Variables: AuthVariables }>(
  tokens: TokenTenantMap,
): MiddlewareHandler<E> {
  const resolve = createBearerResolver(tokens);
  return async (c, next) => {
    const tenant = resolve(c.req.header("authorization"));
    if (!tenant)
      return c.json({ error: { code: "unauthorized", message: "Missing or invalid bearer token" } }, 401);
    (c as unknown as { set(key: "tenantId", value: string): void }).set("tenantId", tenant);
    await next();
  };
}
