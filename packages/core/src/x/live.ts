import { ApiError, Client, HttpClient } from "@xdevplatform/xdk";
import {
  postUrl,
  type SearchInput,
  SearchInputSchema,
  type SearchResult,
  type UserPostsInput,
  UserPostsInputSchema,
  userUrl,
  X_USERNAME_BODY_RE,
  type XPost,
  type XUser,
} from "../schemas/x";
import { createReadOnlyFetch } from "./guard";
import {
  assertPostIdBatch,
  parseRecentSearch,
  XApiError,
  type XReadClient,
  type XRequestContext,
} from "./port";

type PostField = NonNullable<
  NonNullable<Parameters<Client["posts"]["searchRecent"]>[1]>["postFields"]
>[number];
// author_id is a valid X post field that the SDK's field union currently omits; only it is cast.
const POST_FIELDS: PostField[] = [
  "created_at",
  "author_id" as PostField,
  "lang",
  "public_metrics",
  "conversation_id",
];

/** Field selection and cancellation shared by every request. */
function fields(ctx?: XRequestContext) {
  return {
    postFields: [...POST_FIELDS],
    expansions: ["author_id" as const],
    userFields: [
      "username" as const,
      "name" as const,
      "description" as const,
      "verified" as const,
      "protected" as const,
      "public_metrics" as const,
      "created_at" as const,
    ],
    requestOptions: ctx?.signal ? { signal: ctx.signal } : {},
  };
}

export interface LiveXReadClientOptions {
  /** App-only OAuth 2.0 bearer token. User-context credentials are intentionally not supported. */
  bearerToken: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries for 429 and 5xx responses. */
  maxRetries?: number;
  /** Upper bound on a single backoff wait. */
  maxBackoffMs?: number;
  /** Override the network layer (tests). It is still wrapped by the read-only guard. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

// Loose shapes of the SDK's camelCased responses; only the fields we request.
interface SdkPost {
  id?: string;
  text?: string;
  authorId?: string;
  createdAt?: string;
  lang?: string;
  conversationId?: string;
  publicMetrics?: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    quoteCount?: number;
    impressionCount?: number;
  };
}
interface SdkUser {
  id?: string;
  username?: string;
  name?: string;
  description?: string;
  verified?: boolean;
  protected?: boolean;
  createdAt?: string;
  publicMetrics?: { followersCount?: number; followingCount?: number; postCount?: number };
}
interface SdkPage {
  data?: SdkPost[];
  includes?: { users?: SdkUser[] };
  meta?: { nextToken?: string };
  errors?: unknown[];
}

/** Live, read-only X client built on the official TypeScript SDK. */
export class LiveXReadClient implements XReadClient {
  readonly mode = "live" as const;
  readonly #sdk: Client;
  readonly #maxRetries: number;
  readonly #maxBackoffMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => Date;

  constructor(options: LiveXReadClientOptions) {
    if (!options.bearerToken) throw new XApiError("X bearer token is required for live mode", "unauthorized");
    this.#sdk = new Client({
      bearerToken: options.bearerToken,
      timeout: options.timeoutMs ?? 30_000,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });
    installReadOnlyHttp(this.#sdk, createReadOnlyFetch(options.fetch ?? globalThis.fetch));
    this.#maxRetries = options.maxRetries ?? 3;
    this.#maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = options.now ?? (() => new Date());
  }

