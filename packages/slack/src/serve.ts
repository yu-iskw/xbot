import { serve } from "@hono/node-server";
import { type HonoBindings, type HonoVariables, MastraServer } from "@mastra/hono";
import { RESEARCH_AGENT_ID, resolveConfig, type XbotConfig } from "@yu-iskw/xbot-core";
import { Hono } from "hono";
import {
  createXbotSlackRuntime,
  type SlackAccessPolicy,
  slackWebhookPath,
  type XbotSlackOptions,
} from "./slack";

export interface SlackServerOptions {
  port?: number;
  hostname?: string;
  config?: XbotConfig;
  access?: SlackAccessPolicy;
  /** Slack adapter config; defaults to SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET from `env`. */
  slack?: XbotSlackOptions["slack"];
  env?: NodeJS.ProcessEnv;
}

/**
 * Serve only the Slack webhook. Mastra registers its full route set, so every other /api route is
 * rejected here: this process is reachable from the internet and must not expose agents or workflows.
 */
export async function startXbotSlackServer(options: SlackServerOptions = {}) {
  const env = options.env ?? process.env;
  const allowed = env.XBOT_SLACK_ALLOWED_USERS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const quota = env.XBOT_SLACK_DAILY_MESSAGES ? Number(env.XBOT_SLACK_DAILY_MESSAGES) : undefined;
  const runtime = await createXbotSlackRuntime({
    config: await resolveConfig({ env, ...(options.config ? { overrides: options.config } : {}) }),
    slack: options.slack ?? {
      ...(env.SLACK_BOT_TOKEN ? { botToken: env.SLACK_BOT_TOKEN } : {}),
      ...(env.SLACK_SIGNING_SECRET ? { signingSecret: env.SLACK_SIGNING_SECRET } : {}),
    },
    access: options.access ?? {
      ...(allowed?.length ? { allowedUserIds: allowed } : {}),
      ...(quota ? { maxMessagesPerUserPerDay: quota } : {}),
    },
  });

  const webhook = slackWebhookPath(RESEARCH_AGENT_ID);
  const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.use("*", async (c, next) => {
    if (c.req.path === webhook || c.req.path === "/healthz") return next();
    return c.json({ error: "not_found" }, 404);
  });
  const mastraServer = new MastraServer({ app, mastra: runtime.mastra });
  await mastraServer.init();

  const port = options.port ?? Number(env.PORT ?? 4113);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const server = serve({ fetch: app.fetch, port, hostname });
  return {
    runtime,
    app,
    webhookUrl: `http://${hostname}:${port}${webhook}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}
