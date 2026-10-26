import type { MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import type { XbotConfig } from "../config";
import { LibSqlXbotStore } from "./libsql";
import { createPgPool, PostgresXbotStore } from "./postgres";
import type { XbotStore } from "./store";

export interface OpenedStorage {
  provider: "libsql" | "postgres";
  url: string;
  /** xbot's application tables. */
  store: XbotStore;
  /** Mastra memory and workflow storage, on the same database. */
  mastra: MastraCompositeStore;
  close(): Promise<void>;
}

export function storageProvider(config: XbotConfig["storage"]): "libsql" | "postgres" {
  if (config?.provider) return config.provider;
  return /^postgres(ql)?:\/\//.test(config?.url ?? "") ? "postgres" : "libsql";
}

/** Open xbot's store and Mastra's storage against one database (one shared pool for PostgreSQL). */
export async function openStorage(config: XbotConfig["storage"]): Promise<OpenedStorage> {
  const provider = storageProvider(config);
  if (provider === "postgres") {
    if (!config?.url) throw new Error("PostgreSQL storage requires storage.url (or XBOT_DB_URL)");
    const pool = await createPgPool(config.url);
    const store = new PostgresXbotStore(pool, { ownsPool: false });
    const { PostgresStore } = await import("@mastra/pg");
    const mastra = new PostgresStore({ id: "xbot-mastra", pool });
    await store.init();
    return {
      provider,
      url: config.url,
      store,
      mastra: mastra as unknown as MastraCompositeStore,
      close: () => pool.end(),
    };
  }
  const url = config?.url ?? "file:./xbot.db";
  const auth = config?.authToken ? { authToken: config.authToken } : {};
  const store = new LibSqlXbotStore({ url, ...auth });
  await store.init();
  return {
    provider,
    url,
    store,
    mastra: new LibSQLStore({ id: "xbot-mastra", url, ...auth }),
    close: () => store.close(),
  };
}