  async searchRecent(input: SearchInput, ctx?: XRequestContext): Promise<SearchResult> {
    const resolved = parseRecentSearch(input);
    return this.#paginate(resolved.maxPages, (token) =>
      this.#sdk.posts.searchRecent(resolved.query, { ...page(resolved, token, "nextToken"), ...fields(ctx) }),
    );
  }

  async searchArchive(input: SearchInput, ctx?: XRequestContext): Promise<SearchResult> {
    const resolved = SearchInputSchema.parse(input);
    return this.#paginate(resolved.maxPages, (token) =>
      this.#sdk.posts.searchAll(resolved.query, { ...page(resolved, token, "nextToken"), ...fields(ctx) }),
    );
  }

  async getPosts(ids: string[], ctx?: XRequestContext): Promise<XPost[]> {
    if (ids.length === 0) return [];
    assertPostIdBatch(ids);
    const page = (await this.#call(() => this.#sdk.posts.getByIds(ids, fields(ctx)))) as SdkPage;
    return this.#normalizePage(page).posts;
  }

  async getUserByUsername(username: string, ctx?: XRequestContext): Promise<XUser> {
    const clean = username.replace(/^@/, "");
    if (!X_USERNAME_BODY_RE.test(clean)) throw new XApiError("Invalid X username", "invalid_request");
    const res = (await this.#call(() =>
      this.#sdk.users.getByUsername(clean, {
        userFields: fields(ctx).userFields,
        requestOptions: fields(ctx).requestOptions,
      }),
    )) as { data?: SdkUser };
    const user = res.data ? normalizeUser(res.data, this.#now().toISOString()) : undefined;
    if (!user) throw new XApiError(`User @${clean} not found`, "not_found");
    return user;
  }

  async getUserPosts(input: UserPostsInput, ctx?: XRequestContext): Promise<SearchResult> {
    const resolved = UserPostsInputSchema.parse(input);
    if (!/^[0-9]+$/.test(resolved.userId)) throw new XApiError("Invalid X user ID", "invalid_request");
    return this.#paginate(resolved.maxPages, (token) =>
      this.#sdk.users.getPosts(resolved.userId, {
        ...page(resolved, token, "paginationToken"),
        ...fields(ctx),
      }),
    );
  }

  async #paginate(maxPages: number, fetchPage: (token?: string) => Promise<unknown>): Promise<SearchResult> {
    const posts = new Map<string, XPost>();
    const users = new Map<string, XUser>();
    let token: string | undefined;
    let pages = 0;
    do {
      const page = (await this.#call(() => fetchPage(token))) as SdkPage;
      pages += 1;
      const normalized = this.#normalizePage(page);
      for (const post of normalized.posts) posts.set(post.id, post);
      for (const user of normalized.users) users.set(user.id, user);
      token = page.meta?.nextToken;
    } while (token && pages < maxPages);
    return {
      posts: [...posts.values()],
      users: [...users.values()],
      pages,
      ...(token ? { nextToken: token } : {}),
    };
  }

  #normalizePage(page: SdkPage): { posts: XPost[]; users: XUser[] } {
    const retrievedAt = this.#now().toISOString();
    const users = (page.includes?.users ?? [])
      .map((u) => normalizeUser(u, retrievedAt))
      .filter((u): u is XUser => u !== undefined);
    const usernames = new Map(users.map((u) => [u.id, u.username]));
    const posts = (page.data ?? [])
      .map((p) => normalizePost(p, usernames, retrievedAt))
      .filter((p): p is XPost => p !== undefined);
    return { posts, users };
  }

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const mapped = mapError(error);
        const retryable = mapped.code === "rate_limited" || mapped.code === "upstream";
        if (!retryable || attempt >= this.#maxRetries) throw mapped;
        const backoff = mapped.retryAfterSeconds
          ? mapped.retryAfterSeconds * 1000
          : Math.min(1000 * 2 ** attempt, this.#maxBackoffMs);
        if (backoff > this.#maxBackoffMs) throw mapped;
        await this.#sleep(backoff);
      }
    }
  }
}

/**
 * Give this SDK client its own HttpClient whose fetch is the read-only guard. The SDK's default
 * HttpClient is a module-level singleton, so patching it would leak into every xdk client in the process.
 */
function installReadOnlyHttp(sdk: Client, guarded: typeof fetch): void {
  const http = new HttpClient() as unknown as { fetch?: unknown };
  const holder = sdk as unknown as { httpClient?: unknown };
  if (typeof http.fetch !== "function" || !("httpClient" in holder)) {
    // Fail closed: if the SDK internals change we refuse to run unguarded.
    throw new Error("Unable to install the read-only network guard on the X SDK client");
  }
  http.fetch = guarded;
  holder.httpClient = http;
}

