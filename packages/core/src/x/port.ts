import type { SearchInput, SearchResult, UserPostsInput, XPost, XUser } from "../schemas/x";

/**
 * The only X operations xbot may perform. Every one of them is an HTTP GET.
 * There is intentionally no way to extend this list through configuration.
 */
export const X_READ_OPERATIONS = [
  "searchRecent",
  "searchArchive",
  "getPosts",
  "getUserByUsername",
  "getUserPosts",
] as const;
export type XReadOperation = (typeof X_READ_OPERATIONS)[number];

export type XClientMode = "live" | "mock";

export interface XRequestContext {
  /** Research run responsible for the request, used for budgets and telemetry. */
  runId?: string;
  signal?: AbortSignal;
}

/** Application-controlled, read-only port to X. */
export interface XReadClient {
  readonly mode: XClientMode;
  searchRecent(input: SearchInput, ctx?: XRequestContext): Promise<SearchResult>;
  searchArchive(input: SearchInput, ctx?: XRequestContext): Promise<SearchResult>;
  getPosts(ids: string[], ctx?: XRequestContext): Promise<XPost[]>;
  getUserByUsername(username: string, ctx?: XRequestContext): Promise<XUser>;
  getUserPosts(input: UserPostsInput, ctx?: XRequestContext): Promise<SearchResult>;
}

export class XApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "rate_limited"
      | "budget_exceeded"
      | "invalid_request"
      | "unsupported"
      | "upstream",
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "XApiError";
  }
}
