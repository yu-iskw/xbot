import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { createXbotRuntime } from "@yu-iskw/xbot-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, runRepl } from "../src/index";

let home: string;
let out: string[];
let err: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "xbot-cli-"));
  vi.stubEnv("XBOT_HOME", home);
  vi.stubEnv("X_BEARER_TOKEN", "");
  vi.stubEnv("XBOT_MODEL", "");
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const run = (...args: string[]) => main(["node", "xbot", ...args]);

describe("xbot CLI", () => {
  it("runs the milestone research command against mock X without credentials", async () => {
    expect(await run("research", "What are developers discussing about Mastra?", "--mock")).toBe(0);
    const md = out.join("");
    expect(md).toContain("# Research: What are developers discussing about Mastra?");
    expect(md).toMatch(/## Sources\n\n1\. @fixture_/);
    expect(err.join("")).toContain("X mode: mock");
  });

  it("saves reports locally and lists/shows them from history", async () => {
    const file = join(home, "report.json");
    expect(await run("research", "Mastra", "--format", "json", "--out", file)).toBe(0);
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report.sources.length).toBeGreaterThan(0);
    out = [];
    expect(await run("history", "list")).toBe(0);
    expect(out.join("")).toContain(report.id);
    out = [];
    expect(await run("history", "show", report.id, "--format", "json")).toBe(0);
    expect(JSON.parse(out.join("")).id).toBe(report.id);
  });

  it("runs workflows directly", async () => {
    expect(await run("workflow", "run", "discover", "--interest", "AI agents", "--format", "json")).toBe(0);
    expect(JSON.parse(out.join("")).topics.length).toBeGreaterThan(0);
  });

  it("monitors configured topics from a config file", async () => {
    const config = join(home, "xbot.config.json");
    writeFileSync(
      config,
      JSON.stringify({ topics: [{ id: "mastra", description: "Mastra", keywords: ["#Mastra"] }] }),
    );
    expect(await run("--config", config, "monitor")).toBe(0);
    expect(out.join("")).toContain("mastra  Mastra");
    out = [];
    expect(await run("--config", config, "monitor", "mastra")).toBe(0);
    expect(out.join("")).toContain("First report for this topic");
    out = [];
    expect(await run("--config", config, "monitor", "mastra", "--json")).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ topicId: "mastra", newSources: [] });
  });

  it("reports configuration with doctor", async () => {
    expect(await run("doctor")).toBe(0);
    expect(out.join("")).toMatch(/X mode:\s+mock/);
    expect(out.join("")).toMatch(/read-only/);
  });

  it("fails cleanly on bad input", async () => {
    expect(await run("history", "show", "rpt_missing")).toBe(1);
    expect(err.join("")).toContain("not found");
    expect(await run("research", "x", "--live")).toBe(1);
    expect(err.join("")).toMatch(/bearer token/);
  });
});

describe("REPL", () => {
  async function drive(lines: string[], models?: Record<string, unknown>) {
    vi.restoreAllMocks();
    const runtime = await createXbotRuntime({
      storage: { url: ":memory:" },
      x: { mode: "mock" },
      ...(models ? { models } : {}),
    });
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (d) => (text += String(d)));
    const done = runRepl({ runtime, input, output, terminal: false });
    for (const l of lines) input.write(`${l}\n`);
    input.end();
    await done;
    await runtime.close();
    return text;
  }

  it("supports slash commands without a chat model", async () => {
    const text = await drive(["/help", "/research Mastra", "/history", "hello"]);
    expect(text).toContain("/research <query>");
    expect(text).toContain("# Research: Mastra");
    expect(text).toMatch(/rpt_\w+/);
    expect(text).toContain("No chat model configured");
  });

  it("streams the agent's answer when a chat model is configured", async () => {
    const chat = createMockModel({ version: "v2", mockText: "Developers mostly praise typed workflows." });
    const text = await drive(["What do people think of Mastra?"], { chat });
    expect(text).toContain("Developers mostly praise typed workflows.");
  });
});
