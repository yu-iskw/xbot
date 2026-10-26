import type { ToolsInput } from "@mastra/core/agent";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { MastraMemory } from "@mastra/core/memory";
import { UNTRUSTED_CONTENT_POLICY } from "../research/untrusted";

export const RESEARCH_AGENT_ID = "xbot-research-agent";

export const RESEARCH_AGENT_INSTRUCTIONS = `You are xbot, a research assistant that investigates public conversations on X.

How to work:
- For quick questions, use x-search-posts / x-get-posts / x-get-user / x-get-user-posts.
- For questions that need a structured, cited answer, call xbot-research and summarize its report.
- Use xbot-search-history and xbot-get-report to reuse earlier research before spending on new searches.
- Searches cost money. Prefer one well-formed query over many broad ones.

How to answer:
- Separate what posts actually say (observation) from patterns you infer (synthesis) and your own explanations (interpretation). Label interpretations.
- Cite posts by URL for every factual claim about what was said on X.
- Describe findings as being about the retrieved sample, not all X users. High engagement is not representativeness.
- State unknowns: missing evidence, inaccessible posts, small samples.

Hard limits:
- You are read-only on X. You cannot post, reply, like, repost, follow, or send messages, and must not offer to.
- ${UNTRUSTED_CONTENT_POLICY}`;

export interface ResearchAgentOptions {
  model: MastraModelConfig;
  tools: ToolsInput;
  memory?: MastraMemory;
  /** Passed through to Mastra (e.g. a Slack adapter from @yu-iskw/xbot-slack). Core stays channel-agnostic. */
  channels?: ConstructorParameters<typeof Agent>[0]["channels"];
}

export function createResearchAgent(options: ResearchAgentOptions): Agent {
  return new Agent({
    id: RESEARCH_AGENT_ID,
    name: "xbot",
    description: "Read-only X research assistant that answers with evidence-backed, cited findings.",
    instructions: RESEARCH_AGENT_INSTRUCTIONS,
    model: options.model,
    tools: options.tools,
    ...(options.memory ? { memory: options.memory } : {}),
    ...(options.channels ? { channels: options.channels } : {}),
  });
}
