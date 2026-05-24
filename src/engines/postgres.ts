import postgres from "postgres";
import type { Connection, EngineDriver, ForeignKey, QueryResult, ResolvedConfig, Row } from "../types.js";

const ROW_LIMIT = 500;

export class PostgresDriver implements EngineDriver<"postgres"> {
  readonly engine = "postgres" as const;

  async connect(cfg: ResolvedConfig): Promise<Connection<"postgres">> {
    const sql = postgres({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      max: 1,
    });
    return { engine: "postgres", native: sql };
  }

  async close(conn: Connection<"postgres">): Promise<void> {
    const sql = conn.native as ReturnType<typeof postgres>;
    await sql.end();
  }

  async ping(conn: Connection<"postgres">): Promise<boolean> {
    try {
      const sql = conn.native as ReturnType<typeof postgres>;
      await (sql as any).unsafe("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async query(
    conn: Connection<"postgres">,
    body: string,
    params?: unknown[]
  ): Promise<QueryResult> {
    const sql = conn.native as ReturnType<typeof postgres>;
    const raw = await (sql as any).unsafe(body, params ?? []) as Row[];
    const total = raw.length;
    const rows = total > ROW_LIMIT ? raw.slice(0, ROW_LIMIT) : raw;
    return { kind: "rows", rows, truncated: total > ROW_LIMIT, rowCount: total };
  }

  async list(conn: Connection<"postgres">, kind: "tables" | "collections" | "keys" | "indexes"): Promise<string[]> {
    const sql = conn.native as ReturnType<typeof postgres>;
    if (kind === "indexes") {
      const rows = await (sql as any).unsafe(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname"
      ) as Array<{ indexname: string }>;
      return rows.map((r) => r.indexname);
    }
    const rows = await (sql as any).unsafe(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    ) as Array<{ table_name: string }>;
    return rows.map((r) => r.table_name);
  }

  async describe(conn: Connection<"postgres">, target: string): Promise<Row[]> {
    const sql = conn.native as ReturnType<typeof postgres>;
    return (sql as any).unsafe(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [target]
    );
  }

  async explain(conn: Connection<"postgres">, body: string): Promise<QueryResult> {
    const sql = conn.native as ReturnType<typeof postgres>;
    const rows = await (sql as any).unsafe(`EXPLAIN ${body}`) as Row[];
    return { kind: "rows", rows, truncated: false, rowCount: rows.length };
  }

  async getForeignKeys(conn: Connection<"postgres">, tables: string[]): Promise<ForeignKey[]> {
    if (tables.length === 0) return [];
    const sql = conn.native as ReturnType<typeof postgres>;
    const rows = await (sql as any).unsafe(
      `SELECT
         tc.table_name        AS from_table,
         kcu.column_name      AS from_col,
         ccu.table_name       AS to_table,
         ccu.column_name      AS to_col
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = ANY($1)
       ORDER BY tc.table_name, kcu.column_name`,
      [tables]
    ) as ForeignKey[];
    return rows;
  }
}
