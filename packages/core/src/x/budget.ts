import {
  type SearchInput,
  SearchInputSchema,
  type SearchResult,
  type UserPostsInput,
  UserPostsInputSchema,
  type XPost,
  type XUser,
} from "../schemas/x";
import { XApiError, type XClientMode, type XReadClient, type XRequestContext } from "./port";

/**
 * X pay-per-use prices in USD per returned resource. Prices change; the X Developer Console is
 * authoritative. Override through configuration when they do.
 */
export interface XPricing {
  postRead: number;
  userRead: number;
}
export const DEFAULT_X_PRICING: XPricing = { postRead: 0.005, userRead: 0.01 };

export interface BudgetLimits {
  /** Default cap for one research run when the request does not set one. */
  perRunUsd: number;
  /** Cap for a single request made outside a run (interactive tool calls). */
  perRequestUsd: number;
  dailyUsd: number;
  monthlyUsd: number;
}
export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  perRunUsd: 1,
  perRequestUsd: 0.5,
  dailyUsd: 5,
  monthlyUsd: 50,
};

export interface UsageRecord {
  runId?: string;
  operation: string;
  posts: number;
  users: number;
  costUsd: number;
  mode: XClientMode;
  at: string;
}

/** Persistence for spend accounting, shared by every consumer of the runtime. */
export interface UsageStore {
  recordUsage(record: UsageRecord): Promise<void>;
  /** Spend since the start of the UTC day and month, in one read. */
  periodCost(
    dayStartIso: string,
    monthStartIso: string,
    mode: XClientMode,
  ): Promise<{ day: number; month: number }>;
}

export interface PostCache {
  getCachedPosts(ids: string[], nowIso: string): Promise<XPost[]>;
  cachePosts(posts: XPost[], expiresAtIso: string): Promise<void>;
}

export interface RunUsage {
  requests: number;
  posts: number;
  users: number;
  costUsd: number;
  cacheHits: number;
}

interface RunBudget extends RunUsage {
  limitUsd: number;
}

const EMPTY_USAGE: RunUsage = { requests: 0, posts: 0, users: 0, costUsd: 0, cacheHits: 0 };

function snapshot({ limitUsd: _, ...usage }: RunBudget): RunUsage {
  return usage;
}

export interface BudgetedXReadClientOptions {
  inner: XReadClient;
  usage: UsageStore;
  cache?: PostCache;
  cacheTtlSeconds?: number;
  limits?: Partial<BudgetLimits>;
  pricing?: Partial<XPricing>;
  /** Enforce daily and monthly limits. Defaults to true; mock mode may disable it for local development. */
  enforcePeriodLimits?: boolean;
  now?: () => Date;
}

/**
 * Enforces per-run, per-request, daily (UTC), and monthly (UTC) spending limits before any X request,
 * records actual spend afterward, and serves previously retrieved posts from cache.
 */
export class BudgetedXReadClient implements XReadClient {
  readonly mode: XClientMode;
  readonly limits: BudgetLimits;
  readonly pricing: XPricing;
  readonly #inner: XReadClient;
  readonly #usage: UsageStore;
  readonly #cache: PostCache | undefined;
  readonly #cacheTtlSeconds: number;
  readonly #now: () => Date;
  readonly #enforcePeriodLimits: boolean;
  readonly #runs = new Map<string, RunBudget>();

  constructor(options: BudgetedXReadClientOptions) {
    this.#inner = options.inner;
    this.mode = options.inner.mode;
    this.#usage = options.usage;
    this.#cache = options.cache;
    this.#cacheTtlSeconds = options.cacheTtlSeconds ?? 24 * 60 * 60;
    this.limits = { ...DEFAULT_BUDGET_LIMITS, ...options.limits };
    this.pricing = { ...DEFAULT_X_PRICING, ...options.pricing };
    this.#now = options.now ?? (() => new Date());
    this.#enforcePeriodLimits = options.enforcePeriodLimits ?? true;
  }

  /** The cap a run gets: the requested limit, never above the configured per-run budget. */
  runLimit(limitUsd?: number): number {
    return Math.min(limitUsd ?? this.limits.perRunUsd, this.limits.perRunUsd);
  }

  /** Start tracking a run. Requests carrying this runId are held to `runLimit(limitUsd)`. */
  openRun(runId: string, limitUsd?: number): void {
    this.#runs.set(runId, { ...EMPTY_USAGE, limitUsd: this.runLimit(limitUsd) });
  }

  /** Stop tracking a run and return what it consumed. */
  closeRun(runId: string): RunUsage {
    const usage = this.runUsage(runId) ?? EMPTY_USAGE;
    this.#runs.delete(runId);
    return usage;
  }

  runUsage(runId: string): RunUsage | undefined {
    const run = this.#runs.get(runId);
    return run && snapshot(run);
  }

  /** Worst-case cost of a request returning `posts` posts and their authors. */
  estimate(posts: number, users = posts): number {
    return round(posts * this.pricing.postRead + users * this.pricing.userRead);
  }

