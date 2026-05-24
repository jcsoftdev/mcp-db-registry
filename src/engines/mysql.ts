import mysql from "mysql2/promise";
import type { Connection, EngineDriver, QueryResult, ResolvedConfig, Row } from "../types.js";

const ROW_LIMIT = 500;

type MysqlConnection = Awaited<ReturnType<typeof mysql.createConnection>>;

export class MysqlDriver implements EngineDriver<"mysql"> {
  readonly engine = "mysql" as const;

  async connect(cfg: ResolvedConfig): Promise<Connection<"mysql">> {
    const native = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
    });
    return { engine: "mysql", native };
  }

  async close(conn: Connection<"mysql">): Promise<void> {
    const c = conn.native as MysqlConnection;
    await c.end();
  }

  async ping(conn: Connection<"mysql">): Promise<boolean> {
    try {
      const c = conn.native as MysqlConnection;
      await c.execute("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async query(
    conn: Connection<"mysql">,
    body: string,
    params?: unknown[]
  ): Promise<QueryResult> {
    const c = conn.native as MysqlConnection;
    const [raw] = await c.execute(body, params ?? []);
    const rows = raw as Row[];
    const total = rows.length;
    const truncated = total > ROW_LIMIT;
    return { kind: "rows", rows: truncated ? rows.slice(0, ROW_LIMIT) : rows, truncated, rowCount: total };
  }

  async list(conn: Connection<"mysql">, kind: "tables" | "collections" | "keys" | "indexes"): Promise<string[]> {
    const c = conn.native as MysqlConnection;
    if (kind === "indexes") {
      const [rows] = await c.execute(`SHOW INDEX FROM \`${(conn as any)._database ?? ""}\``);
      return (rows as Array<Record<string, unknown>>).map((r) => String(r["Key_name"]));
    }
    const [rows] = await c.execute("SHOW TABLES");
    return (rows as Array<Record<string, unknown>>).map((r) => {
      const key = Object.keys(r)[0];
      return String(r[key]);
    });
  }

  async describe(conn: Connection<"mysql">, target: string): Promise<Row[]> {
    const c = conn.native as MysqlConnection;
    const [rows] = await c.execute(`DESCRIBE \`${target}\``);
    return rows as Row[];
  }

  async explain(conn: Connection<"mysql">, body: string): Promise<QueryResult> {
    const c = conn.native as MysqlConnection;
    const [rows] = await c.execute(`EXPLAIN ${body}`);
    const r = rows as Row[];
    return { kind: "rows", rows: r, truncated: false, rowCount: r.length };
  }
}
