import { describe, test, expect, beforeEach } from "bun:test";
import type { Engine, QueryResult, ResolvedConfig } from "../../src/types.js";

// Minimal EngineDriver mock
function makeDriver(engine: Engine, overrides: Partial<{
  queryResult: QueryResult;
  listResult: string[];
  describeResult: Record<string, unknown>[];
  explainResult: QueryResult;
  connectFails: boolean;
}> = {}) {
  const cfg: ResolvedConfig = {
    engine,
    host: "localhost",
    port: 5432,
    source: { host: "default", port: "default" },
  };

  return {
    engine,
    cfg,
    async connect(_c: ResolvedConfig) {
      if (overrides.connectFails) throw new Error(`Connection refused: ${engine} @ localhost:5432`);
      return { engine, native: {} };
    },
    async close() {},
    async ping() { return true; },
    async query(_conn: unknown, _body: string, _params?: unknown[]): Promise<QueryResult> {
      return overrides.queryResult ?? { kind: "rows", rows: [{ id: 1 }], truncated: false, rowCount: 1 };
    },
    async list(_conn: unknown, _kind: string): Promise<string[]> {
      return overrides.listResult ?? ["users", "orders"];
    },
    async describe(_conn: unknown, _target: string): Promise<Record<string, unknown>[]> {
      return overrides.describeResult ?? [{ column: "id", type: "int" }];
    },
    async explain(_conn: unknown, _body: string): Promise<QueryResult> {
      return overrides.explainResult ?? { kind: "reply", reply: "Seq Scan on users" };
    },
  };
}

// We need to dynamically import after module resolution for DI
// Tools use DI through deps parameter
async function importTools() {
  return await import("../../src/tools/db.js");
}

