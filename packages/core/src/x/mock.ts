import {
  postUrl,
  type ResolvedSearchInput,
  type SearchInput,
  SearchInputSchema,
  type SearchResult,
  type UserPostsInput,
  UserPostsInputSchema,
  userUrl,
  type XPost,
  type XUser,
} from "../schemas/x";
import { FIXTURE_POSTS, FIXTURE_USERS, type FixturePost, type FixtureUser } from "./fixtures";
import {
  assertPostIdBatch,
  parseRecentSearch,
  XApiError,
  type XReadClient,
  type XRequestContext,
} from "./port";
import { matchesQuery } from "./query";

export interface MockXReadClientOptions {
  posts?: FixturePost[];
  users?: FixtureUser[];
  /** Clock used to resolve fixture timestamps. Inject for deterministic tests. */
  now?: () => Date;
}

/** One request's view of the clock, computed once instead of per fixture. */
interface Tick {
  nowMs: number;
  iso: string;
}

/** Deterministic, credential-free X client backed by fixtures. */
export class MockXReadClient implements XReadClient {
  readonly mode = "mock" as const;
  private readonly posts: FixturePost[];
  private readonly users: FixtureUser[];
  private readonly usersById: Map<string, FixtureUser>;
  private readonly usersByName: Map<string, FixtureUser>;
  private readonly now: () => Date;

  constructor(options: MockXReadClientOptions = {}) {
    this.posts = options.posts ?? FIXTURE_POSTS;
    this.users = options.users ?? FIXTURE_USERS;
    this.usersById = new Map(this.users.map((u) => [u.id, u]));
    this.usersByName = new Map(this.users.map((u) => [u.username.toLowerCase(), u]));
    this.now = options.now ?? (() => new Date());
  }

  async searchRecent(input: SearchInput, _ctx?: XRequestContext): Promise<SearchResult> {
    const resolved = parseRecentSearch(input);
    const tick = this.tick();
    return this.search(resolved, tick, tick.nowMs - 7 * 24 * 60 * 60 * 1000);
  }

  async searchArchive(input: SearchInput, _ctx?: XRequestContext): Promise<SearchResult> {
    return this.search(SearchInputSchema.parse(input), this.tick(), Number.NEGATIVE_INFINITY);
  }

  async getPosts(ids: string[], _ctx?: XRequestContext): Promise<XPost[]> {
    if (ids.length === 0) return [];
    assertPostIdBatch(ids);
    const wanted = new Set(ids);
    const tick = this.tick();
    return this.posts.filter((p) => wanted.has(p.id)).map((p) => this.toPost(p, tick));
  }

  async getUserByUsername(username: string, _ctx?: XRequestContext): Promise<XUser> {
    const user = this.usersByName.get(username.replace(/^@/, "").toLowerCase());
    if (!user) throw new XApiError(`User @${username} not found`, "not_found");
    return this.toUser(user, this.tick());
  }

  async getUserPosts(input: UserPostsInput, _ctx?: XRequestContext): Promise<SearchResult> {
    const resolved = UserPostsInputSchema.parse(input);
    const user = this.usersById.get(resolved.userId);
    if (!user) throw new XApiError(`User ${resolved.userId} not found`, "not_found");
    const tick = this.tick();
    const inWindow = this.windowFilter(tick, resolved.startTime, resolved.endTime, Number.NEGATIVE_INFINITY);
    const matched = sorted(this.posts.filter((p) => p.authorId === user.id && inWindow(p)));
    return this.paginate(matched, resolved.maxResults, resolved.maxPages, tick);
  }

  private tick(): Tick {
    const now = this.now();
    return { nowMs: now.getTime(), iso: now.toISOString() };
  }

  private search(input: ResolvedSearchInput, tick: Tick, floorMs: number): SearchResult {
    const inWindow = this.windowFilter(tick, input.startTime, input.endTime, floorMs);
    const matched = sorted(
      this.posts.filter((p) => {
        const matchable = {
          text: p.text,
          lang: p.lang,
          authorUsername: this.usersById.get(p.authorId)?.username,
        };
        return matchesQuery(matchable, input.query) && inWindow(p);
      }),
      input.sortOrder,
    );
    return this.paginate(matched, input.maxResults, input.maxPages, tick);
  }

  private paginate(matched: FixturePost[], perPage: number, maxPages: number, tick: Tick): SearchResult {
    const posts: XPost[] = [];
    let pages = 0;
    let offset = 0;
    while (pages < maxPages) {
      pages += 1;
      posts.push(...matched.slice(offset, offset + perPage).map((p) => this.toPost(p, tick)));
      offset += perPage;
      if (offset >= matched.length) break;
    }
    const authorIds = new Set(posts.map((p) => p.authorId));
    const users = this.users.filter((u) => authorIds.has(u.id)).map((u) => this.toUser(u, tick));
    return {
      posts,
      users,
      pages,
      ...(offset < matched.length ? { nextToken: String(offset) } : {}),
    };
  }

  private windowFilter(tick: Tick, start: string | undefined, end: string | undefined, floorMs: number) {
    const lo = Math.max(floorMs, start ? Date.parse(start) : Number.NEGATIVE_INFINITY);
    const hi = end ? Date.parse(end) : Number.POSITIVE_INFINITY;
    return (p: FixturePost) => {
      const t = createdAtMs(p, tick);
      return t >= lo && t <= hi;
    };
  }

  private toPost(p: FixturePost, tick: Tick): XPost {
    const username = this.usersById.get(p.authorId)?.username;
    return {
      id: p.id,
      text: p.text,
      authorId: p.authorId,
      authorUsername: username,
      createdAt: new Date(createdAtMs(p, tick)).toISOString(),
      lang: p.lang,
      conversationId: p.id,
      metrics: { likes: p.likes, reposts: p.reposts, replies: p.replies, quotes: 0 },
      url: postUrl(p.id, username),
      retrievedAt: tick.iso,
    };
  }

  private toUser(u: FixtureUser, tick: Tick): XUser {
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      description: u.description,
      verified: u.verified ?? false,
      protected: false,
      followers: u.followers,
      url: userUrl(u.username),
      retrievedAt: tick.iso,
    };
  }
}

function createdAtMs(p: FixturePost, tick: Tick): number {
  return tick.nowMs - p.minutesAgo * 60_000;
}

function sorted(posts: FixturePost[], order: "recency" | "relevancy" = "recency"): FixturePost[] {
  const copy = [...posts];
  if (order === "relevancy") {
    return copy.sort(
      (a, b) => b.likes + b.reposts * 2 - (a.likes + a.reposts * 2) || a.minutesAgo - b.minutesAgo,
    );
  }
  return copy.sort((a, b) => a.minutesAgo - b.minutesAgo);
}
