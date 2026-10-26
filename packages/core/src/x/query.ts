/**
 * A small evaluator for the subset of X search operators that mock mode understands:
 * keywords (AND), "quoted phrases", OR, -negation, #hashtags, from:user, lang:xx.
 * Other operators (is:, has:, -is:retweet ...) are accepted and ignored.
 */

export interface MatchablePost {
  text: string;
  authorUsername?: string;
  lang?: string;
}

type Term =
  | { kind: "text"; value: string; negated: boolean }
  | { kind: "from"; value: string; negated: boolean }
  | { kind: "lang"; value: string; negated: boolean }
  | { kind: "ignored" };

const TOKEN_RE = /-?"[^"]*"|\(|\)|[^\s()]+/g;

function parseTerm(token: string): Term | "OR" | null {
  if (token === "OR") return "OR";
  if (token === "(" || token === ")") return null;
  const negated = token.startsWith("-");
  const body = negated ? token.slice(1) : token;
  if (body.startsWith('"') && body.endsWith('"')) {
    const phrase = body.slice(1, -1).trim();
    return phrase ? { kind: "text", value: phrase.toLowerCase(), negated } : null;
  }
  const colon = body.indexOf(":");
  if (colon > 0) {
    const op = body.slice(0, colon).toLowerCase();
    const value = body.slice(colon + 1).toLowerCase();
    if (op === "from") return { kind: "from", value: value.replace(/^@/, ""), negated };
    if (op === "lang") return { kind: "lang", value, negated };
    return { kind: "ignored" };
  }
  return body ? { kind: "text", value: body.toLowerCase(), negated } : null;
}

/** Returns groups of AND-ed terms; groups are OR-ed together. */
export function parseQuery(query: string): Term[][] {
  const groups: Term[][] = [[]];
  for (const token of query.match(TOKEN_RE) ?? []) {
    const term = parseTerm(token);
    if (term === null) continue;
    if (term === "OR") {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1]!.push(term);
  }
  return groups.filter((g) => g.length > 0);
}

function matchesTerm(post: MatchablePost, term: Term): boolean {
  switch (term.kind) {
    case "ignored":
      return true;
    case "text": {
      const hit = post.text.toLowerCase().includes(term.value);
      return term.negated ? !hit : hit;
    }
    case "from": {
      const hit = (post.authorUsername ?? "").toLowerCase() === term.value;
      return term.negated ? !hit : hit;
    }
    case "lang": {
      const hit = (post.lang ?? "").toLowerCase() === term.value;
      return term.negated ? !hit : hit;
    }
  }
}

export function matchesQuery(post: MatchablePost, query: string): boolean {
  const groups = parseQuery(query);
  if (groups.length === 0) return false;
  return groups.some((group) => group.every((term) => matchesTerm(post, term)));
}
