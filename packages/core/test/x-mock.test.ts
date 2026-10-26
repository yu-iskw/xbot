import { describe, expect, it } from "vitest";
import { MockXReadClient, matchesQuery, XPostSchema, XUserSchema } from "../src/index";
import { fixedNow } from "./helpers";

describe("matchesQuery", () => {
  const post = { text: "Mastra workflows are typed #Mastra", authorUsername: "fixture_ana", lang: "en" };
  it.each([
    ["mastra", true],
    ['"typed #mastra"', true],
    ["mastra -typed", false],
    ["python OR workflows", true],
    ["from:fixture_ana", true],
    ["from:someone mastra", false],
    ["lang:ja", false],
    ["mastra -is:retweet has:links", true],
  ])("%s → %s", (q, expected) => expect(matchesQuery(post, q)).toBe(expected));
});

describe("MockXReadClient", () => {
  const client = new MockXReadClient({ now: fixedNow });

  it("returns normalized posts and authors", async () => {
    const res = await client.searchRecent({ query: "#Mastra", maxResults: 10 });
    expect(res.posts.length).toBeGreaterThan(0);
    for (const p of res.posts) XPostSchema.parse(p);
    for (const u of res.users) XUserSchema.parse(u);
    expect(new Set(res.users.map((u) => u.id))).toEqual(new Set(res.posts.map((p) => p.authorId)));
  });

  it("paginates within maxPages", async () => {
    const one = await client.searchRecent({ query: "the", maxResults: 10, maxPages: 1 });
    expect(one.pages).toBe(1);
    expect(one.posts).toHaveLength(10);
    expect(one.nextToken).toBeDefined();
    const two = await client.searchRecent({ query: "the", maxResults: 10, maxPages: 2 });
    expect(two.posts.length).toBeGreaterThan(10);
  });

  it("honours the time window and recent-search page limit", async () => {
    const start = new Date(fixedNow().getTime() - 60 * 60 * 1000).toISOString();
    const res = await client.searchRecent({ query: "mastra", startTime: start });
    expect(res.posts.every((p) => Date.parse(p.createdAt!) >= Date.parse(start))).toBe(true);
    await expect(client.searchRecent({ query: "x", maxResults: 200 })).rejects.toThrow(/at most 100/);
  });

  it("looks up users and their posts", async () => {
    const user = await client.getUserByUsername("@fixture_omar");
    const res = await client.getUserPosts({ userId: user.id });
    expect(res.posts.every((p) => p.authorUsername === "fixture_omar")).toBe(true);
    await expect(client.getUserByUsername("nobody")).rejects.toMatchObject({ code: "not_found" });
  });
});
