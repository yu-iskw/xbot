import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ResearchAgentOptions } from "./agents/research-agent";
import { MODEL_ROLES, type ModelsConfig } from "./models";
import { type ResearchTopic, ResearchTopicSchema } from "./schemas/research";
import type { BudgetLimits, XPricing } from "./x/budget";
import type { XClientMode, XReadClient } from "./x/port";

export interface XbotConfig {
  x?: {
    /** Defaults to "live" when a bearer token is present, otherwise "mock". */
    mode?: XClientMode;
    /** App-only OAuth 2.0 bearer token. There is deliberately no user-context or write credential option. */
    bearerToken?: string;
    baseUrl?: string;
    /** How long retrieved post content may be cached. 0 disables the cache. Default 24h. */
    cacheTtlSeconds?: number;
    pricing?: Partial<XPricing>;
    /** Inject a custom read client (tests, alternative transports). Still wrapped read-only and budgeted. */
    client?: XReadClient;
  };
  models?: ModelsConfig;
  storage?: {
    /** Defaults to "postgres" for postgres:// URLs, otherwise "libsql". */
    provider?: "libsql" | "postgres";
    /** libSQL URL ("file:./xbot.db", ":memory:", libsql://...) or a postgres:// connection string. */
    url?: string;
    authToken?: string;
  };
  budgets?: Partial<BudgetLimits>;
  /** Topics for monitoring; topics with a schedule become scheduled research runs when schedules are enabled. */
  topics?: ResearchTopic[];
  /** Default tenant for persisted runs and reports. */
  tenantId?: string;
  /** Start Mastra's scheduler for topic schedules. Only long-running server/worker processes should enable it. */
  enableSchedules?: boolean;
  /** Conversation memory for the chat agent. `false` disables it. */
  memory?: { lastMessages?: number } | false;
  /** Channel adapters for the chat agent (see @yu-iskw/xbot-slack). Opaque to core. */
  agentChannels?: ResearchAgentOptions["channels"];
  /** Mastra console logging. Off by default so CLI output stays clean. */
  logging?: boolean;
  now?: () => Date;
}

/** Shape accepted from JSON config files. Secrets belong in the environment, not in files. */
const FileConfigSchema = z
  .object({
    x: z
      .object({
        mode: z.enum(["live", "mock"]).optional(),
        baseUrl: z.string().url().optional(),
        cacheTtlSeconds: z.number().int().nonnegative().optional(),
        pricing: z.object({ postRead: z.number(), userRead: z.number() }).partial().optional(),
      })
      .strict()
      .optional(),
    models: z.record(z.enum([...MODEL_ROLES, "default"]), z.string()).optional(),
    storage: z
      .object({ provider: z.enum(["libsql", "postgres"]).optional(), url: z.string().optional() })
      .strict()
      .optional(),
    budgets: z
      .object({
        perRunUsd: z.number().positive(),
        perRequestUsd: z.number().positive(),
        dailyUsd: z.number().nonnegative(),
        monthlyUsd: z.number().nonnegative(),
      })
      .partial()
      .optional(),
    topics: z.array(ResearchTopicSchema).optional(),
    tenantId: z.string().optional(),
    memory: z.union([z.literal(false), z.object({ lastMessages: z.number().int().positive() })]).optional(),
  })
  .strict();

export async function loadConfigFile(path: string): Promise<XbotConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return FileConfigSchema.parse(raw) as XbotConfig;
}

type Env = Record<string, string | undefined>;

/** Read configuration from environment variables. */
export function loadConfigFromEnv(env: Env = process.env): XbotConfig {
  const num = (key: string) => {
    const v = env[key];
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    return n;
  };
  const models: ModelsConfig = {};
  if (env.XBOT_MODEL) models.default = env.XBOT_MODEL;
  for (const role of MODEL_ROLES) {
    const v = env[`XBOT_MODEL_${role.toUpperCase()}`];
    if (v) models[role] = v;
  }
  const mode = env.XBOT_X_MODE;
  if (mode && mode !== "live" && mode !== "mock") throw new Error("XBOT_X_MODE must be 'live' or 'mock'");
  const budgets: Partial<BudgetLimits> = {};
  const set = (k: keyof BudgetLimits, envKey: string) => {
    const v = num(envKey);
    if (v !== undefined) budgets[k] = v;
  };
  set("perRunUsd", "XBOT_BUDGET_RUN_USD");
  set("perRequestUsd", "XBOT_BUDGET_REQUEST_USD");
  set("dailyUsd", "XBOT_BUDGET_DAILY_USD");
  set("monthlyUsd", "XBOT_BUDGET_MONTHLY_USD");
  const bearerToken = env.XBOT_X_BEARER_TOKEN || env.X_BEARER_TOKEN;
  const cacheTtl = num("XBOT_X_CACHE_TTL_SECONDS");

  const config: XbotConfig = {};
  if (mode || bearerToken || cacheTtl !== undefined) {
    config.x = {
      ...(mode ? { mode: mode as XClientMode } : {}),
      ...(bearerToken ? { bearerToken } : {}),
      ...(cacheTtl !== undefined ? { cacheTtlSeconds: cacheTtl } : {}),
    };
  }
  if (Object.keys(models).length > 0) config.models = models;
  if (env.XBOT_DB_URL) {
    config.storage = {
      url: env.XBOT_DB_URL,
      ...(env.XBOT_DB_AUTH_TOKEN ? { authToken: env.XBOT_DB_AUTH_TOKEN } : {}),
    };
  }
  if (Object.keys(budgets).length > 0) config.budgets = budgets;
  if (env.XBOT_TENANT) config.tenantId = env.XBOT_TENANT;
  return config;
}

/** Shallow-merge configs per section; later configs win. */
export function mergeConfig(...configs: (XbotConfig | undefined)[]): XbotConfig {
  const out: XbotConfig = {};
  for (const c of configs) {
    if (!c) continue;
    const { x, models, storage, budgets, ...rest } = c;
    Object.assign(out, rest);
    if (x) out.x = { ...out.x, ...x };
    if (models) out.models = { ...out.models, ...models };
    if (storage) out.storage = { ...out.storage, ...storage };
    if (budgets) out.budgets = { ...out.budgets, ...budgets };
  }
  return out;
}

/**
 * Resolve configuration with one precedence rule for every entry point:
 * defaults < config file (`configPath`, else `XBOT_CONFIG`) < environment < overrides.
 */
export async function resolveConfig(
  options: { env?: Env; configPath?: string; defaults?: XbotConfig; overrides?: XbotConfig } = {},
): Promise<XbotConfig> {
  const env = options.env ?? process.env;
  const path = options.configPath ?? env.XBOT_CONFIG;
  const file = path ? await loadConfigFile(path) : undefined;
  return mergeConfig(options.defaults, file, loadConfigFromEnv(env), options.overrides);
}
