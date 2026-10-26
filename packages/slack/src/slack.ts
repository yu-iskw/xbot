import { createSlackAdapter } from "@chat-adapter/slack";
import type { ChannelHandler } from "@mastra/core/channels";
import {
  createXbotRuntime,
  XBOT_TRIGGER_CONTEXT_KEY,
  type XbotConfig,
  type XbotRuntime,
} from "@yu-iskw/xbot-core";

type SlackAdapterConfig = NonNullable<Parameters<typeof createSlackAdapter>[0]>;

/** The fields of a channel message the access policy needs. */
interface ChannelMessage {
  author: { userId: string; isBot?: boolean | "unknown"; isMe?: boolean };
}

/**
 * Slack identity and authorization are separate from X authentication: being able to message the bot
 * does not grant unlimited X spend. The X budget itself is still enforced by the core runtime.
 */
export interface SlackAccessPolicy {
  /** Slack user IDs allowed to use the bot. Empty or undefined allows everyone in the workspace. */
  allowedUserIds?: string[];
  /** Messages per Slack user per UTC day. Default 30. */
  maxMessagesPerUserPerDay?: number;
  now?: () => Date;
}

export interface SlackAccessDecision {
  allowed: boolean;
  reason?: "not_allowed" | "quota_exceeded" | "bot";
}

export function createSlackAccessControl(policy: SlackAccessPolicy = {}) {
  const allowed = new Set(policy.allowedUserIds ?? []);
  const limit = policy.maxMessagesPerUserPerDay ?? 30;
  const now = policy.now ?? (() => new Date());
  // Counts for the current UTC day only; the map is reset when the day changes.
  let currentDay = "";
  const counts = new Map<string, number>();
  return {
    check(message: ChannelMessage): SlackAccessDecision {
      if (message.author.isMe || message.author.isBot === true) return { allowed: false, reason: "bot" };
      const user = message.author.userId;
      if (allowed.size > 0 && !allowed.has(user)) return { allowed: false, reason: "not_allowed" };
      const day = now().toISOString().slice(0, 10);
      if (day !== currentDay) {
        currentDay = day;
        counts.clear();
      }
      const count = counts.get(user) ?? 0;
      if (count >= limit) return { allowed: false, reason: "quota_exceeded" };
      counts.set(user, count + 1);
      return { allowed: true };
    },
  };
}

export interface XbotSlackOptions {
  /** Core runtime configuration (X mode, models, storage...). A chat model is required. */
  config: XbotConfig;
  /** Passed to createSlackAdapter; defaults read SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET from the environment. */
  slack?: SlackAdapterConfig;
  access?: SlackAccessPolicy;
}

/**
 * Build an xbot runtime whose research agent also answers in Slack through Mastra Channels.
 * The agent, tools, workflows, and storage are exactly the ones the CLI uses; only the channel is added.
 */
export async function createXbotSlackRuntime(options: XbotSlackOptions): Promise<XbotRuntime> {
  const access = createSlackAccessControl(options.access);
  const guard: ChannelHandler = async (thread, message, defaultHandler, ctx) => {
    const decision = access.check(message);
    if (!decision.allowed) {
      if (decision.reason === "not_allowed") await thread.post("Sorry, you are not authorized to use xbot.");
      if (decision.reason === "quota_exceeded") {
        await thread.post("You have reached today's xbot message limit. Please try again tomorrow.");
      }
      return;
    }
    ctx.requestContext.set("xbot.slackUserId", message.author.userId);
    ctx.requestContext.set(XBOT_TRIGGER_CONTEXT_KEY, "slack");
    await defaultHandler(thread, message);
  };

  const runtime = await createXbotRuntime({
    // Slack research lives in its own tenant unless configured otherwise.
    tenantId: "slack",
    ...options.config,
    agentChannels: {
      adapters: {
        slack: {
          adapter: createSlackAdapter(options.slack),
          streaming: true,
          toolDisplay: "grouped",
          formatError: () => ({ markdown: "Something went wrong while researching. Please try again." }),
        },
      },
      handlers: { onMention: guard, onDirectMessage: guard, onSubscribedMessage: guard },
      threadContext: { maxMessages: 10 },
    },
  });
  if (!runtime.agent) {
    await runtime.close();
    throw new Error("The Slack integration needs a chat model. Set XBOT_MODEL (or models.chat).");
  }
  return runtime;
}

/** Path Mastra serves the Slack webhook on for the research agent. */
export function slackWebhookPath(agentId: string): string {
  return `/api/agents/${agentId}/channels/slack/webhook`;
}