/** Page size, time window, sort, and pagination token for list endpoints. */
function page(
  input: { maxResults: number; startTime?: string; endTime?: string; sortOrder?: "recency" | "relevancy" },
  token: string | undefined,
  tokenKey: "nextToken" | "paginationToken",
) {
  return {
    maxResults: input.maxResults,
    startTime: input.startTime,
    endTime: input.endTime,
    ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
    ...(token ? { [tokenKey]: token } : {}),
  };
}

export function normalizePost(
  p: SdkPost,
  usernames: Map<string, string>,
  retrievedAt: string,
): XPost | undefined {
  if (!p.id || typeof p.text !== "string") return undefined;
  const authorUsername = p.authorId ? usernames.get(p.authorId) : undefined;
  const m = p.publicMetrics;
  return {
    id: p.id,
    text: p.text,
    ...(p.authorId ? { authorId: p.authorId } : {}),
    ...(authorUsername ? { authorUsername } : {}),
    ...(p.createdAt ? { createdAt: p.createdAt } : {}),
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.conversationId ? { conversationId: p.conversationId } : {}),
    ...(m
      ? {
          metrics: {
            likes: m.likeCount,
            reposts: m.repostCount,
            replies: m.replyCount,
            quotes: m.quoteCount,
            impressions: m.impressionCount,
          },
        }
      : {}),
    url: postUrl(p.id, authorUsername),
    retrievedAt,
  };
}

export function normalizeUser(u: SdkUser, retrievedAt: string): XUser | undefined {
  if (!u.id || !u.username) return undefined;
  return {
    id: u.id,
    username: u.username,
    ...(u.name ? { name: u.name } : {}),
    ...(u.description ? { description: u.description } : {}),
    ...(u.verified !== undefined ? { verified: u.verified } : {}),
    ...(u.protected !== undefined ? { protected: u.protected } : {}),
    ...(u.createdAt ? { createdAt: u.createdAt } : {}),
    ...(u.publicMetrics?.followersCount !== undefined ? { followers: u.publicMetrics.followersCount } : {}),
    ...(u.publicMetrics?.followingCount !== undefined ? { following: u.publicMetrics.followingCount } : {}),
    ...(u.publicMetrics?.postCount !== undefined ? { postCount: u.publicMetrics.postCount } : {}),
    url: userUrl(u.username),
    retrievedAt,
  };
}

/** Map SDK/network errors to XApiError without leaking credentials or response bodies. */
export function mapError(error: unknown): XApiError {
  if (error instanceof XApiError) return error;
  if (error instanceof ApiError) {
    const status = error.status;
    if (status === 0 && error.data instanceof XApiError) return error.data;
    if (status === 401) return new XApiError("X API rejected the credentials (401)", "unauthorized");
    if (status === 403) return new XApiError("X API access forbidden for this endpoint (403)", "forbidden");
    if (status === 404) return new XApiError("X resource not found (404)", "not_found");
    if (status === 400) return new XApiError("X API rejected the request (400)", "invalid_request");
    if (status === 429) {
      return new XApiError("X API rate limit reached (429)", "rate_limited", retryAfter(error.headers));
    }
    if (status >= 500 || status === 0) return new XApiError(`X API unavailable (${status})`, "upstream");
    return new XApiError(`X API error (${status})`, "upstream");
  }
  return new XApiError("X request failed", "upstream");
}

function retryAfter(headers: Headers | undefined): number | undefined {
  const reset = headers?.get("x-rate-limit-reset");
  if (reset) {
    const seconds = Number(reset) - Math.floor(Date.now() / 1000);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  const ra = headers?.get("retry-after");
  if (ra && Number.isFinite(Number(ra))) return Number(ra);
  return undefined;
}
