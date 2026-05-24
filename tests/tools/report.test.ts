import { describe, test, expect } from "bun:test";
import type { Engine, ForeignKey, Row, SnippetRunOutcome, JoinOnSpec } from "../../src/types.js";
import { db_describe_many, db_suggest_query, db_report_run } from "../../src/tools/report.js";
import type { ReportDeps } from "../../src/tools/report.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeConn(engine: Engine) {
  return { engine, native: {} };
}

type FakeSnippet = {
  name: string;
  engine: Engine;
  body: string;
  bodyKind: string;
  description: string | null;
  tags: string | null;
  category: string | null;
  usesCount: number;
  lastUsedAt: number | null;
};

function makeSnippetStore(snippets: FakeSnippet[]) {
  const map = new Map<string, FakeSnippet>(snippets.map((s) => [`${s.engine}::${s.name}`, s]));
  const usageCounts = new Map<string, number>();
  return {
    async get(key: { project: string; engine: Engine; name: string }) {
      return map.get(`${key.engine}::${key.name}`) ?? null;
    },
    async incrementUsage(key: { project: string; engine: Engine; name: string }) {
      const k = `${key.engine}::${key.name}`;
      usageCounts.set(k, (usageCounts.get(k) ?? 0) + 1);
    },
    getUsageCount(engine: Engine, name: string) {
      return usageCounts.get(`${engine}::${name}`) ?? 0;
    },
  };
}

function makeDeps(overrides: Partial<ReportDeps> = {}): ReportDeps {
  const conn = makeConn("postgres");
  const defaultDriver = {
    engine: "postgres" as Engine,
    connect: async () => conn,
    close: async () => {},
    ping: async () => true,
    query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
    list: async () => [],
    describe: async () => [],
    explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
    getForeignKeys: async () => [] as ForeignKey[],
  };

  return {
    getDriver: () => defaultDriver as any,
    resolveConfig: async (engine: Engine) => ({
      engine,
      host: "localhost",
      port: 5432,
      database: "test",
      source: {},
    }),
    snippetStore: makeSnippetStore([]) as any,
    project: "test-project",
    allowWrite: false,
    ...overrides,
  };
}

// ─── db_describe_many ───────────────────────────────────────────────────────

