import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MCPClient } from "@mastra/mcp";
import { afterAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = new URL("../../", import.meta.url).pathname;
const cliBin = join(root, "packages/cli/dist/bin.js");
const mcpBin = join(root, "packages/mcp/dist/bin.js");
const built = existsSync(cliBin) && existsSync(mcpBin);
const home = mkdtempSync(join(tmpdir(), "xbot-e2e-"));
const env = { ...process.env, XBOT_HOME: home, X_BEARER_TOKEN: "", XBOT_X_BEARER_TOKEN: "", XBOT_MODEL: "" };

afterAll(() => rmSync(home, { recursive: true, force: true }));

// Run `pnpm build` first; these tests exercise the published entry points, not the sources.
describe.skipIf(!built)("built binaries", () => {
  it("xbot research --mock works with no credentials, server, or Slack", async () => {
    const { stdout } = await exec(
      "node",
      [cliBin, "research", "What are developers discussing about Mastra?", "--mock"],
      { env },
    );
    expect(stdout).toContain("## Sources");
    expect(stdout).toContain("https://x.com/fixture_");
    const history = await exec("node", [cliBin, "history", "list", "--json"], { env });
    expect(JSON.parse(history.stdout)).toHaveLength(1);
  });

  it("xbot-mcp speaks MCP over stdio", async () => {
    const client = new MCPClient({
      servers: {
        xbot: {
          command: "node",
          args: [mcpBin, "--mock"],
          env: { XBOT_HOME: home, XBOT_DB_URL: `file:${join(home, "mcp.db")}`, PATH: process.env.PATH ?? "" },
        },
      },
    });
    try {
      const tools = await client.listTools();
      const search = Object.entries(tools).find(([k]) => k.endsWith("xbot_search_posts"))?.[1] as {
        execute: (input: unknown, ctx?: unknown) => Promise<unknown>;
      };
      expect(search).toBeDefined();
      const result = (await search.execute({ query: "#Mastra", maxResults: 10 })) as Record<string, unknown>;
      expect(JSON.stringify(result)).toContain("fixture_");
    } finally {
      await client.disconnect();
    }
  });
});
