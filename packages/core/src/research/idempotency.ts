import { createHash, randomUUID } from "node:crypto";

/**
 * Derive a stable idempotency key from tenant, workflow, normalized inputs, and the triggering event.
 * Returns undefined when there is no triggering event: ad-hoc interactive requests should run fresh.
 */
export function deriveIdempotencyKey(parts: {
  tenantId: string;
  workflow: string;
  input: Record<string, unknown>;
  triggerEventId?: string;
  explicitKey?: string;
}): string | undefined {
  if (parts.explicitKey) return `explicit:${parts.tenantId}:${parts.explicitKey}`;
  if (!parts.triggerEventId) return undefined;
  const digest = createHash("sha256")
    .update(
      stableStringify({ t: parts.tenantId, w: parts.workflow, i: parts.input, e: parts.triggerEventId }),
    )
    .digest("hex")
    .slice(0, 32);
  return `${parts.workflow}:${digest}`;
}

/**
 * The event that identifies a run occurrence. Scheduled fires carry no event id, so the fire minute
 * stands in for it; workflow and input are part of the key digest, so no other prefix is needed.
 */
export function occurrenceId(
  trigger: string,
  triggerEventId: string | undefined,
  now: Date,
): string | undefined {
  return (
    triggerEventId ?? (trigger === "schedule" ? `schedule:${now.toISOString().slice(0, 16)}` : undefined)
  );
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
