import type { Pool } from "pg";
import { type SqlDialect, type SqlDriver, type SqlResult, type SqlStatement, SqlXbotStore } from "./sql";

export const POSTGRES_DIALECT: SqlDialect = {
  name: "postgres",
  setup: [],
  serialPrimaryKey: "BIGSERIAL PRIMARY KEY",
  floatType: "DOUBLE PRECISION",
  sourcesCount: "jsonb_array_length((body::jsonb) -> 'sources')",
  ilike: "ILIKE",
};

/** Rewrite `?` placeholders as `$1, $2, ...`. xbot's SQL never contains `?` inside literals. */
export function toPositional(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

class PgDriver implements SqlDriver {
  constructor(
    private readonly pool: Pool,
    private readonly ownsPool: boolean,
  ) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    const res = await this.pool.query(toPositional(statement.sql), statement.args);
    return { rows: res.rows, rowsAffected: res.rowCount ?? 0 };
  }

  async batch(statements: SqlStatement[]): Promise<SqlResult[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const results: SqlResult[] = [];
      for (const s of statements) {
        const res = await client.query(toPositional(s.sql), s.args);
        results.push({ rows: res.rows, rowsAffected: res.rowCount ?? 0 });
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

/** PostgreSQL store for production: shared state across processes and workers. */
export class PostgresXbotStore extends SqlXbotStore {
  /**
   * @param pool A `pg` pool. Pass `ownsPool: false` when the pool is shared (e.g. with Mastra's
   * PostgresStore) and closed elsewhere.
   */
  constructor(pool: Pool, options: { ownsPool?: boolean } = {}) {
    super(new PgDriver(pool, options.ownsPool ?? true), POSTGRES_DIALECT);
  }
}

/**
 * Load the optional `pg` dependency and open a pool. Kept dynamic so libSQL-only installs never need
 * PostgreSQL packages.
 */
export async function createPgPool(connectionString: string): Promise<Pool> {
  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    throw new Error('PostgreSQL storage requires the "pg" and "@mastra/pg" packages to be installed.');
  }
  const PoolCtor = (pg as unknown as { default?: typeof pg }).default?.Pool ?? pg.Pool;
  return new PoolCtor({ connectionString });
}
