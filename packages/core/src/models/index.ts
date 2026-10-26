import type { MastraModelConfig } from "@mastra/core/llm";

export const MODEL_ROLES = ["chat", "planning", "analysis", "reporting"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/**
 * Models per task, in Mastra's provider/model routing format (e.g. "provider/model-id") or as
 * model instances. `default` fills any role that is not set. With no models at all, research
 * workflows run their deterministic implementations and chat is unavailable.
 */
export type ModelsConfig = Partial<Record<ModelRole | "default", MastraModelConfig>>;

export function resolveModel(
  models: ModelsConfig | undefined,
  role: ModelRole,
): MastraModelConfig | undefined {
  return models?.[role] ?? models?.default;
}

/** Human-readable identifier for reports and diagnostics. */
export function describeModel(model: MastraModelConfig | undefined): string | undefined {
  if (model === undefined) return undefined;
  if (typeof model === "string") return model;
  const m = model as { provider?: string; modelId?: string; id?: string };
  if (m.modelId) return m.provider ? `${m.provider}/${m.modelId}` : m.modelId;
  return m.id ?? "custom-model";
}
