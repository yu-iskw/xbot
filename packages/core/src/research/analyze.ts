import type { Analysis, Finding } from "../schemas/research";
import type { XPost } from "../schemas/x";

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can do does for from has have how i if in into is it its just " +
    "like more most my no not of on or our out so than that the their them then there these they this " +
    "to too up us was we were what when which who why will with you your all any about after again also " +
    "am because before being both did each few get got had he her here him his me much must now off once " +
    "only other own same she should some still such very would via one two new use using used make makes " +
    "made really need needs way ways yes good better far lot lots thing things going week minutes " +
    "see seen say says said know think every even many try trying day days today time"
  ).split(" "),
);

const DISSENT_MARKERS = [
  "not convinced",
  "skeptic",
  "hot take",
  "hype",
  "overrated",
  "change my mind",
  "fail",
  "not needed",
  "waiting to happen",
  "just mlops",
];

export function engagement(post: XPost): number {
  const m = post.metrics ?? {};
  return (m.likes ?? 0) + 2 * (m.reposts ?? 0) + (m.replies ?? 0) + (m.quotes ?? 0);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^\p{L}\p{N}#_-]+/u)
    .map((t) => t.replace(/^[-_]+|[-_]+$/g, ""))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export interface Theme {
  term: string;
  postIds: string[];
  authors: number;
}

/** Fold simple plurals so "agent" and "agents" count as one theme. */
function canonical(term: string): string {
  const t = term.replace(/^#/, "");
  return t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

/** Terms (hashtags weighted up) that recur across distinct posts, excluding the query's own terms. */
export function extractThemes(posts: XPost[], exclude: string[], limit = 5): Theme[] {
  const excluded = new Set<string>();
  for (const q of exclude) {
    for (const t of tokenize(q)) excluded.add(canonical(t));
    // Multi-word topics often appear as one hashtag: "AI agents" -> #AIagents.
    excluded.add(
      canonical(
        q
          .toLowerCase()
          .replace(/(^|\s)-?\w+:\S+/g, "")
          .replace(/[^\p{L}\p{N}]/gu, ""),
      ),
    );
  }
  const byTerm = new Map<string, { posts: Set<string>; authors: Set<string>; weight: number }>();
  for (const post of posts) {
    const seen = new Set<string>();
    for (const raw of tokenize(post.text)) {
      const term = canonical(raw);
      if (excluded.has(term) || seen.has(term) || term.length < 3) continue;
      seen.add(term);
      const entry = byTerm.get(term) ?? { posts: new Set(), authors: new Set(), weight: 0 };
      entry.posts.add(post.id);
      entry.authors.add(post.authorId ?? post.id);
      entry.weight += raw.startsWith("#") ? 1.5 : 1;
      byTerm.set(term, entry);
    }
  }
  const engagementById = new Map(posts.map((p) => [p.id, engagement(p)]));
  return [...byTerm.entries()]
    .filter(([, e]) => e.posts.size >= 2)
    .sort(([ta, a], [tb, b]) => b.weight * b.authors.size - a.weight * a.authors.size || ta.localeCompare(tb))
    .slice(0, limit)
    .map(([term, e]) => ({
      term,
      postIds: [...e.posts].sort((x, y) => (engagementById.get(y) ?? 0) - (engagementById.get(x) ?? 0)),
      authors: e.authors.size,
    }));
}

/**
 * Model-free analysis. Every finding is an observation or a clearly-labelled synthesis about the
 * collected sample, with evidence IDs drawn only from that sample.
 */
export function deterministicAnalysis(query: string, posts: XPost[], plannedQueries: string[]): Analysis {
  if (posts.length === 0) {
    return {
      summary: `No posts matching "${query}" were found in the research window.`,
      findings: [],
      opposingViews: [],
      unknowns: ["No evidence was collected, so nothing can be said about the topic from X data."],
    };
  }

  const authors = new Set(posts.map((p) => p.authorId ?? p.id));
  const engagementById = new Map(posts.map((p) => [p.id, engagement(p)]));
  const ranked = [...posts].sort((a, b) => engagementById.get(b.id)! - engagementById.get(a.id)!);
  const themes = extractThemes(posts, [query, ...plannedQueries]);
  const findings: Finding[] = [];

  for (const theme of themes) {
    findings.push({
      claim: `"${theme.term}" recurs across ${theme.postIds.length} of ${posts.length} collected posts from ${theme.authors} distinct accounts.`,
      kind: "synthesis",
      confidence: theme.authors >= 3 ? "medium" : "low",
      evidence: theme.postIds.slice(0, 3),
      limitations: ["Term co-occurrence only; the posts may use the term with different meanings."],
    });
  }

  const top = ranked[0]!;
  findings.push({
    claim: `The most-engaged collected post (${engagementById.get(top.id)} weighted interactions) came from ${top.authorUsername ? `@${top.authorUsername}` : "an account"}.`,
    kind: "observation",
    confidence: "high",
    evidence: [top.id],
    limitations: ["High engagement does not mean the view is representative of X users."],
  });

  // Filtering the ranked list keeps dissenting posts in engagement order.
  const dissenting = ranked.filter((p) => {
    const text = p.text.toLowerCase();
    return DISSENT_MARKERS.some((m) => text.includes(m));
  });
  const opposingViews = dissenting
    .slice(0, 3)
    .map(
      (p) =>
        `${p.authorUsername ? `@${p.authorUsername}` : "A post"} expresses skepticism or criticism (post ${p.id}).`,
    );
  if (dissenting.length > 0) {
    findings.push({
      claim: `${dissenting.length} of ${posts.length} collected posts express skepticism or criticism.`,
      kind: "observation",
      confidence: "medium",
      evidence: dissenting.slice(0, 3).map((p) => p.id),
      limitations: ["Detected with keyword markers, which miss sarcasm and nuanced criticism."],
    });
  }

  const langs = new Map<string, number>();
  for (const p of posts) langs.set(p.lang ?? "und", (langs.get(p.lang ?? "und") ?? 0) + 1);
  const themeList = themes.map((t) => t.term).slice(0, 3);
  const summary =
    `Collected ${posts.length} posts from ${authors.size} accounts about "${query}". ` +
    (themeList.length > 0 ? `Recurring themes in this sample: ${themeList.join(", ")}. ` : "") +
    (dissenting.length > 0 ? `${dissenting.length} posts push back or express skepticism. ` : "") +
    "These are observations about the collected sample, not about X users in general.";

  return {
    summary,
    findings,
    opposingViews,
    unknowns: [
      `Languages in sample: ${[...langs.entries()].map(([l, n]) => `${l} (${n})`).join(", ")}; other languages may be underrepresented.`,
      "Theme detection is lexical (no model was configured); interpretation of intent is out of scope.",
    ],
  };
}
