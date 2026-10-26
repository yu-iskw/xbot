import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createXbotRuntime, resolveConfig, type XbotConfig, type XbotRuntime } from "@yu-iskw/xbot-core";

export interface GlobalOptions {
  config?: string;
  db?: string;
  mock?: boolean;
  live?: boolean;
  tenant?: string;
}

export function xbotHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.XBOT_HOME ?? join(homedir(), ".xbot");
}

/** Precedence: built-in defaults < config file < environment < command-line flags. */
export async function buildConfig(
  opts: GlobalOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<XbotConfig> {
  const filePath = opts.config ?? (existsSync("xbot.config.json") ? "xbot.config.json" : undefined);
  const home = xbotHome(env);
  const defaults: XbotConfig = { storage: { url: `file:${join(home, "xbot.db")}` } };

  const flags: XbotConfig = {};
  if (opts.mock && opts.live) throw new Error("--mock and --live are mutually exclusive");
  if (opts.mock) flags.x = { mode: "mock" };
  if (opts.live) flags.x = { mode: "live" };
  if (opts.db) flags.storage = { url: opts.db.includes(":") ? opts.db : `file:${resolve(opts.db)}` };
  if (opts.tenant) flags.tenantId = opts.tenant;

  const config = await resolveConfig({
    env,
    defaults,
    overrides: flags,
    ...(filePath ? { configPath: resolve(filePath) } : {}),
  });
  const url = config.storage?.url ?? "";
  if (url.startsWith(`file:${home}`)) mkdirSync(home, { recursive: true });
  return config;
}

export async function openRuntime(opts: GlobalOptions): Promise<XbotRuntime> {
  return createXbotRuntime(await buildConfig(opts));
}
