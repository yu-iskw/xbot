import {
  type ReportSummary,
  ReportSummarySchema,
  type ResearchReport,
  ResearchReportSchema,
  type ResearchRun,
  ResearchRunSchema,
} from "../schemas/research";
import { type XPost, XPostSchema } from "../schemas/x";
import type { UsageRecord } from "../x/budget";
import type { XClientMode } from "../x/port";
import type {
  AcquireRunResult,
  CreateRunInput,
  EvidenceAvailability,
  ListReportsOptions,
  XbotStore,
} from "./store";

export type SqlValue = string | number | null;
export interface SqlStatement {
  sql: string;
  args: SqlValue[];
}
export interface SqlResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
}

/** The little a database has to provide. Statements use `?` placeholders. */
export interface SqlDriver {
  execute(statement: SqlStatement): Promise<SqlResult>;
  /** Run statements in one transaction and return each result. */
  batch(statements: SqlStatement[]): Promise<SqlResult[]>;
  close(): Promise<void>;
}

/** Where SQLite (libSQL) and PostgreSQL differ for xbot's tables and queries. */
export interface SqlDialect {
  name: "sqlite" | "postgres";
  /** Statements run once before the schema (pragmas). Failures are ignored. */
  setup: string[];
  /** Auto-incrementing integer primary key column type. */
  serialPrimaryKey: string;
  floatType: string;
  /** Expression counting the sources in a report's JSON `body` column. */
  sourcesCount: string;
  /** Case-insensitive LIKE operator. */
  ilike: string;
}

/**
 * Page sizes are clamped to 1..200. Callers pass user input through, and SQLite treats a negative
 * LIMIT as "no limit", so the lower bound matters as much as the upper one.
 */
