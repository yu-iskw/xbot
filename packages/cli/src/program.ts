import { join } from "node:path";
import { errorMessage, XApiError, type XbotRuntime } from "@yu-iskw/xbot-core";
import { Argument, Command, InvalidArgumentError, Option } from "commander";
import { type GlobalOptions, openRuntime, xbotHome } from "./config";
import { emit, formatReport, note, parseFormat } from "./output";
import { runRepl } from "./repl";

export const VERSION = "0.1.0";

function int(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

function float(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

async function withRuntime<T>(cmd: Command, fn: (runtime: XbotRuntime) => Promise<T>): Promise<T> {
  const runtime = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
  if (runtime.info.xMode === "mock")
    note("[xbot] X mode: mock (deterministic fixtures). Set X_BEARER_TOKEN for live data.");
  try {
    return await fn(runtime);
  } finally {
    await runtime.close();
  }
}

export function createProgram(): Command {
  const program = new Command()
    .name("xbot")
    .description("Read-only X research agent built on Mastra")
    .version(VERSION)
    .option("-c, --config <path>", "config file (default: ./xbot.config.json if present)")
    .option("--db <url-or-path>", "libSQL database URL or file path (default: ~/.xbot/xbot.db)")
    .option("--mock", "use deterministic mock X data")
    .option("--live", "require live X API access")
    .option("--tenant <id>", "tenant for persisted reports")
    .showHelpAfterError();

  program
    .command("research")
    .description("Run the research workflow and print a cited report")
    .argument("<query...>", "research question or topic")
    .option("-n, --max-posts <n>", "maximum posts to collect", int, 50)
    .option("-w, --window-days <n>", "research window in days (1-7)", int, 7)
    .option("--max-cost <usd>", "X spending cap for this run", float)
    .option("--lang <code>", "restrict to a language (e.g. en, ja)")
    .option("-f, --format <format>", "markdown or json", "markdown")
    .option("-o, --out <file>", "write the report to a file")
    .action(async (queryParts: string[], opts, cmd: Command) => {
      const format = parseFormat(opts.format);
      await withRuntime(cmd, async (runtime) => {
        const { report, deduplicated } = await runtime.research({
          query: queryParts.join(" "),
          maxPosts: opts.maxPosts,
          windowDays: opts.windowDays,
          trigger: "cli",
          ...(opts.maxCost !== undefined ? { maxCostUsd: opts.maxCost } : {}),
          ...(opts.lang ? { language: opts.lang } : {}),
        });
        if (deduplicated) note(`[xbot] Returned existing report ${report.id}`);
        await emit(await formatReport(runtime, report, format), opts.out);
      });
    });

  program
    .command("chat")
    .description("Interactive research REPL with persistent conversation threads")
    .option("-t, --thread <id>", "resume a conversation thread")
    .option("--no-tools", "hide tool calls")
    .action(async (opts, cmd: Command) => {
      await withRuntime(cmd, (runtime) =>
        runRepl({
          runtime,
          ...(opts.thread ? { threadId: opts.thread } : {}),
          showTools: opts.tools,
          historyFile: join(xbotHome(), "repl_history"),
        }),
      );
    });

  const history = program.command("history").description("Inspect saved research");
  history
    .command("list")
    .description("List saved reports")
    .option("-s, --search <text>", "filter by query or summary text")
    .option("-l, --limit <n>", "maximum rows", int, 20)
    .option("--json", "print JSON")
    .action(async (opts, cmd: Command) => {
      await withRuntime(cmd, async (runtime) => {
        const rows = await runtime.searchHistory(opts.search ?? "", { limit: opts.limit });
        if (opts.json) return emit(`${JSON.stringify(rows, null, 2)}\n`);
        if (rows.length === 0) return emit("No saved reports.\n");
        await emit(
          `${rows.map((r) => `${r.id}  ${r.generatedAt}  ${r.status.padEnd(9)} ${r.sources} src  ${r.query}`).join("\n")}\n`,
        );
      });
    });
  history
    .command("show")
    .description("Show a saved report")
    .argument("<reportId>")
    .option("-f, --format <format>", "markdown or json", "markdown")
    .option("-o, --out <file>", "write the report to a file")
    .action(async (reportId: string, opts, cmd: Command) => {
      const format = parseFormat(opts.format);
      await withRuntime(cmd, async (runtime) => {
        const report = await runtime.getReport(reportId);
        if (!report) throw new Error(`Report ${reportId} not found`);
        await emit(await formatReport(runtime, report, format), opts.out);
      });
    });
  history
    .command("runs")
    .description("List recent workflow runs")
    .option("-l, --limit <n>", "maximum rows", int, 20)
    .action(async (opts, cmd: Command) => {
      await withRuntime(cmd, async (runtime) => {
        const runs = await runtime.store.listRuns(runtime.info.tenantId, opts.limit);
        await emit(
          runs
            .map(
              (r) =>
                `${r.id}  ${r.startedAt}  ${r.workflow.padEnd(9)} ${r.status.padEnd(9)} ${r.reportId ?? ""}${r.error ? `  ${r.error}` : ""}`,
            )
            .join("\n") + (runs.length ? "\n" : "No runs.\n"),
        );
      });
    });

  const workflow = program.command("workflow").description("Run Mastra workflows directly");
  workflow
    .command("run")
    .description("Run a workflow: research or discover")
    .addArgument(new Argument("<name>", "workflow name").choices(["research", "discover"]))
    .option("--topic <text>", "research topic (research)")
    .option("--topic-id <id>", "topic id to associate with the report (research)")
    .option("--interest <text...>", "interests to scan (discover)")
    .option("--account <username...>", "accounts to scan (discover)")
    .option("--max-topics <n>", "topics to return (discover)", int, 5)
    .option("--event-id <id>", "triggering event id; repeats with the same id are idempotent")
    .option("-f, --format <format>", "markdown or json", "markdown")
    .action(async (name: string, opts, cmd: Command) => {
      const format = parseFormat(opts.format);
      await withRuntime(cmd, async (runtime) => {
        if (name === "research") {
          if (!opts.topic) throw new Error("--topic is required for the research workflow");
          const { report } = await runtime.research({
            query: opts.topic,
            trigger: "cli",
            ...(opts.topicId ? { topicId: opts.topicId } : {}),
            ...(opts.eventId ? { triggerEventId: opts.eventId } : {}),
          });
          await emit(await formatReport(runtime, report, format));
          return;
        }
        if (!opts.interest?.length) throw new Error("--interest is required for the discover workflow");
        const result = await runtime.discover({
          interests: opts.interest,
          accounts: opts.account ?? [],
          maxTopics: opts.maxTopics,
          trigger: "cli",
          ...(opts.eventId ? { triggerEventId: opts.eventId } : {}),
        });
        if (format === "json") return emit(`${JSON.stringify(result, null, 2)}\n`);
        const lines = [`# Discovery (${result.postsScanned} posts scanned)`, ""];
        for (const [i, t] of result.topics.entries()) {
          lines.push(`${i + 1}. **${t.label}** — score ${t.score}. ${t.rationale}`);
        }
        lines.push("", ...result.limitations.map((l) => `- ${l}`), "");
        await emit(lines.join("\n"));
      });
    });

  program
    .command("monitor")
    .description("Research a configured topic and show what changed since its previous report")
    .argument("[topicId]", "topic id from the config file (omit to list topics)")
    .option("-w, --window-days <n>", "research window in days (1-7)", int, 1)
    .option("--json", "print JSON")
    .action(async (topicId: string | undefined, opts, cmd: Command) => {
      await withRuntime(cmd, async (runtime) => {
        if (!topicId) {
          if (runtime.topics.length === 0)
            return emit("No topics configured (add them to xbot.config.json).\n");
          return emit(`${runtime.topics.map((t) => `${t.id}  ${t.description}`).join("\n")}\n`);
        }
        const result = await runtime.monitor({ topicId, windowDays: opts.windowDays, trigger: "cli" });
        if (opts.json) return emit(`${JSON.stringify(result, null, 2)}\n`);
        const list = (title: string, items: string[]) =>
          items.length ? [`## ${title}`, "", ...items.map((i) => `- ${i}`), ""] : [];
        await emit(
          [
            `# Monitor: ${topicId}`,
            "",
            result.summary,
            "",
            ...list("New findings", result.newFindings),
            ...list("No longer observed", result.noLongerObserved),
            ...list("Newly cited posts", result.newSources),
            `Report: \`${result.reportId}\`${result.previousReportId ? ` (previous: \`${result.previousReportId}\`)` : ""}`,
            "",
          ].join("\n"),
        );
      });
    });

  program
    .command("doctor")
    .description("Check configuration, storage, models, and X access mode")
    .action(async (_opts, cmd: Command) => {
      await withRuntime(cmd, async (runtime) => {
        const budget = await runtime.budgetStatus();
        const info = runtime.info;
        const lines = [
          "xbot doctor",
          `  X mode:        ${info.xMode}${info.xMode === "mock" ? " (no credentials required)" : " (app-only bearer token)"}`,
          "  X access:      read-only (search, post lookup, user lookup, user timelines)",
          `  Storage:       ${info.storageUrl}`,
          `  Tenant:        ${info.tenantId}`,
          `  Models:        ${
            Object.keys(info.models).length
              ? Object.entries(info.models)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")
              : "none — workflows run deterministically"
          }`,
          `  Chat:          ${info.chatAvailable ? "available" : "unavailable (set XBOT_MODEL)"}`,
          `  Budgets:       run $${budget.limits.perRunUsd} · request $${budget.limits.perRequestUsd} · day $${budget.limits.dailyUsd} · month $${budget.limits.monthlyUsd}`,
          `  Remaining:     today $${budget.dailyUsd.toFixed(3)} · month $${budget.monthlyUsd.toFixed(3)}`,
        ];
        await emit(`${lines.join("\n")}\n`);
      });
    });

  program
    .command("purge-post")
    .description("Compliance: drop cached content for a deleted/protected post and flag reports citing it")
    .argument("<postId>")
    .action(async (postId: string, _opts, cmd: Command) => {
      await withRuntime(cmd, async (runtime) => {
        const res = await runtime.purgePost(postId);
        await emit(
          `Removed ${res.cacheRows} cached row(s); ${res.citingReports.length} report(s) flagged: ${res.citingReports.join(", ") || "none"}\n`,
        );
      });
    });

  program.addOption(new Option("--debug", "print stack traces").hideHelp());
  return program;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    const debug = argv.includes("--debug");
    const message = `${error instanceof XApiError ? "X API: " : ""}${errorMessage(error)}`;
    process.stderr.write(`xbot: ${message}\n`);
    if (debug && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    return 1;
  }
}
