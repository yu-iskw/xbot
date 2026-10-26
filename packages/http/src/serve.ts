import { serve } from "@hono/node-server";
import {
  createXbotRuntime,
  mergeConfig,
  resolveConfig,
  type XbotConfig,
  type XbotRuntime,
} from "@yu-iskw/xbot-core";
import { createXbotHttpApp } from "./app";
import { parseTokens } from "./auth";

export interface ServeOptions {
  port?: number;
  hostname?: string;
  config?: XbotConfig;
  /** Start Mastra's scheduler for topic schedules (a long-running server is the right place for it). */
  enableSchedules?: boolean;
  mastraApi?: boolean;
  insecureNoAuth?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function startXbotHttpServer(options: ServeOptions = {}) {
  const env = options.env ?? process.env;
  const config = await resolveConfig({
    env,
    overrides: mergeConfig(options.config, {
      enableSchedules: options.enableSchedules ?? env.XBOT_ENABLE_SCHEDULES === "true",
    }),
  });
  const runtime: XbotRuntime = await createXbotRuntime(config);
  const app = await createXbotHttpApp({
    runtime,
    tokens: parseTokens(env, runtime.info.tenantId),
    insecureNoAuth: options.insecureNoAuth ?? env.XBOT_HTTP_INSECURE_NO_AUTH === "true",
    mastraApi: options.mastraApi ?? env.XBOT_HTTP_MASTRA_API === "true",
  });
  const port = options.port ?? Number(env.PORT ?? 4111);
  const hostname = options.hostname ?? env.HOST ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname });
  return {
    runtime,
    app,
    url: `http://${hostname}:${port}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}
