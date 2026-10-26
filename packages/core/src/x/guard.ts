import { X_USERNAME_BODY } from "../schemas/x";
import { X_READ_OPERATIONS, XApiError, type XReadClient } from "./port";

/**
 * Wrap a client in a frozen facade that exposes only the allowlisted read operations.
 * Whatever else the underlying object carries (an SDK handle, test hooks...) is unreachable.
 */
export function readOnlyFacade(client: XReadClient): XReadClient {
  const facade: Record<string, unknown> = { mode: client.mode };
  for (const op of X_READ_OPERATIONS) {
    const fn = client[op];
    if (typeof fn !== "function") {
      throw new Error(`X client is missing read operation "${op}"`);
    }
    facade[op] = fn.bind(client);
  }
  return Object.freeze(facade) as unknown as XReadClient;
}

/** X API resource endpoints xbot may call. All must be GET. */
const ALLOWED_X_PATHS: readonly RegExp[] = [
  /^\/2\/tweets\/search\/recent$/,
  /^\/2\/tweets\/search\/all$/,
  /^\/2\/tweets$/,
  new RegExp(`^/2/users/by/username/${X_USERNAME_BODY}$`),
  /^\/2\/users\/[0-9]+\/tweets$/,
];

const ALLOWED_X_HOSTS = new Set(["api.x.com", "api.twitter.com"]);

export function isAllowedXRequest(method: string, rawUrl: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !ALLOWED_X_HOSTS.has(url.hostname)) return false;
  return ALLOWED_X_PATHS.some((re) => re.test(url.pathname));
}

/**
 * A fetch implementation that refuses anything other than the allowlisted GET endpoints.
 * Installed underneath the official SDK so even an SDK misuse cannot write to X.
 */
export function createReadOnlyFetch(baseFetch: typeof fetch = globalThis.fetch): typeof fetch {
  const guarded = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!isAllowedXRequest(method, url)) {
      throw new XApiError(
        `Blocked non-read X request: ${method.toUpperCase()} ${safePath(url)}`,
        "unsupported",
      );
    }
    return baseFetch(input, init);
  };
  return guarded as typeof fetch;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "<invalid url>";
  }
}
