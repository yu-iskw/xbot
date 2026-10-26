import { createHash, timingSafeEqual } from "node:crypto";

/** Maps API tokens to the tenant whose runs, reports, and budget they may use. */
export type TokenTenantMap = Record<string, string>;

/**
 * Parse a token list like `"tokenA:tenant-a,tokenB:tenant-b"` plus an optional single token for the
 * default tenant. Tokens shorter than 16 characters are rejected.
 */
export function parseTokenTenants(
  list: string | undefined,
  single: string | undefined,
  defaultTenant = "default",
  label = "token",
): TokenTenantMap {
  const tokens: TokenTenantMap = {};
  if (single) tokens[single] = defaultTenant;
  for (const entry of (list ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const idx = entry.lastIndexOf(":");
    if (idx <= 0) throw new Error(`${label} entries must look like token:tenant`);
    tokens[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  for (const token of Object.keys(tokens)) {
    if (token.length < 16) throw new Error(`${label}s must be at least 16 characters`);
  }
  return tokens;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Build a constant-time resolver from an `Authorization` header to a tenant. Token digests are
 * computed once; every configured token is compared on every call.
 */
export function createBearerResolver(
  tokens: TokenTenantMap,
): (authorization: string | undefined) => string | undefined {
  const entries = Object.entries(tokens).map(([token, tenant]) => [digest(token), tenant] as const);
  return (authorization) => {
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    if (!match) return undefined;
    const presented = digest(match[1]!.trim());
    let tenant: string | undefined;
    for (const [expected, t] of entries) {
      if (timingSafeEqual(presented, expected)) tenant = t;
    }
    return tenant;
  };
}