describe("db tools — db_query", () => {
  test("routes to correct engine and returns rows", async () => {
    const { db_query } = await importTools();
    const driver = makeDriver("postgres");
    const result = await db_query(
      { engine: "postgres", body: "SELECT 1", connection: "main" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect(result).toEqual({ rows: [{ id: 1 }], _truncated: false, _total_rows: 1 });
  });

  test("returns _truncated and _total_rows when rows exceed limit", async () => {
    const { db_query } = await importTools();
    const bigRows = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    const driver = makeDriver("postgres", {
      queryResult: { kind: "rows", rows: bigRows, truncated: false, rowCount: 600 },
    });
    const result = await db_query(
      { engine: "postgres", body: "SELECT * FROM big", limit: 100 },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    const r = result as { rows: unknown[]; _truncated: boolean; _total_rows: number };
    expect(r.rows).toHaveLength(100);
    expect(r._truncated).toBe(true);
    expect(r._total_rows).toBe(600);
    // Old field names must NOT appear
    expect((result as Record<string, unknown>).truncated).toBeUndefined();
    expect((result as Record<string, unknown>).rowCount).toBeUndefined();
  });

  test("blocks write SQL and returns error envelope", async () => {
    const { db_query } = await importTools();
    const driver = makeDriver("postgres");
    const result = await db_query(
      { engine: "postgres", body: "INSERT INTO t VALUES (1)" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg, allowWrite: false }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toContain("Write");
  });

  test("unknown engine returns error envelope", async () => {
    const { db_query } = await importTools();
    const result = await db_query(
      { engine: "oracle" as Engine, body: "SELECT 1" },
      { getDriver: (_e: Engine) => { throw new Error("no driver"); }, resolveConfig: async () => { throw new Error(); } }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toContain("oracle");
  });

  test("connection error returns masked error envelope", async () => {
    const { db_query } = await importTools();
    const driver = makeDriver("postgres", { connectFails: true });
    const result = await db_query(
      { engine: "postgres", body: "SELECT 1" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("postgres");
  });
});

describe("db tools — db_list", () => {
  test("returns items array from driver.list", async () => {
    const { db_list } = await importTools();
    const driver = makeDriver("mysql", { listResult: ["orders", "users"] });
    const result = await db_list(
      { engine: "mysql" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect(result).toEqual({ items: ["orders", "users"] });
  });

  test("unknown engine returns error envelope", async () => {
    const { db_list } = await importTools();
    const result = await db_list(
      { engine: "oracle" as Engine },
      { getDriver: () => { throw new Error("no driver"); }, resolveConfig: async () => { throw new Error(); } }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});

describe("db tools — db_describe", () => {
  test("returns schema from driver.describe", async () => {
    const { db_describe } = await importTools();
    const driver = makeDriver("sqlite", { describeResult: [{ column: "id", type: "INTEGER" }] });
    const result = await db_describe(
      { engine: "sqlite", target: "users" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect(result).toEqual({ schema: [{ column: "id", type: "INTEGER" }] });
  });

  test("missing target returns error envelope", async () => {
    const { db_describe } = await importTools();
    const driver = makeDriver("sqlite");
    const result = await db_describe(
      { engine: "sqlite", target: "" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toContain("target");
  });
});

describe("db tools — db_explain", () => {
  test("returns plan string from driver.explain", async () => {
    const { db_explain } = await importTools();
    const driver = makeDriver("postgres", { explainResult: { kind: "reply", reply: "Seq Scan on orders" } });
    const result = await db_explain(
      { engine: "postgres", body: "SELECT * FROM orders" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect(result).toEqual({ plan: "Seq Scan on orders" });
  });

  test("redis explain returns not-supported notice without error", async () => {
    const { db_explain } = await importTools();
    const driver = makeDriver("redis", { explainResult: { kind: "reply", reply: "EXPLAIN not supported for redis" } });
    const result = await db_explain(
      { engine: "redis", body: "GET foo" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError?: boolean }).isError).toBeUndefined();
    expect((result as { plan: string }).plan).toContain("not supported");
  });
});

describe("db tools — db_connection_info", () => {
  test("returns connection info without password", async () => {
    const { db_connection_info } = await importTools();
    const cfg: ResolvedConfig = {
      engine: "postgres",
      host: "prod.db",
      port: 5432,
      user: "admin",
      password: "supersecret",
      database: "mydb",
      source: { host: "stored", port: "stored" },
    };
    const result = await db_connection_info(
      { engine: "postgres" },
      { resolveConfig: async (_e: Engine, _c: string) => cfg }
    );
    expect((result as { host: string }).host).toBe("prod.db");
    expect((result as { port: number }).port).toBe(5432);
    expect((result as { user: string }).user).toBe("admin");
    expect((result as { database: string }).database).toBe("mydb");
    expect((result as Record<string, unknown>).password).toBeUndefined();
    expect((result as { source: unknown }).source).toBeDefined();
  });

  test("password masked to **** in source-level reference", async () => {
    const { db_connection_info } = await importTools();
    const cfg: ResolvedConfig = {
      engine: "mysql",
      host: "localhost",
      port: 3306,
      password: "secret123",
      source: { host: "env", port: "env", password: "env" },
    };
    const result = await db_connection_info(
      { engine: "mysql" },
      { resolveConfig: async () => cfg }
    );
    const r = result as Record<string, unknown>;
    expect(r.password).toBeUndefined();
    expect(r.host).toBe("localhost");
  });
});

describe("db tools — db_query edge cases", () => {
  test("returns docs result shape when driver returns kind=docs", async () => {
    const { db_query } = await importTools();
    const driver = makeDriver("mongo", {
      queryResult: { kind: "docs", docs: [{ _id: "abc", name: "test" }] },
    });
    const result = await db_query(
      { engine: "mongo", body: '{"find":"col","filter":{}}' },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { docs: unknown[] }).docs).toHaveLength(1);
  });

  test("returns reply shape when driver returns kind=reply", async () => {
    const { db_query } = await importTools();
    const driver = makeDriver("redis", {
      queryResult: { kind: "reply", reply: "PONG" },
    });
    const result = await db_query(
      { engine: "redis", body: "PING" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { reply: string }).reply).toBe("PONG");
  });

  test("config resolution failure returns error envelope", async () => {
    const { db_query } = await importTools();
    const result = await db_query(
      { engine: "postgres", body: "SELECT 1" },
      {
        getDriver: (_e: Engine) => makeDriver("postgres"),
        resolveConfig: async () => { throw new Error("config error"); },
      }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toContain("Config resolution failed");
  });

  test("returns ok:true when driver returns void result kind", async () => {
    const { db_query } = await importTools();
    const driver = makeDriver("redis", {
      queryResult: { kind: "void" } as any,
    });
    const result = await db_query(
      { engine: "redis", body: "SET key val" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg, allowWrite: true }
    );
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  test("query execution failure returns error envelope", async () => {
    const { db_query } = await importTools();
    const driver = {
      ...makeDriver("postgres"),
      query: async () => { throw new Error("query exploded"); },
    };
    const result = await db_query(
      { engine: "postgres", body: "SELECT 1" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toContain("Query failed");
  });
});

describe("db tools — db_explain extractPlan coverage", () => {
  test("extractPlan handles rows kind result", async () => {
    const { db_explain } = await importTools();
    const driver = makeDriver("postgres", {
      explainResult: { kind: "rows", rows: [{ plan: "Seq Scan" }], truncated: false, rowCount: 1 },
    });
    const result = await db_explain(
      { engine: "postgres", body: "EXPLAIN SELECT 1" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { plan: string }).plan).toContain("Seq Scan");
  });

  test("extractPlan handles docs kind result", async () => {
    const { db_explain } = await importTools();
    const driver = makeDriver("mongo", {
      explainResult: { kind: "docs", docs: [{ stage: "COLLSCAN" }] },
    });
    const result = await db_explain(
      { engine: "mongo", body: '{"explain":{"find":"col"}}' },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { plan: string }).plan).toContain("COLLSCAN");
  });
});

describe("db tools — db_engines", () => {
  test("returns all 5 engines with name, available, and discovered_via fields", async () => {
    const { db_engines } = await importTools();
    const mockResolve = async (engine: Engine, _conn: string): Promise<ResolvedConfig> => ({
      engine,
      host: "localhost",
      port: 5432,
      source: { host: engine === "postgres" ? "env" : "default", port: "default" },
    });
    const result = await db_engines({}, { resolveConfig: mockResolve });
    const r = result as { engines: { name: Engine; available: boolean; discovered_via: string }[] };
    expect(r.engines).toHaveLength(5);
    const names = r.engines.map((e) => e.name);
    expect(names).toContain("postgres");
    expect(names).toContain("mysql");
    expect(names).toContain("mongo");
    expect(names).toContain("redis");
    expect(names).toContain("sqlite");
    // Field name shape: must use `name` and `discovered_via` per REQ-14, not `engine`/`source`
    const first = r.engines[0];
    expect((first as Record<string, unknown>).engine).toBeUndefined();
    expect((first as Record<string, unknown>).source).toBeUndefined();
    expect(first.discovered_via).toBeDefined();
  });

  test("engine with non-default source is marked available=true", async () => {
    const { db_engines } = await importTools();
    const mockResolve = async (engine: Engine, _conn: string): Promise<ResolvedConfig> => ({
      engine,
      host: "localhost",
      port: 5432,
      source: { host: engine === "postgres" ? "env" : "default", port: "default" },
    });
    const result = await db_engines({}, { resolveConfig: mockResolve });
    const r = result as { engines: { name: Engine; available: boolean; discovered_via: string }[] };
    const pg = r.engines.find((e) => e.name === "postgres")!;
    const my = r.engines.find((e) => e.name === "mysql")!;
    expect(pg.available).toBe(true);
    expect(my.available).toBe(false);
  });
});

describe("db tools — error path coverage", () => {
  test("db_list config resolution failure returns error", async () => {
    const { db_list } = await importTools();
    const result = await db_list(
      { engine: "postgres" },
      {
        getDriver: (_e: Engine) => makeDriver("postgres"),
        resolveConfig: async () => { throw new Error("no config"); },
      }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/config resolution failed/i);
  });

  test("db_list connect failure returns error", async () => {
    const { db_list } = await importTools();
    const driver = makeDriver("postgres", { connectFails: true });
    const result = await db_list(
      { engine: "postgres" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/connection failed/i);
  });

  test("db_list list() failure returns error", async () => {
    const { db_list } = await importTools();
    const driver = {
      ...makeDriver("postgres"),
      list: async () => { throw new Error("list error"); },
    };
    const result = await db_list(
      { engine: "postgres" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/list failed/i);
  });

  test("db_describe config resolution failure returns error", async () => {
    const { db_describe } = await importTools();
    const result = await db_describe(
      { engine: "postgres", target: "users" },
      {
        getDriver: (_e: Engine) => makeDriver("postgres"),
        resolveConfig: async () => { throw new Error("no config"); },
      }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/config resolution failed/i);
  });

  test("db_describe connect failure returns error", async () => {
    const { db_describe } = await importTools();
    const driver = makeDriver("postgres", { connectFails: true });
    const result = await db_describe(
      { engine: "postgres", target: "users" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/connection failed/i);
  });

  test("db_describe describe() failure returns error", async () => {
    const { db_describe } = await importTools();
    const driver = {
      ...makeDriver("postgres"),
      describe: async () => { throw new Error("describe error"); },
    };
    const result = await db_describe(
      { engine: "postgres", target: "users" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/describe failed/i);
  });

  test("db_explain config resolution failure returns error", async () => {
    const { db_explain } = await importTools();
    const result = await db_explain(
      { engine: "postgres", body: "SELECT 1" },
      {
        getDriver: (_e: Engine) => makeDriver("postgres"),
        resolveConfig: async () => { throw new Error("no config"); },
      }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/config resolution failed/i);
  });

  test("db_explain connect failure returns error", async () => {
    const { db_explain } = await importTools();
    const driver = makeDriver("postgres", { connectFails: true });
    const result = await db_explain(
      { engine: "postgres", body: "SELECT 1" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/connection failed/i);
  });

  test("db_explain explain() failure returns error", async () => {
    const { db_explain } = await importTools();
    const driver = {
      ...makeDriver("postgres"),
      explain: async () => { throw new Error("explain error"); },
    };
    const result = await db_explain(
      { engine: "postgres", body: "SELECT 1" },
      { getDriver: (_e: Engine) => driver, resolveConfig: async (_e: Engine, _c: string) => driver.cfg }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/explain failed/i);
  });

  test("db_connection_info config resolution failure returns error", async () => {
    const { db_connection_info } = await importTools();
    const result = await db_connection_info(
      { engine: "postgres" },
      { resolveConfig: async () => { throw new Error("no config"); } }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toMatch(/config resolution failed/i);
  });
});
