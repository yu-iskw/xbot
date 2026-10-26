import { describe, expect, it, vi } from "vitest";
import {
  createReadOnlyFetch,
  isAllowedXRequest,
  LiveXReadClient,
  MockXReadClient,
  readOnlyFacade,
  X_READ_OPERATIONS,
  XPostSchema,
} from "../src/index";
import { memoryRuntime } from "./helpers";

const WRITE_WORDS =
  /^(create|post|delete|update|like|unlike|repost|retweet|reply|follow|unfollow|send|hide|mute|block|bookmark)/i;

describe("read-only enforcement", () => {
  it("facade exposes exactly the allowlisted read operations", () => {
    const inner = Object.assign(new MockXReadClient(), { createPost: async () => "nope" });
    const facade = readOnlyFacade(inner);
    expect(Object.keys(facade).sort()).toEqual(["mode", ...X_READ_OPERATIONS].sort());
    expect((facade as unknown as Record<string, unknown>).createPost).toBeUndefined();
    expect(Object.isFrozen(facade)).toBe(true);
  });

  it("only allowlisted GET endpoints pass the network guard", () => {
    expect(isAllowedXRequest("GET", "https://api.x.com/2/tweets/search/recent?query=a")).toBe(true);
    expect(isAllowedXRequest("GET", "https://api.x.com/2/users/by/username/fixture_ana")).toBe(true);
    expect(isAllowedXRequest("GET", "https://api.x.com/2/users/123/tweets")).toBe(true);
    expect(isAllowedXRequest("POST", "https://api.x.com/2/tweets")).toBe(false);
    expect(isAllowedXRequest("DELETE", "https://api.x.com/2/tweets/1")).toBe(false);
    expect(isAllowedXRequest("GET", "https://api.x.com/2/users/123/likes")).toBe(false);
    expect(isAllowedXRequest("GET", "http://api.x.com/2/tweets")).toBe(false);
    expect(isAllowedXRequest("GET", "https://evil.example/2/tweets")).toBe(false);
  });

  it("guarded fetch refuses writes without touching the network", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const guarded = createReadOnlyFetch(base as unknown as typeof fetch);
    await expect(guarded("https://api.x.com/2/tweets", { method: "POST", body: "{}" })).rejects.toThrow(
      /Blocked/,
    );
    expect(base).not.toHaveBeenCalled();
  });

  it("registered agent tools contain no write-capable X operations", async () => {
    const runtime = await memoryRuntime();
    const ids = Object.values(runtime.tools).map((t) => t.id);
    expect(ids.filter((id) => /^x-/.test(id) && WRITE_WORDS.test(id.replace(/^x-/, "")))).toEqual([]);
    expect(ids.filter((id) => id.startsWith("x-")).sort()).toEqual(
      ["x-get-posts", "x-get-user", "x-get-user-posts", "x-search-posts"].sort(),
    );
    await runtime.close();
  });

  it("the runtime's X client is the budgeted read-only facade", async () => {
    const runtime = await memoryRuntime();
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(runtime.x));
    expect(proto.filter((m) => WRITE_WORDS.test(m))).toEqual([]);
    await runtime.close();
  });
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("LiveXReadClient (contract, fake transport)", () => {
  const page = {
    data: [
      {
        id: "1900000000000000001",
        text: "hello",
        author_id: "9000000001",
        created_at: "2026-10-26T08:00:00.000Z",
        lang: "en",
        public_metrics: {
          like_count: 3,
          repost_count: 1,
          reply_count: 0,
          quote_count: 0,
          impression_count: 10,
        },
      },
    ],
    includes: { users: [{ id: "9000000001", username: "fixture_ana", name: "Ana" }] },
    meta: { result_count: 1 },
  };

  it("normalizes SDK responses to the same schema as mock mode", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        auth: new Headers(init?.headers).get("authorization"),
      });
      return jsonResponse(page);
    });
    const client = new LiveXReadClient({
      bearerToken: "test-token",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.searchRecent({ query: "hello", maxResults: 10 });
    expect(res.posts).toHaveLength(1);
    const post = XPostSchema.parse(res.posts[0]);
    expect(post).toMatchObject({ authorUsername: "fixture_ana", metrics: { likes: 3, reposts: 1 } });
    expect(post.url).toBe("https://x.com/fixture_ana/status/1900000000000000001");
    expect(calls[0]!.method).toBe("GET");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/2/tweets/search/recent");
    expect(url.searchParams.has("sort_order")).toBe(false);
    expect(calls[0]!.auth).toBe("Bearer test-token");
    await client.searchRecent({ query: "hello", maxResults: 10, sortOrder: "relevancy" });
    expect(new URL(calls[1]!.url).searchParams.get("sort_order")).toBe("relevancy");

    const mock = await new MockXReadClient().searchRecent({ query: "#Mastra" });
    expect(Object.keys(XPostSchema.shape)).toEqual(expect.arrayContaining(Object.keys(mock.posts[0]!)));
    expect(Object.keys(XPostSchema.shape)).toEqual(expect.arrayContaining(Object.keys(post)));
  });

  it("keeps each client's guarded network layer separate", async () => {
    const a = vi.fn(async () => jsonResponse(page));
    const b = vi.fn(async () => jsonResponse(page));
    const clientA = new LiveXReadClient({ bearerToken: "a", fetch: a as unknown as typeof fetch });
    new LiveXReadClient({ bearerToken: "b", fetch: b as unknown as typeof fetch });
    await clientA.searchRecent({ query: "hello" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("retries 429 with backoff, then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () =>
      ++n === 1 ? jsonResponse({}, 429, { "retry-after": "1" }) : jsonResponse(page),
    );
    const sleep = vi.fn(async () => undefined);
    const client = new LiveXReadClient({
      bearerToken: "t",
      fetch: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    const res = await client.searchRecent({ query: "hello" });
    expect(res.posts).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("fails immediately on bad credentials without leaking the token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ title: "Unauthorized", detail: "secret-token-xyz" }, 401),
    );
    const client = new LiveXReadClient({
      bearerToken: "secret-token-xyz",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.searchRecent({ query: "a" }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "unauthorized" });
    expect(String((err as Error).message)).not.toContain("secret-token-xyz");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("paginates up to maxPages", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...page,
        data: [{ ...page.data[0], id: `19000000000000000${10 + n}` }],
        meta: { next_token: `t${++n}` },
      }),
    );
    const client = new LiveXReadClient({ bearerToken: "t", fetch: fetchImpl as unknown as typeof fetch });
    const res = await client.searchRecent({ query: "a", maxPages: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(res.posts).toHaveLength(3);
    expect(res.pages).toBe(3);
  });
});
