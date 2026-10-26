import { type Client, createClient } from "@libsql/client";
import { type SqlDialect, type SqlDriver, type SqlResult, type SqlStatement, SqlXbotStore } from "./sql";

export const SQLITE_DIALECT: SqlDialect = {
  name: "sqlite",
  setup: ["PRAGMA busy_timeout = 5000"],
  serialPrimaryKey: "INTEGER PRIMARY KEY AUTOINCREMENT",
  floatType: "REAL",
  sourcesCount: "json_array_length(body, '$.sources')",
  // SQLite's LIKE is already case-insensitive for ASCII.
  ilike: "LIKE",
};

class LibSqlDriver implements SqlDriver {
  constructor(private readonly client: Client) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    const res = await this.client.execute(statement);
    return { rows: res.rows as unknown as Record<string, unknown>[], rowsAffected: res.rowsAffected };
  }

  async batch(statements: SqlStatement[]): Promise<SqlResult[]> {
    const results = await this.client.batch(statements, "write");
    return results.map((r) => ({
      rows: r.rows as unknown as Record<string, unknown>[],
      rowsAffected: r.rowsAffected,
    }));
  }

  async close(): Promise<void> {
    this.client.close();
  }
}

export interface LibSqlStoreOptions {
  /** libSQL URL: "file:./xbot.db", ":memory:", or a remote libsql:// URL. */
  url: string;
  authToken?: string;
}

/** Local or remote libSQL store; the default for the CLI and development. */
export class LibSqlXbotStore extends SqlXbotStore {
  constructor(options: LibSqlStoreOptions) {
    const client = createClient({
      url: options.url,
      ...(options.authToken ? { authToken: options.authToken } : {}),
    });
    super(new LibSqlDriver(client), SQLITE_DIALECT);
  }
}
