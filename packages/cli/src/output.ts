import { writeFile } from "node:fs/promises";
import { type ResearchReport, renderReportMarkdown, type XbotRuntime } from "@yu-iskw/xbot-core";

export type ReportFormat = "markdown" | "json";

export function parseFormat(value: string | undefined): ReportFormat {
  if (value === undefined || value === "markdown" || value === "md") return "markdown";
  if (value === "json") return "json";
  throw new Error(`Unknown format "${value}" (expected markdown or json)`);
}

export async function formatReport(runtime: XbotRuntime, report: ResearchReport, format: ReportFormat) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  const posts = await runtime.cachedPosts(report.sources.map((s) => s.id));
  return renderReportMarkdown(report, { posts });
}

export async function emit(text: string, out?: string): Promise<void> {
  if (out) {
    await writeFile(out, text, "utf8");
    process.stderr.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(text);
  }
}

export function note(message: string): void {
  process.stderr.write(`${message}\n`);
}
