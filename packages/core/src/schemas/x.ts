import { z } from "zod";

/** Public engagement counters. Not every endpoint/access tier returns them. */
export const PostMetricsSchema = z.object({
  likes: z.number().int().nonnegative().optional(),
  reposts: z.number().int().nonnegative().optional(),
  replies: z.number().int().nonnegative().optional(),
  quotes: z.number().int().nonnegative().optional(),
  impressions: z.number().int().nonnegative().optional(),
});
export type PostMetrics = z.infer<typeof PostMetricsSchema>;

/** Normalized X post. Mock and live clients must both return this shape. */
export const XPostSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  authorId: z.string().optional(),
  authorUsername: z.string().optional(),
  createdAt: z.string().optional(),
  lang: z.string().optional(),
  conversationId: z.string().optional(),
  metrics: PostMetricsSchema.optional(),
  url: z.string().url(),
  /** When xbot fetched this post. */
  retrievedAt: z.string(),
});
export type XPost = z.infer<typeof XPostSchema>;

export const XUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  verified: z.boolean().optional(),
  protected: z.boolean().optional(),
  createdAt: z.string().optional(),
  followers: z.number().int().nonnegative().optional(),
  following: z.number().int().nonnegative().optional(),
  postCount: z.number().int().nonnegative().optional(),
  url: z.string().url(),
  retrievedAt: z.string(),
});
export type XUser = z.infer<typeof XUserSchema>;

export const SearchInputSchema = z.object({
  query: z.string().min(1).max(1024),
  /** Results per page. Recent search allows 10–100; archive allows 10–500. */
  maxResults: z.number().int().min(10).max(500).default(25),
  /** Maximum pages to follow. Each page is billed separately. */
  maxPages: z.number().int().min(1).max(10).default(1),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  sortOrder: z.enum(["recency", "relevancy"]).optional(),
});
export type SearchInput = z.input<typeof SearchInputSchema>;
export type ResolvedSearchInput = z.output<typeof SearchInputSchema>;

export const UserPostsInputSchema = z.object({
  userId: z.string().min(1),
  maxResults: z.number().int().min(5).max(100).default(25),
  maxPages: z.number().int().min(1).max(10).default(1),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});
export type UserPostsInput = z.input<typeof UserPostsInputSchema>;

export const SearchResultSchema = z.object({
  posts: z.array(XPostSchema),
  users: z.array(XUserSchema),
  /** Number of billable API pages requested. */
  pages: z.number().int().nonnegative(),
  nextToken: z.string().optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export function postUrl(id: string, username?: string): string {
  return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

export function userUrl(username: string): string {
  return `https://x.com/${username}`;
}