describe("db_describe_many", () => {
  test("unknown engine returns error", async () => {
    const deps = makeDeps();
    const result = await db_describe_many(
      { engine: "oracle" as Engine, tables: ["users"] },
      deps
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/unsupported engine/i);
  });

  test("empty tables array returns early without connecting", async () => {
    let connectCalled = false;
    const driver = {
      engine: "postgres" as Engine,
      connect: async () => { connectCalled = true; return makeConn("postgres"); },
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      list: async () => [],
      describe: async () => [],
      explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_describe_many(
      { engine: "postgres", tables: [] },
      deps
    );
    // REQ-26: empty tables → { schemas: {}, missing: [] } without connecting
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.schemas).toEqual({});
    expect(parsed.missing).toEqual([]);
    expect(connectCalled).toBe(false);
  });

  test("happy path — returns schemas keyed by table name in input order", async () => {
    const usersSchema = [{ column_name: "id", data_type: "integer" }];
    const ordersSchema = [{ column_name: "order_id", data_type: "integer" }];

    const driver = {
      engine: "postgres" as Engine,
      connect: async () => makeConn("postgres"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      list: async () => ["users", "orders", "products"],
      describe: async (_conn: unknown, table: string) => {
        if (table === "users") return usersSchema;
        if (table === "orders") return ordersSchema;
        return [];
      },
      explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_describe_many(
      { engine: "postgres", tables: ["orders", "users"] },
      deps
    );

    // REQ-26: { schemas: { orders: [...], users: [...] }, missing: [] }
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.schemas).toBeDefined();
    expect(Object.keys(parsed.schemas)).toEqual(["orders", "users"]); // insertion order matches input
    expect(parsed.schemas["orders"]).toEqual(ordersSchema);
    expect(parsed.schemas["users"]).toEqual(usersSchema);
    expect(parsed.missing).toEqual([]);
  });

  test("mixed present/missing — absent tables go to missing array", async () => {
    const driver = {
      engine: "postgres" as Engine,
      connect: async () => makeConn("postgres"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      list: async () => ["invoices", "customers"],
      describe: async (_conn: unknown, table: string) => {
        if (table === "invoices") return [{ column_name: "id" }];
        if (table === "customers") return [{ column_name: "id" }];
        throw new Error(`Table ${table} does not exist`);
      },
      explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_describe_many(
      { engine: "postgres", tables: ["invoices", "archive", "customers"] },
      deps
    );

    // REQ-26: present tables in schemas, absent in missing[]
    const parsed = JSON.parse((result as any).content[0].text);
    expect(Object.keys(parsed.schemas)).toEqual(["invoices", "customers"]);
    expect(parsed.missing).toEqual(["archive"]);
  });

  test("describe failure captured in missing, does not throw", async () => {
    const driver = {
      engine: "sqlite" as Engine,
      connect: async () => makeConn("sqlite"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      list: async () => { throw new Error("list not supported"); },
      describe: async (_conn: unknown, table: string) => {
        if (table === "events") return [{ column_name: "id" }];
        throw new Error("no such table: boom");
      },
      explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_describe_many(
      { engine: "sqlite", tables: ["events", "boom"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(Object.keys(parsed.schemas)).toEqual(["events"]);
    expect(parsed.missing).toContain("boom");
  });

  test("mongo — schemas present and warnings contains introspection notice (REQ-26 degraded)", async () => {
    const driver = {
      engine: "mongo" as Engine,
      connect: async () => makeConn("mongo"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "docs" as const, docs: [], truncated: false }),
      list: async () => ["orders"],
      describe: async () => [],
      explain: async () => ({ kind: "docs" as const, docs: [], truncated: false }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_describe_many(
      { engine: "mongo", tables: ["orders"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    // schemas entry exists (may be empty array or sampling result)
    expect(parsed.schemas).toBeDefined();
    expect(parsed.schemas["orders"]).toBeDefined();
    // REQ-26: warnings must include introspection-not-supported message for mongo
    expect(Array.isArray(parsed.warnings)).toBe(true);
    expect(parsed.warnings.some((w: string) => w.toLowerCase().includes("mongo"))).toBe(true);
  });
});

// ─── db_suggest_query ───────────────────────────────────────────────────────

describe("db_suggest_query", () => {
  test("unknown engine returns error", async () => {
    const deps = makeDeps();
    const result = await db_suggest_query(
      { engine: "oracle" as Engine, intent: "test", tables: ["users"] },
      deps
    );
    expect((result as any).isError).toBe(true);
  });

  test("empty tables returns error", async () => {
    const deps = makeDeps();
    const result = await db_suggest_query(
      { engine: "postgres", intent: "test", tables: [] },
      deps
    );
    expect((result as any).isError).toBe(true);
  });

  test("postgres two-table JOIN via FK — happy path", async () => {
    const fks: ForeignKey[] = [
      { from_table: "orders", from_col: "user_id", to_table: "users", to_col: "id" },
    ];
    const driver = {
      engine: "postgres" as Engine,
      connect: async () => makeConn("postgres"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      list: async () => [],
      describe: async () => [],
      explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      getForeignKeys: async () => fks,
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_suggest_query(
      { engine: "postgres", intent: "list orders with user details", tables: ["orders", "users"] },
      deps
    );

    expect((result as any).isError).toBeUndefined();
    expect((result as any).content).toBeDefined();
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.sql).toMatch(/JOIN/i);
    expect(parsed.sql).toMatch(/user_id/);
    // REQ-27: spec mandates SQL line comment format "-- intent: ..."
    expect(parsed.sql).toContain("-- intent: list orders with user details");
    expect(parsed.join_path).toHaveLength(1);
    expect(parsed.warnings).toEqual([]);
  });

  test("disconnected table generates warning, no cartesian product", async () => {
    const driver = {
      engine: "mysql" as Engine,
      connect: async () => makeConn("mysql"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      list: async () => [],
      describe: async () => [],
      explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      getForeignKeys: async () => [] as ForeignKey[], // no FK between users and reports
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_suggest_query(
      { engine: "mysql", intent: "users and reports", tables: ["users", "reports"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.sql).not.toMatch(/CROSS JOIN/i);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.warnings.some((w: string) => w.includes("reports"))).toBe(true);
  });

  test("mongo — single-collection skeleton with FK warning", async () => {
    const driver = {
      engine: "mongo" as Engine,
      connect: async () => makeConn("mongo"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "docs" as const, docs: [], truncated: false }),
      list: async () => [],
      describe: async () => [],
      explain: async () => ({ kind: "docs" as const, docs: [], truncated: false }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_suggest_query(
      { engine: "mongo", intent: "recent orders", tables: ["orders"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.sql).toMatch(/orders/);
    expect(parsed.warnings.some((w: string) => w.toLowerCase().includes("mongo"))).toBe(true);
  });

  test("redis — no-op skeleton with warning", async () => {
    const driver = {
      engine: "redis" as Engine,
      connect: async () => makeConn("redis"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "reply" as const, reply: "OK" }),
      list: async () => [],
      describe: async () => [],
      explain: async () => ({ kind: "reply" as const, reply: "OK" }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_suggest_query(
      { engine: "redis", intent: "sessions", tables: ["sessions"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.warnings.some((w: string) => w.toLowerCase().includes("redis"))).toBe(true);
  });

  test("single-table intent — simple SELECT, empty join_path", async () => {
    const driver = {
      engine: "postgres" as Engine,
      connect: async () => makeConn("postgres"),
      close: async () => {},
      ping: async () => true,
      query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      list: async () => [],
      describe: async () => [],
      explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
      getForeignKeys: async () => [] as ForeignKey[],
    };

    const deps = makeDeps({ getDriver: () => driver as any });
    const result = await db_suggest_query(
      { engine: "postgres", intent: "active users", tables: ["users"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.sql).toMatch(/SELECT/i);
    expect(parsed.sql).toMatch(/users/);
    expect(parsed.sql).toMatch(/LIMIT/i);
    expect(parsed.join_path).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });
});

// ─── db_report_run ──────────────────────────────────────────────────────────

describe("db_report_run", () => {
  test("unknown engine returns error", async () => {
    const deps = makeDeps();
    const result = await db_report_run(
      { engine: "oracle" as Engine, snippet_names: ["q1"] },
      deps
    );
    expect((result as any).isError).toBe(true);
  });

  test("empty snippet_names returns error", async () => {
    const deps = makeDeps();
    const result = await db_report_run(
      { engine: "postgres", snippet_names: [] },
      deps
    );
    expect((result as any).isError).toBe(true);
  });

  test("join mode without join_on returns error without executing", async () => {
    const snippetStore = makeSnippetStore([
      { name: "q1", engine: "postgres", body: "SELECT 1", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);
    const deps = makeDeps({ snippetStore: snippetStore as any });
    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["q1"], merge: "join" },
      deps
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/join_on/i);
  });

  test("snippet not found → captured in errors, result still returned", async () => {
    const snippetStore = makeSnippetStore([]);
    const deps = makeDeps({ snippetStore: snippetStore as any });
    const result = await db_report_run(
      { engine: "sqlite", snippet_names: ["missing-snippet"] },
      deps
    );
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].snippet_name).toBe("missing-snippet");
    expect(parsed.errors[0].message).toMatch(/not found/i);
  });

  test("object merge default — result keyed by snippet name", async () => {
    const rows1: Row[] = [{ id: 1, name: "Alice" }];
    const rows2: Row[] = [{ order_id: 10, amount: 99 }];

    const snippetStore = makeSnippetStore([
      { name: "active-users", engine: "postgres", body: "SELECT id, name FROM users", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "recent-orders", engine: "postgres", body: "SELECT order_id, amount FROM orders", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);

    let queryCallCount = 0;
    const queryResults = [rows1, rows2];

    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => {
        const r = queryResults[queryCallCount++]!;
        return { kind: "rows" as const, rows: r, truncated: false, rowCount: r.length };
      },
    });

    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["active-users", "recent-orders"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.mode).toBe("object");
    expect(parsed.result["active-users"]).toEqual(rows1);
    expect(parsed.result["recent-orders"]).toEqual(rows2);
    expect(parsed.errors).toEqual([]);
  });

  test("union merge — _source column added, null fill for missing columns", async () => {
    const rows1: Row[] = [{ id: 1, name: "Alice" }];
    const rows2: Row[] = [{ id: 2, status: "active" }];

    const snippetStore = makeSnippetStore([
      { name: "q1", engine: "sqlite", body: "SELECT id, name FROM t1", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "q2", engine: "sqlite", body: "SELECT id, status FROM t2", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);

    let callIdx = 0;
    const allRows = [rows1, rows2];

    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => {
        const r = allRows[callIdx++]!;
        return { kind: "rows" as const, rows: r, truncated: false, rowCount: r.length };
      },
    });

    const result = await db_report_run(
      { engine: "sqlite", snippet_names: ["q1", "q2"], merge: "union" },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.mode).toBe("union");
    const q1Rows = parsed.result.filter((r: any) => r._source === "q1");
    const q2Rows = parsed.result.filter((r: any) => r._source === "q2");
    expect(q1Rows[0].status).toBeNull();
    expect(q2Rows[0].name).toBeNull();
  });

  test("join merge — rows joined on key column", async () => {
    const rows1: Row[] = [{ user_id: 1, name: "Alice" }, { user_id: 2, name: "Bob" }];
    const rows2: Row[] = [{ user_id: 1, total: 100 }, { user_id: 2, total: 200 }];

    const snippetStore = makeSnippetStore([
      { name: "users-list", engine: "postgres", body: "SELECT user_id, name FROM users", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "orders-summary", engine: "postgres", body: "SELECT user_id, total FROM orders", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);

    let callIdx = 0;
    const allRows = [rows1, rows2];

    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => {
        const r = allRows[callIdx++]!;
        return { kind: "rows" as const, rows: r, truncated: false, rowCount: r.length };
      },
    });

    const result = await db_report_run(
      {
        engine: "postgres",
        snippet_names: ["users-list", "orders-summary"],
        merge: "join",
        join_on: [
          { snippet_name: "users-list", column: "user_id" },
          { snippet_name: "orders-summary", column: "user_id" },
        ],
      },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.mode).toBe("join");
    expect(parsed.result).toHaveLength(2);
    expect(parsed.result[0].total).toBeDefined();
  });
});

// ─── per-snippet write-guard ────────────────────────────────────────────────

describe("db_report_run — write-guard", () => {
  test("write-bearing snippet blocked mid-sequence when DB_REGISTRY_ALLOW_WRITE unset", async () => {
    const snippetStore = makeSnippetStore([
      { name: "read-a", engine: "postgres", body: "SELECT 1", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "write-b", engine: "postgres", body: "INSERT INTO log VALUES (1)", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "read-c", engine: "postgres", body: "SELECT 2", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);

    const executed: string[] = [];
    const deps = makeDeps({
      snippetStore: snippetStore as any,
      allowWrite: false,
      queryRunner: async (args: any) => {
        const body = args.body as string;
        if (body.includes("SELECT 1")) executed.push("read-a");
        if (body.includes("SELECT 2")) executed.push("read-c");
        return { kind: "rows" as const, rows: [], truncated: false, rowCount: 0 };
      },
    });

    // Ensure env var is NOT set
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];

    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["read-a", "write-b", "read-c"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    // write-b should be in errors
    expect(parsed.errors.some((e: any) => e.snippet_name === "write-b")).toBe(true);
    // read-c must NOT have executed (blocked after write-b)
    expect(executed).not.toContain("read-c");
  });

  test("write-bearing snippet passes when DB_REGISTRY_ALLOW_WRITE=1", async () => {
    const snippetStore = makeSnippetStore([
      { name: "insert-log", engine: "postgres", body: "INSERT INTO log VALUES (1)", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);

    const executed: string[] = [];
    const deps = makeDeps({
      snippetStore: snippetStore as any,
      allowWrite: true,
      queryRunner: async () => {
        executed.push("insert-log");
        return { kind: "rows" as const, rows: [], truncated: false, rowCount: 0 };
      },
    });

    process.env["DB_REGISTRY_ALLOW_WRITE"] = "1";
    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["insert-log"] },
      deps
    );
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.errors).toEqual([]);
    expect(executed).toContain("insert-log");
  });
});

// ─── row cap / truncation ───────────────────────────────────────────────────

describe("db_report_run — row cap", () => {
  test("3 snippets × 400 rows each → capped at 1000 with _truncated and _total_rows (union mode)", async () => {
    const make400Rows = () => Array.from({ length: 400 }, (_, i) => ({ id: i }));

    const snippetStore = makeSnippetStore([
      { name: "s1", engine: "postgres", body: "SELECT 1", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "s2", engine: "postgres", body: "SELECT 2", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "s3", engine: "postgres", body: "SELECT 3", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);

    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => {
        const rows = make400Rows();
        return { kind: "rows" as const, rows, truncated: false, rowCount: rows.length };
      },
    });

    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["s1", "s2", "s3"], merge: "union" },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed._truncated).toBe(true);
    expect(parsed._total_rows).toBe(1200);
    expect(parsed.result.length).toBeLessThanOrEqual(1000);
  });

  test("REQ-30: object mode — 4 snippets × 400 rows each → capped at 1000 with _truncated and _total_rows", async () => {
    // 4 snippets × 400 rows = 1600 total; cap at 1000
    // s1: 400, s2: 400, s3: 200 (partial — fills to 1000), s4: 0 (cap already hit → exercises total>=cap branch)
    const make400Rows = (prefix: string) => Array.from({ length: 400 }, (_, i) => ({ id: `${prefix}-${i}` }));

    const snippetStore = makeSnippetStore([
      { name: "s1", engine: "postgres", body: "SELECT 1", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "s2", engine: "postgres", body: "SELECT 2", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "s3", engine: "postgres", body: "SELECT 3", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
      { name: "s4", engine: "postgres", body: "SELECT 4", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);

    let callIdx = 0;
    const prefixes = ["s1", "s2", "s3", "s4"];
    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => {
        const rows = make400Rows(prefixes[callIdx++]!);
        return { kind: "rows" as const, rows, truncated: false, rowCount: rows.length };
      },
    });

    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["s1", "s2", "s3", "s4"], merge: "object" },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed._truncated).toBe(true);
    expect(parsed._total_rows).toBe(1600);
    // total rows across all snippet arrays must not exceed 1000
    const totalRows = Object.values(parsed.result as Record<string, unknown[]>).reduce(
      (sum, rows) => sum + rows.length,
      0
    );
    expect(totalRows).toBeLessThanOrEqual(1000);
    // s4 must have been zeroed out (total was already >= cap after s3 partial fill)
    expect(parsed.result["s4"]).toEqual([]);
  });

  test("object mode — snippets within cap do not set _truncated", async () => {
    const snippetStore = makeSnippetStore([
      { name: "small", engine: "postgres", body: "SELECT 1", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);
    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => ({
        kind: "rows" as const,
        rows: [{ id: 1 }],
        truncated: false,
        rowCount: 1,
      }),
    });

    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["small"], merge: "object" },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed._truncated).toBe(false);
    expect(parsed._total_rows).toBe(1);
  });
});

// ─── report.ts branch coverage ──────────────────────────────────────────────

describe("db_describe_many — config resolution failure", () => {
  test("resolveConfig failure returns toolError", async () => {
    const deps = makeDeps({
      resolveConfig: async () => { throw new Error("no connection configured"); },
    });
    const result = await db_describe_many(
      { engine: "postgres", tables: ["users"] },
      deps
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/config resolution failed/i);
  });
});

describe("db_suggest_query — config resolution failure", () => {
  test("resolveConfig failure returns toolError", async () => {
    const deps = makeDeps({
      resolveConfig: async () => { throw new Error("no connection configured"); },
    });
    const result = await db_suggest_query(
      { engine: "postgres", intent: "test", tables: ["users"] },
      deps
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/config resolution failed/i);
  });
});

describe("db_report_run — query runner edge cases", () => {
  test("no queryRunner provided — error captured per snippet", async () => {
    const snippetStore = makeSnippetStore([
      { name: "q1", engine: "postgres", body: "SELECT 1", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);
    // makeDeps without queryRunner override — queryRunner is undefined
    const deps: ReportDeps = {
      getDriver: makeDeps().getDriver,
      resolveConfig: makeDeps().resolveConfig,
      snippetStore: snippetStore as any,
      project: "test-project",
      allowWrite: false,
      queryRunner: undefined,
    };

    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["q1"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toMatch(/no query runner/i);
  });

  test("queryRunner returns docs — kind is 'docs'", async () => {
    const snippetStore = makeSnippetStore([
      { name: "q1", engine: "mongo", body: "db.orders.find({})", bodyKind: "mql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);
    const docs = [{ _id: "abc", value: 1 }];
    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => ({ kind: "docs" as const, docs, truncated: false }),
    });

    const result = await db_report_run(
      { engine: "mongo", snippet_names: ["q1"], merge: "object" },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.result["q1"]).toEqual(docs);
    expect(parsed.errors).toEqual([]);
  });

  test("queryRunner returns reply — kind is 'reply'", async () => {
    const snippetStore = makeSnippetStore([
      { name: "ping", engine: "redis", body: "PING", bodyKind: "cmd", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);
    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => ({ kind: "reply" as const, reply: "PONG" }),
    });

    const result = await db_report_run(
      { engine: "redis", snippet_names: ["ping"], merge: "object" },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    // reply result is wrapped as [{ reply: "PONG" }]
    expect(parsed.result["ping"]).toEqual([{ reply: "PONG" }]);
  });

  test("queryRunner throws — error captured in errors array", async () => {
    const snippetStore = makeSnippetStore([
      { name: "bad", engine: "postgres", body: "SELECT * FROM undefined_table", bodyKind: "sql", description: null, tags: null, category: null, usesCount: 0, lastUsedAt: null },
    ]);
    const deps = makeDeps({
      snippetStore: snippetStore as any,
      queryRunner: async () => { throw new Error("relation undefined_table does not exist"); },
    });

    const result = await db_report_run(
      { engine: "postgres", snippet_names: ["bad"] },
      deps
    );

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].snippet_name).toBe("bad");
    expect(parsed.errors[0].message).toMatch(/undefined_table/);
  });
});
