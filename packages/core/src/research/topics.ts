import type { z } from "zod";
import type { ResearchTopicSchema } from "../schemas/research";

type Topic = z.output<typeof ResearchTopicSchema>;

/** X search query for a topic: its keywords and accounts OR-ed together, else its description. */
export function topicQuery(topic: Topic): string {
  const parts = [...topic.keywords, ...topic.accounts.map((a) => `from:${a.replace(/^@/, "")}`)];
  return parts.length > 0 ? parts.join(" OR ") : topic.description;
}
