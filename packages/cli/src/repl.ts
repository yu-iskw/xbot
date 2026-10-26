import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { errorMessage, type XbotRuntime } from "@yu-iskw/xbot-core";
import { formatReport } from "./output";

export interface ReplOptions {
  runtime: XbotRuntime;
  input?: Readable;
  output?: Writable;
  /** Resume a previous conversation thread. */
  threadId?: string;
  /** Mastra memory resource (the user). */
  resourceId?: string;
  historyFile?: string;
  showTools?: boolean;
  /** Force non-interactive behavior (tests, piped input). */
  terminal?: boolean;
}

const HELP = `Commands:
  /help                 Show this help
  /research <query>     Run the research workflow and print the cited report
  /history [query]      List saved reports
  /report <id>          Show a saved report
  /thread               Show the current thread id (resume with: xbot chat --thread <id>)
  /new                  Start a new conversation thread
  /tools on|off         Show or hide tool calls
  /budget               Show remaining X budget
  /exit                 Quit
Anything else is sent to the research agent. Ctrl-C cancels a running answer; press it again to quit.`;

/** Interactive research REPL. Runs the agent in-process; no server is involved. */
export async function runRepl(options: ReplOptions): Promise<void> {
  const { runtime } = options;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const write = (s: string) => output.write(s);
  let threadId = options.threadId ?? `cli-${randomUUID()}`;
  const resourceId = options.resourceId ?? `cli:${runtime.info.tenantId}`;
  let showTools = options.showTools ?? true;
  let current: AbortController | undefined;

  const history =
    options.historyFile && existsSync(options.historyFile)
      ? readFileSync(options.historyFile, "utf8").split("\n").filter(Boolean).reverse().slice(0, 500)
      : [];
  const rl = createInterface({
    input,
    output,
    terminal: options.terminal ?? Boolean((input as { isTTY?: boolean }).isTTY),
    history,
    historySize: 500,
    prompt: "xbot> ",
  });

  rl.on("SIGINT", () => {
    if (current) {
      current.abort();
      write("\n[cancelled]\n");
    } else {
      rl.close();
    }
  });

  write(
    `xbot research REPL · X: ${runtime.info.xMode} · chat model: ${runtime.info.models.chat ?? "none"} · thread ${threadId}\n` +
      (runtime.agent
        ? "Type /help for commands.\n"
        : "No chat model configured (set XBOT_MODEL). Slash commands like /research still work.\n"),
  );

  const handle = async (line: string) => {
    const text = line.trim();
    if (!text) return;
    if (options.historyFile) {
      try {
        appendFileSync(options.historyFile, `${text}\n`);
      } catch {
        // History is a convenience; never fail the REPL over it.
      }
    }
    if (text.startsWith("/")) {
      await command(text);
      return;
    }
    if (!runtime.agent) {
      write("No chat model configured. Set XBOT_MODEL (e.g. provider/model-id) or use /research <query>.\n");
      return;
    }
    current = new AbortController();
    try {
      const stream = await runtime.agent.stream(text, {
        memory: { thread: threadId, resource: resourceId },
        abortSignal: current.signal,
      });
      for await (const chunk of stream.fullStream as AsyncIterable<{
        type: string;
        payload?: Record<string, unknown>;
      }>) {
        if (chunk.type === "text-delta") write(String(chunk.payload?.text ?? ""));
        else if (showTools && chunk.type === "tool-call") {
          write(
            `\n  ↳ ${String(chunk.payload?.toolName)} ${truncate(JSON.stringify(chunk.payload?.args ?? {}), 160)}\n`,
          );
        } else if (showTools && chunk.type === "tool-result") {
          write(`  ↲ ${String(chunk.payload?.toolName)}${chunk.payload?.isError ? " (error)" : ""}\n`);
        } else if (chunk.type === "error") {
          write(`\n[error] ${errorMessage(chunk.payload?.error)}\n`);
        }
      }
      write("\n");
    } catch (error) {
      if (!current.signal.aborted) write(`\n[error] ${errorMessage(error)}\n`);
    } finally {
      current = undefined;
    }
  };

  const command = async (text: string) => {
    const [cmd = "", ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    try {
      switch (cmd) {
        case "help":
          write(`${HELP}\n`);
          break;
        case "exit":
        case "quit":
          rl.close();
          break;
        case "thread":
          write(`${threadId}\n`);
          break;
        case "new":
          threadId = `cli-${randomUUID()}`;
          write(`New thread ${threadId}\n`);
          break;
        case "tools":
          showTools = arg !== "off";
          write(`Tool calls ${showTools ? "shown" : "hidden"}\n`);
          break;
        case "budget": {
          const b = await runtime.budgetStatus();
          write(
            `Remaining today: $${b.dailyUsd.toFixed(3)} · this month: $${b.monthlyUsd.toFixed(3)} (mode ${runtime.info.xMode})\n`,
          );
          break;
        }
        case "research": {
          if (!arg) throw new Error("Usage: /research <query>");
          write(`Researching "${arg}"...\n`);
          const { report } = await runtime.research({ query: arg, trigger: "cli" });
          write(await formatReport(runtime, report, "markdown"));
          break;
        }
        case "history": {
          const rows = await runtime.searchHistory(arg, { limit: 20 });
          if (rows.length === 0) write("No saved reports.\n");
          for (const r of rows) write(`${r.id}  ${r.generatedAt}  ${r.status.padEnd(9)} ${r.query}\n`);
          break;
        }
        case "report": {
          if (!arg) throw new Error("Usage: /report <id>");
          const report = await runtime.getReport(arg);
          write(report ? await formatReport(runtime, report, "markdown") : `Report ${arg} not found\n`);
          break;
        }
        default:
          write(`Unknown command /${cmd}. Type /help.\n`);
      }
    } catch (error) {
      write(`[error] ${errorMessage(error)}\n`);
    }
  };

  // Serialize input: each line is handled after the previous one finishes.
  let queue = Promise.resolve();
  rl.on("line", (line) => {
    queue = queue
      .then(() => handle(line))
      .then(() => {
        if (!closed) rl.prompt();
      });
  });
  let closed = false;
  rl.prompt();
  await new Promise<void>((resolveClose) => {
    rl.on("close", () => {
      closed = true;
      queue.then(() => resolveClose());
    });
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