export function clampLimit(limit: number | undefined, fallback = 20, max = 200): number {
  const n = Math.trunc(Number(limit));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

function schema(d: SqlDialect): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS xbot_runs (
    id TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    topic_id TEXT,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    input TEXT NOT NULL,
    plan TEXT,
    report_id TEXT,
    output TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`,
    "CREATE INDEX IF NOT EXISTS xbot_runs_tenant ON xbot_runs (tenant_id, started_at)",
    `CREATE TABLE IF NOT EXISTS xbot_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    topic_id TEXT,
    query TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    body TEXT NOT NULL
  )`,
    "CREATE INDEX IF NOT EXISTS xbot_reports_tenant ON xbot_reports (tenant_id, generated_at)",
    "CREATE INDEX IF NOT EXISTS xbot_reports_topic ON xbot_reports (tenant_id, topic_id, generated_at)",
    `CREATE TABLE IF NOT EXISTS xbot_evidence (
    report_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    availability_status TEXT NOT NULL DEFAULT 'available',
    PRIMARY KEY (report_id, post_id)
  )`,
    "CREATE INDEX IF NOT EXISTS xbot_evidence_post ON xbot_evidence (post_id)",
    `CREATE TABLE IF NOT EXISTS xbot_post_cache (
    post_id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    cached_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS xbot_usage (
    id ${d.serialPrimaryKey},
    run_id TEXT,
    operation TEXT NOT NULL,
    posts INTEGER NOT NULL,
    users INTEGER NOT NULL,
    cost_usd ${d.floatType} NOT NULL,
    mode TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
    "CREATE INDEX IF NOT EXISTS xbot_usage_at ON xbot_usage (mode, at)",
    "CREATE INDEX IF NOT EXISTS xbot_post_cache_expires ON xbot_post_cache (expires_at)",
  ];
}

/** xbot's application store over any SQL driver. Every read is tenant-scoped. */
export class SqlXbotStore implements XbotStore {
  readonly #db: SqlDriver;
  readonly #dialect: SqlDialect;
  #ready: Promise<void> | undefined;

  constructor(driver: SqlDriver, dialect: SqlDialect) {
    this.#db = driver;
    this.#dialect = dialect;
  }

  init(): Promise<void> {
    this.#ready ??= (async () => {
      for (const sql of this.#dialect.setup) {
        await this.#db.execute({ sql, args: [] }).catch(() => undefined);
      }
      await this.#db.batch(schema(this.#dialect).map((sql) => ({ sql, args: [] })));
    })();
    return this.#ready;
  }

  close(): Promise<void> {
    return this.#db.close();
  }

  async acquireRun(input: CreateRunInput): Promise<AcquireRunResult> {
    await this.init();
    const inserted = await this.#db.execute({
      sql: `INSERT INTO xbot_runs (id, workflow, tenant_id, topic_id, trigger_type, status, idempotency_key, input, started_at)
            VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
            ON CONFLICT DO NOTHING
            RETURNING *`,
      args: [
        input.id,
        input.workflow,
        input.tenantId,
        input.topicId ?? null,
        input.trigger,
        input.idempotencyKey ?? null,
        JSON.stringify(input.input),
        input.startedAt,
      ],
    });
    if (inserted.rows[0]) return { acquired: true, run: rowToRun(inserted.rows[0]) };
    // A failed run may be retried by atomically flipping it back to running. The key lookup is
    // tenant-scoped so one tenant can never observe another tenant's run.
    if (input.idempotencyKey) {
      const retried = await this.#db.execute({
        sql: `UPDATE xbot_runs SET status = 'running', error = NULL, started_at = ?, completed_at = NULL
              WHERE idempotency_key = ? AND tenant_id = ? AND status = 'failed'
              RETURNING *`,
        args: [input.startedAt, input.idempotencyKey, input.tenantId],
      });
      if (retried.rows[0]) return { acquired: true, run: rowToRun(retried.rows[0]) };
      const existing = await this.#db.execute({
        sql: "SELECT * FROM xbot_runs WHERE idempotency_key = ? AND tenant_id = ?",
        args: [input.idempotencyKey, input.tenantId],
      });
      if (existing.rows[0]) return { acquired: false, run: rowToRun(existing.rows[0]) };
    }
    throw new Error(`Run ${input.id} could not be acquired for tenant ${input.tenantId}`);
  }

  async updateRun(
    id: string,
    patch: {
      status?: string;
      plan?: unknown;
      reportId?: string;
      output?: unknown;
      error?: string;
      completedAt?: string;
    },
  ): Promise<void> {
    await this.init();
    const columns: [string, SqlValue | undefined][] = [
      ["status", patch.status],
      ["plan", patch.plan === undefined ? undefined : JSON.stringify(patch.plan)],
      ["report_id", patch.reportId],
      ["output", patch.output === undefined ? undefined : JSON.stringify(patch.output)],
      ["error", patch.error],
      ["completed_at", patch.completedAt],
    ];
    const present = columns.filter((c): c is [string, SqlValue] => c[1] !== undefined);
    if (present.length === 0) return;
    const sets = present.map(([col]) => `${col} = ?`);
    const args: SqlValue[] = present.map(([, value]) => value);
    args.push(id);
    await this.#db.execute({ sql: `UPDATE xbot_runs SET ${sets.join(", ")} WHERE id = ?`, args });
  }

  async getRun(id: string, tenantId: string): Promise<ResearchRun | undefined> {
    await this.init();
    const res = await this.#db.execute({
      sql: "SELECT * FROM xbot_runs WHERE id = ? AND tenant_id = ?",
      args: [id, tenantId],
    });
    return res.rows[0] ? rowToRun(res.rows[0]) : undefined;
  }

  async listRuns(tenantId: string, limit?: number): Promise<ResearchRun[]> {
    await this.init();
    const res = await this.#db.execute({
      sql: "SELECT * FROM xbot_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?",
      args: [tenantId, clampLimit(limit)],
    });
    return res.rows.map(rowToRun);
  }

  async saveReport(report: ResearchReport, tenantId: string, topicId?: string): Promise<void> {
    await this.init();
    const statements: SqlStatement[] = [
      {
        sql: `INSERT INTO xbot_reports (id, run_id, tenant_id, topic_id, query, summary, status, generated_at, body)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          report.id,
          report.runId,
          tenantId,
          topicId ?? null,
          report.query,
          report.summary,
          report.status,
          report.generatedAt,
          JSON.stringify(report),
        ],
      },
    ];
    const sources = firstBy(report.sources, (source) => source.id);
    if (sources.length > 0) {
      statements.push({
        sql: `INSERT INTO xbot_evidence (report_id, post_id, source_url, retrieved_at)
              VALUES ${valueTuples(sources.length, 4)}
              ON CONFLICT DO NOTHING`,
        args: sources.flatMap((source) => [report.id, source.id, source.url, source.retrievedAt]),
      });
    }
    await this.#db.batch(statements);
  }

  async getReport(id: string, tenantId: string): Promise<ResearchReport | undefined> {
    return this.#readReport("SELECT body FROM xbot_reports WHERE id = ? AND tenant_id = ?", [id, tenantId]);
  }

  async latestReportForTopic(topicId: string, tenantId: string): Promise<ResearchReport | undefined> {
    return this.#readReport(
      "SELECT body FROM xbot_reports WHERE topic_id = ? AND tenant_id = ? ORDER BY generated_at DESC LIMIT 1",
      [topicId, tenantId],
    );
  }

  async listReports(options: ListReportsOptions): Promise<ReportSummary[]> {
    await this.init();
    const where = ["tenant_id = ?"];
    const args: SqlValue[] = [options.tenantId];
    if (options.search) {
      const like = this.#dialect.ilike;
      where.push(`(query ${like} ? ESCAPE '\\' OR summary ${like} ? ESCAPE '\\')`);
      const pattern = `%${options.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      args.push(pattern, pattern);
    }
    if (options.topicId) {
      where.push("topic_id = ?");
      args.push(options.topicId);
    }
    args.push(clampLimit(options.limit));
    const res = await this.#db.execute({
      sql: `SELECT id, run_id, query, summary, status, generated_at,
                   ${this.#dialect.sourcesCount} AS sources FROM xbot_reports
            WHERE ${where.join(" AND ")} ORDER BY generated_at DESC LIMIT ?`,
      args,
    });
    return res.rows.map((r) =>
      ReportSummarySchema.parse({
        id: String(r.id),
        runId: String(r.run_id),
        query: String(r.query),
        summary: String(r.summary),
        status: String(r.status),
        generatedAt: String(r.generated_at),
        sources: Number(r.sources),
      }),
    );
  }

  async purgePost(postId: string): Promise<{ cacheRows: number; citingReports: string[] }> {
    await this.init();
    const [deleted, , citing] = await this.#db.batch([
      { sql: "DELETE FROM xbot_post_cache WHERE post_id = ?", args: [postId] },
      { sql: "UPDATE xbot_evidence SET availability_status = 'removed' WHERE post_id = ?", args: [postId] },
      { sql: "SELECT report_id FROM xbot_evidence WHERE post_id = ?", args: [postId] },
    ]);
    return { cacheRows: deleted!.rowsAffected, citingReports: citing!.rows.map((r) => String(r.report_id)) };
  }

  async purgeExpiredPosts(nowIso: string): Promise<number> {
    await this.init();
    const res = await this.#db.execute({
      sql: "DELETE FROM xbot_post_cache WHERE expires_at <= ?",
      args: [nowIso],
    });
    return res.rowsAffected;
  }

  async evidenceStatus(reportId: string): Promise<{ postId: string; status: EvidenceAvailability }[]> {
    await this.init();
    const res = await this.#db.execute({
      sql: "SELECT post_id, availability_status FROM xbot_evidence WHERE report_id = ? ORDER BY post_id",
      args: [reportId],
    });
    return res.rows.map((r) => ({
      postId: String(r.post_id),
      status: String(r.availability_status) as EvidenceAvailability,
    }));
  }

  async getCachedPosts(ids: string[], nowIso: string): Promise<XPost[]> {
    if (ids.length === 0) return [];
    await this.init();
    const res = await this.#db.execute({
      sql: `SELECT body FROM xbot_post_cache WHERE expires_at > ? AND post_id IN (${ids.map(() => "?").join(",")})`,
      args: [nowIso, ...ids],
    });
    return res.rows.map((r) => XPostSchema.parse(JSON.parse(String(r.body))));
  }

  async cachePosts(posts: XPost[], expiresAtIso: string): Promise<void> {
    if (posts.length === 0) return;
    await this.init();
    const now = new Date().toISOString();
    // Last write wins, matching the previous per-row upsert. One statement is one round trip.
    const unique = firstBy(posts, (post) => post.id, "last");
    await this.#db.execute({
      sql: `INSERT INTO xbot_post_cache (post_id, body, cached_at, expires_at)
            VALUES ${valueTuples(unique.length, 4)}
            ON CONFLICT (post_id) DO UPDATE SET body = excluded.body, cached_at = excluded.cached_at, expires_at = excluded.expires_at`,
      args: unique.flatMap((post) => [post.id, JSON.stringify(post), now, expiresAtIso]),
    });
  }

  async recordUsage(record: UsageRecord): Promise<void> {
    await this.init();
    await this.#db.execute({
      sql: `INSERT INTO xbot_usage (run_id, operation, posts, users, cost_usd, mode, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        record.runId ?? null,
        record.operation,
        record.posts,
        record.users,
        record.costUsd,
        record.mode,
        record.at,
      ],
    });
  }

  async periodCost(dayStartIso: string, monthStartIso: string, mode: XClientMode) {
    await this.init();
    // The month window always contains the day window, so one range scan yields both sums.
    const res = await this.#db.execute({
      sql: `SELECT COALESCE(SUM(CASE WHEN at >= ? THEN cost_usd END), 0) AS day,
                   COALESCE(SUM(cost_usd), 0) AS month
            FROM xbot_usage WHERE mode = ? AND at >= ?`,
      args: [dayStartIso, mode, monthStartIso],
    });
    return { day: Number(res.rows[0]?.day ?? 0), month: Number(res.rows[0]?.month ?? 0) };
  }

  async #readReport(sql: string, args: SqlValue[]): Promise<ResearchReport | undefined> {
    await this.init();
    const res = await this.#db.execute({ sql, args });
    const row = res.rows[0];
    return row ? ResearchReportSchema.parse(JSON.parse(String(row.body))) : undefined;
  }
}

function valueTuples(rowCount: number, columns: number): string {
  const row = `(${Array.from({ length: columns }, () => "?").join(", ")})`;
  return Array.from({ length: rowCount }, () => row).join(", ");
}

/** Keep one row per key. `first` matches ON CONFLICT DO NOTHING; `last` matches DO UPDATE. */
function firstBy<T>(rows: T[], key: (row: T) => string, which: "first" | "last" = "first"): T[] {
  const chosen = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (which === "last" || !chosen.has(id)) chosen.set(id, row);
  }
  return [...chosen.values()];
}

function parseJson(value: unknown): unknown {
  return value === null || value === undefined ? undefined : JSON.parse(String(value));
}

function rowToRun(r: Record<string, unknown>): ResearchRun {
  const opt = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  return ResearchRunSchema.parse({
    id: String(r.id),
    workflow: String(r.workflow),
    tenantId: String(r.tenant_id),
    topicId: opt(r.topic_id),
    trigger: String(r.trigger_type),
    status: String(r.status),
    idempotencyKey: opt(r.idempotency_key),
    input: parseJson(r.input),
    plan: parseJson(r.plan),
    reportId: opt(r.report_id),
    output: parseJson(r.output),
    error: opt(r.error),
    startedAt: String(r.started_at),
    completedAt: opt(r.completed_at),
  });
}