  async remaining(): Promise<{ dailyUsd: number; monthlyUsd: number }> {
    const now = this.#now();
    const spent = await this.#usage.periodCost(
      startOfUtcDay(now).toISOString(),
      startOfUtcMonth(now).toISOString(),
      this.mode,
    );
    return {
      dailyUsd: round(this.limits.dailyUsd - spent.day),
      monthlyUsd: round(this.limits.monthlyUsd - spent.month),
    };
  }

  searchRecent(input: SearchInput, ctx?: XRequestContext): Promise<SearchResult> {
    const r = SearchInputSchema.parse(input);
    return this.#search("searchRecent", r, ctx, () => this.#inner.searchRecent(r, ctx));
  }

  searchArchive(input: SearchInput, ctx?: XRequestContext): Promise<SearchResult> {
    const r = SearchInputSchema.parse(input);
    return this.#search("searchArchive", r, ctx, () => this.#inner.searchArchive(r, ctx));
  }

  async getPosts(ids: string[], ctx?: XRequestContext): Promise<XPost[]> {
    const unique = [...new Set(ids)];
    const cached = this.#cache ? await this.#cache.getCachedPosts(unique, this.#now().toISOString()) : [];
    const cachedIds = new Set(cached.map((p) => p.id));
    const missing = unique.filter((id) => !cachedIds.has(id));
    const run = ctx?.runId ? this.#runs.get(ctx.runId) : undefined;
    if (run) run.cacheHits += cached.length;
    if (missing.length === 0) return cached;
    await this.#authorize(this.estimate(missing.length, 0), ctx);
    const fetched = await this.#inner.getPosts(missing, ctx);
    await Promise.all([this.#settle("getPosts", fetched.length, 0, ctx, 1), this.#cachePosts(fetched)]);
    return [...cached, ...fetched];
  }

  async getUserByUsername(username: string, ctx?: XRequestContext): Promise<XUser> {
    await this.#authorize(this.estimate(0, 1), ctx);
    const user = await this.#inner.getUserByUsername(username, ctx);
    await this.#settle("getUserByUsername", 0, 1, ctx, 1);
    return user;
  }

  getUserPosts(input: UserPostsInput, ctx?: XRequestContext): Promise<SearchResult> {
    const r = UserPostsInputSchema.parse(input);
    return this.#search("getUserPosts", r, ctx, () => this.#inner.getUserPosts(r, ctx));
  }

  /** Authorize the worst case of a paginated request, run it, then record spend and cache posts. */
  async #search(
    operation: string,
    r: { maxResults: number; maxPages: number },
    ctx: XRequestContext | undefined,
    call: () => Promise<SearchResult>,
  ): Promise<SearchResult> {
    await this.#authorize(this.estimate(r.maxResults * r.maxPages), ctx);
    const result = await call();
    await Promise.all([
      this.#settle(operation, result.posts.length, result.users.length, ctx, result.pages),
      this.#cachePosts(result.posts),
    ]);
    return result;
  }

  async #authorize(estimatedUsd: number, ctx?: XRequestContext): Promise<void> {
    const run = ctx?.runId ? this.#runs.get(ctx.runId) : undefined;
    if (run) {
      if (run.costUsd + estimatedUsd > run.limitUsd + 1e-9) {
        throw new XApiError(
          `Run budget exceeded: request may cost $${estimatedUsd.toFixed(3)}, ` +
            `$${(run.limitUsd - run.costUsd).toFixed(3)} of $${run.limitUsd.toFixed(2)} remaining`,
          "budget_exceeded",
        );
      }
    } else if (estimatedUsd > this.limits.perRequestUsd + 1e-9) {
      throw new XApiError(
        `Request may cost $${estimatedUsd.toFixed(3)}, above the per-request cap of $${this.limits.perRequestUsd.toFixed(2)}`,
        "budget_exceeded",
      );
    }
    if (!this.#enforcePeriodLimits) return;
    const remaining = await this.remaining();
    if (estimatedUsd > remaining.dailyUsd + 1e-9) {
      throw new XApiError(
        `Daily X budget exhausted ($${Math.max(0, remaining.dailyUsd).toFixed(3)} left)`,
        "budget_exceeded",
      );
    }
    if (estimatedUsd > remaining.monthlyUsd + 1e-9) {
      throw new XApiError(
        `Monthly X budget exhausted ($${Math.max(0, remaining.monthlyUsd).toFixed(3)} left)`,
        "budget_exceeded",
      );
    }
  }

  async #settle(
    operation: string,
    posts: number,
    users: number,
    ctx: XRequestContext | undefined,
    pages: number,
  ) {
    const costUsd = this.estimate(posts, users);
    const run = ctx?.runId ? this.#runs.get(ctx.runId) : undefined;
    if (run) {
      run.requests += pages;
      run.posts += posts;
      run.users += users;
      run.costUsd = round(run.costUsd + costUsd);
    }
    await this.#usage.recordUsage({
      ...(ctx?.runId ? { runId: ctx.runId } : {}),
      operation,
      posts,
      users,
      costUsd,
      mode: this.mode,
      at: this.#now().toISOString(),
    });
  }

  async #cachePosts(posts: XPost[]): Promise<void> {
    if (!this.#cache || posts.length === 0 || this.#cacheTtlSeconds <= 0) return;
    const expires = new Date(this.#now().getTime() + this.#cacheTtlSeconds * 1000).toISOString();
    await this.#cache.cachePosts(posts, expires);
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
