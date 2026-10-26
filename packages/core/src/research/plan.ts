import type { ProposedPlan, ResearchPlan, ResolvedResearchInput } from "../schemas/research";

export const PLAN_LIMITS = {
  maxQueries: 5,
  maxPagesPerQuery: 3,
  minResultsPerPage: 10,
  maxResultsPerPage: 100,
  maxQueryLength: 512,
} as const;

/** Pricing hook so planning can stay independent of the X client implementation. */
export interface CostEstimator {
  estimate(posts: number, users?: number): number;
}

/** Words that frame a natural-language question rather than name its subject. */
const QUESTION_FILLER = new Set(
  (
    "what whats who how why when where which are is was were do does did can could should would the a an " +
    "of on in at to for about around regarding re people users developers devs folks everyone anyone " +
    "discussing discuss discussed talking talk saying say said think thinking feel opinion opinions view " +
    "views sentiment latest recent recently currently now today these days x twitter tweets posts post " +
    "and or with tell me show find give summarize summarise trends trending lately"
  ).split(" "),
);

const OPERATOR_RE = /(^|\s)(-?\w+:\S+|"[^"]*"|\(|\)|OR)(?=\s|$)/;

/**
 * Reduce a request to search terms. Queries that already use X operators are kept as written;
 * natural-language questions keep their subject words, preferring proper nouns and hashtags.
 */
export function extractKeyTerms(query: string): string[] {
  const words = query
    .replace(/[?!.,;]+(\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const content = words.filter((w) => !QUESTION_FILLER.has(w.toLowerCase().replace(/^#/, "")));
  // Capitalized words mid-sentence are likely names; the first word is capitalized by convention.
  const named = content.filter((w) => w.startsWith("#") || (/^\p{Lu}/u.test(w) && w !== words[0]));
  const chosen = named.length > 0 ? named : content;
  return chosen.slice(0, 3);
}

/** Plan without a model: the request (or its key terms) plus a hashtag variant for single-term topics. */
export function deterministicPlan(input: ResolvedResearchInput): ProposedPlan {
  const query = input.query.trim();
  const looksLikeQuestion =
    !OPERATOR_RE.test(query) && (query.split(/\s+/).length > 3 || /\?\s*$/.test(query));
  const terms = looksLikeQuestion ? extractKeyTerms(query) : [];
  const core = looksLikeQuestion && terms.length > 0 ? terms.join(" ") : query;
  const queries = [
    {
      query: baseQuery(core, input.language),
      rationale: core === query ? "The request as stated" : `Key terms of the request: ${terms.join(", ")}`,
    },
  ];
  // A single-term topic also gets its hashtag form, which often surfaces more on-topic posts.
  const single = core.split(/\s+/);
  if (single.length === 1 && /^[\p{L}\p{N}_]+$/u.test(single[0]!)) {
    queries.push({
      query: baseQuery(`#${single[0]}`, input.language),
      rationale: "Hashtag variant of the topic",
    });
  }
  return { objective: `Understand what X users are saying about: ${query}`, queries };
}

function baseQuery(q: string, language?: string): string {
  const parts = [q];
  if (!/(^|\s)-?is:retweet\b/.test(q)) parts.push("-is:retweet");
  if (language && !/(^|\s)lang:/.test(q)) parts.push(`lang:${language}`);
  return parts.join(" ");
}

/**
 * Clamp a proposed plan (from an LLM or the deterministic planner) to hard limits.
 * The model proposes; application code decides how much may actually be fetched.
 */
export function finalizePlan(
  proposed: ProposedPlan,
  input: ResolvedResearchInput,
  options: { maxCostUsd: number; costs: CostEstimator; now: Date; planner: ResearchPlan["planner"] },
): ResearchPlan {
  const seen = new Set<string>();
  const queries = proposed.queries
    .map((q) => ({ query: q.query.trim().slice(0, PLAN_LIMITS.maxQueryLength), rationale: q.rationale }))
    .filter((q) => q.query.length > 0 && !seen.has(q.query.toLowerCase()) && seen.add(q.query.toLowerCase()))
    .slice(0, PLAN_LIMITS.maxQueries);
  if (queries.length === 0) {
    queries.push({ query: input.query, rationale: "Fallback to the original request" });
  }

  let perPage = clamp(
    Math.ceil(input.maxPosts / queries.length),
    PLAN_LIMITS.minResultsPerPage,
    PLAN_LIMITS.maxResultsPerPage,
  );
  let pages = clamp(Math.ceil(input.maxPosts / queries.length / perPage), 1, PLAN_LIMITS.maxPagesPerQuery);
  const worstCase = () => options.costs.estimate(queries.length * perPage * pages);

  // Shrink pages, then page size, then the number of queries until the worst case fits the budget.
  while (worstCase() > options.maxCostUsd) {
    if (pages > 1) pages -= 1;
    else if (perPage > PLAN_LIMITS.minResultsPerPage)
      perPage = Math.max(PLAN_LIMITS.minResultsPerPage, perPage - 10);
    else if (queries.length > 1) queries.pop();
    else break;
  }

  const end = options.now;
  const startTime = recentSearchStart(end, input.windowDays);

  return {
    objective: proposed.objective,
    queries,
    startTime,
    endTime: new Date(end.getTime() - 30_000).toISOString(),
    maxResultsPerQuery: perPage,
    maxPagesPerQuery: pages,
    maxPosts: input.maxPosts,
    estimatedMaxCostUsd: worstCase(),
    maxCostUsd: options.maxCostUsd,
    planner: options.planner,
  };
}

/**
 * Start of a `windowDays` window ending at `now`, clamped inside recent search's 7-day limit
 * (which rejects start times at the very edge of the window).
 */
export function recentSearchStart(now: Date, windowDays: number): string {
  const start = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const floor = now.getTime() - (7 * 24 * 60 - 5) * 60 * 1000;
  return new Date(Math.max(start, floor)).toISOString();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
