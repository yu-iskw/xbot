import type { Analysis, Finding } from "../schemas/research";
import type { XPost } from "../schemas/x";

export interface ValidationResult {
  findings: Finding[];
  /** Cited IDs that were not in the collected evidence. */
  removedCitations: string[];
  droppedFindings: number;
}

/**
 * Deterministic evidence validator.
 * - A finding may only cite posts present in the collected evidence; anything else is removed.
 * - Observations and syntheses with no remaining evidence are dropped.
 * - Interpretations may stand without citations but are capped at low confidence.
 */
export function validateFindings(analysis: Analysis, posts: XPost[]): ValidationResult {
  const known = new Set(posts.map((p) => p.id));
  const removed = new Set<string>();
  const findings: Finding[] = [];
  let dropped = 0;

  for (const finding of analysis.findings) {
    const evidence = [...new Set(finding.evidence)].filter((id) => {
      if (known.has(id)) return true;
      removed.add(id);
      return false;
    });
    if (evidence.length === 0 && finding.kind !== "interpretation") {
      dropped += 1;
      continue;
    }
    findings.push({
      ...finding,
      evidence,
      confidence: finding.kind === "interpretation" && evidence.length === 0 ? "low" : finding.confidence,
    });
  }

  return { findings, removedCitations: [...removed], droppedFindings: dropped };
}

/** Remove post IDs that are not part of the evidence from free text (summaries, opposing views). */
export function scrubUnknownIds(text: string, posts: XPost[]): string {
  const known = new Set(posts.map((p) => p.id));
  return text.replace(/\b\d{15,20}\b/g, (id) => (known.has(id) ? id : "[unverified source]"));
}
