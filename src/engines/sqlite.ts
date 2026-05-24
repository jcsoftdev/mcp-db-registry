import { Database } from "bun:sqlite";
import type { Connection, EngineDriver, ForeignKey, QueryResult, ResolvedConfig, Row } from "../types.js";

const ROW_LIMIT = 500;

export class SqliteDriver implements EngineDriver<"sqlite"> {
  readonly engine = "sqlite" as const;

  async connect(cfg: ResolvedConfig): Promise<Connection<"sqlite">> {
    const path = cfg.url ?? ":memory:";
    const db = new Database(path);
    return { engine: "sqlite", native: db };
  }

  async close(conn: Connection<"sqlite">): Promise<void> {
    (conn.native as Database).close();
  }

  async ping(conn: Connection<"sqlite">): Promise<boolean> {
    try {
      (conn.native as Database).query("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  async query(
    conn: Connection<"sqlite">,
    body: string,
    params?: unknown[]
  ): Promise<QueryResult> {
    const db = conn.native as Database;
    const stmt = db.query(body);
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE|MERGE)/i.test(body);
    if (isWrite) {
      stmt.run(...(params ?? []));
      return { kind: "void" };
    }
    const all = stmt.all(...(params ?? [])) as Row[];
    const total = all.length;
    const truncated = total > ROW_LIMIT;
    return {
      kind: "rows",
      rows: truncated ? all.slice(0, ROW_LIMIT) : all,
      truncated,
      rowCount: total,
    };
  }

  async list(conn: Connection<"sqlite">, _kind: "tables" | "collections" | "keys" | "indexes"): Promise<string[]> {
    const db = conn.native as Database;
    const rows = db.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  async describe(conn: Connection<"sqlite">, target: string): Promise<Row[]> {
    const db = conn.native as Database;
    return db.query(`PRAGMA table_info("${target}")`).all() as Row[];
  }

  async explain(conn: Connection<"sqlite">, body: string): Promise<QueryResult> {
    const db = conn.native as Database;
    const rows = db.query(`EXPLAIN QUERY PLAN ${body}`).all() as Row[];
    return { kind: "rows", rows, truncated: false, rowCount: rows.length };
  }

  async getForeignKeys(conn: Connection<"sqlite">, tables: string[]): Promise<ForeignKey[]> {
    if (tables.length === 0) return [];
    const db = conn.native as Database;
    const out: ForeignKey[] = [];
    for (const table of tables) {
      const safe = table.replace(/"/g, '""');
      const rows = db.query(`PRAGMA foreign_key_list("${safe}")`).all() as Array<{
        table: string;
        from: string;
        to: string;
      }>;
      for (const r of rows) {
        out.push({ from_table: table, from_col: r.from, to_table: r.table, to_col: r.to });
      }
    }
    return out;
  }
}
