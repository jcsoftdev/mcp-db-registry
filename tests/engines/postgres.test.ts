import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock the postgres package before importing the driver.
// The postgres package exports a default function that returns a tagged-template sql object.
const mockRows = [{ id: 1, name: "Alice" }];

const mockSql = mock(() => Promise.resolve(mockRows));
// sql.unsafe returns rows too
(mockSql as any).unsafe = mock((_sql: string, _params?: unknown[]) =>
  Promise.resolve(mockRows)
);
// sql.end closes the connection
(mockSql as any).end = mock(() => Promise.resolve());

const mockPostgres = mock((_config: unknown) => mockSql);

mock.module("postgres", () => ({ default: mockPostgres }));

const { PostgresDriver } = await import("../../src/engines/postgres.js");

const cfg = {
  engine: "postgres" as const,
  host: "localhost",
  port: 5432,
  user: "user",
  password: "secret",
  database: "testdb",
  source: {},
};

describe("PostgresDriver — connect", () => {
  beforeEach(() => {
    mockPostgres.mockReset();
    mockPostgres.mockImplementation((_config: unknown) => mockSql);
  });

  it("calls postgres() with the resolved config and returns a Connection", async () => {
    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);

    expect(mockPostgres.mock.calls.length).toBe(1);
    const calledWith = mockPostgres.mock.calls[0][0] as Record<string, unknown>;
    expect(calledWith.host).toBe("localhost");
    expect(calledWith.port).toBe(5432);
    expect(calledWith.database).toBe("testdb");
    expect(conn.engine).toBe("postgres");
    expect(conn.native).toBe(mockSql);
  });

  it("sets max:1 so each Connection wraps a single-connection pool", async () => {
    const driver = new PostgresDriver();
    await driver.connect(cfg);

    const calledWith = mockPostgres.mock.calls[0][0] as Record<string, unknown>;
    expect(calledWith.max).toBe(1);
  });
});

describe("PostgresDriver — query", () => {
  it("calls sql.unsafe with the body and params, returns rows result", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "SELECT id FROM users WHERE id = $1", [1]);

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
    }
    expect((mockSql as any).unsafe.mock.calls[0][0]).toBe("SELECT id FROM users WHERE id = $1");
    expect((mockSql as any).unsafe.mock.calls[0][1]).toEqual([1]);
  });

  it("truncates at 500 rows and sets truncated=true", async () => {
    const manyRows = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue(manyRows);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "SELECT id FROM big_table");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows.length).toBe(500);
      expect(result.truncated).toBe(true);
      expect(result.rowCount).toBe(600);
    }
  });

  it("returns rows with no params (query without parameters)", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([{ count: 42 }]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "SELECT COUNT(*) AS count FROM users");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows[0]).toEqual({ count: 42 });
      expect(result.truncated).toBe(false);
    }
  });
});

describe("PostgresDriver — list", () => {
  it("returns table names from information_schema", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([
      { table_name: "users" },
      { table_name: "orders" },
    ]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const tables = await driver.list(conn, "tables");

    expect(tables).toEqual(["users", "orders"]);
    const sql = (mockSql as any).unsafe.mock.calls[0][0] as string;
    expect(sql).toContain("information_schema");
  });

  it("returns index names when kind='indexes'", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([
      { indexname: "idx_users_email" },
    ]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const indexes = await driver.list(conn, "indexes");

    expect(indexes).toEqual(["idx_users_email"]);
  });
});

describe("PostgresDriver — describe", () => {
  it("returns column metadata for a given table", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([
      { column_name: "id", data_type: "integer", is_nullable: "NO" },
      { column_name: "name", data_type: "text", is_nullable: "YES" },
    ]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const rows = await driver.describe(conn, "users");

    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ column_name: "id", data_type: "integer" });
    expect(rows[1]).toMatchObject({ column_name: "name", is_nullable: "YES" });
  });
});

describe("PostgresDriver — explain", () => {
  it("runs EXPLAIN and returns a rows result with the plan text", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([
      { "QUERY PLAN": "Seq Scan on users (cost=0.00..10.00 rows=100)" },
    ]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.explain(conn, "SELECT * FROM users");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect((result.rows[0] as Record<string, unknown>)["QUERY PLAN"]).toContain("Seq Scan");
    }
    const sql = (mockSql as any).unsafe.mock.calls[0][0] as string;
    expect(sql.toUpperCase()).toContain("EXPLAIN");
  });
});

describe("PostgresDriver — ping", () => {
  it("runs SELECT 1 and returns true on success", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([{ "?column?": 1 }]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(true);
  });

  it("returns false when the query throws", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockRejectedValue(new Error("connection refused"));

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(false);
  });
});

describe("PostgresDriver — close", () => {
  it("calls sql.end() to close the underlying connection", async () => {
    (mockSql as any).end.mockReset();
    (mockSql as any).end.mockResolvedValue(undefined);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    await driver.close(conn);

    expect((mockSql as any).end.mock.calls.length).toBe(1);
  });
});

describe("PostgresDriver — getForeignKeys", () => {
  it("calls information_schema query with tables array and returns decoded FK edges", async () => {
    const fkRows = [
      { from_table: "orders", from_col: "user_id", to_table: "users", to_col: "id" },
      { from_table: "line_items", from_col: "order_id", to_table: "orders", to_col: "id" },
    ];
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue(fkRows);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const fks = await driver.getForeignKeys(conn, ["orders", "line_items"]);

    expect(fks).toEqual(fkRows);
    const callArgs = (mockSql as any).unsafe.mock.calls[0];
    const sql = callArgs[0] as string;
    const params = callArgs[1] as unknown[];
    expect(sql).toContain("information_schema");
    expect(sql).toContain("FOREIGN KEY");
    expect(sql).toContain("ANY($1)");
    expect(params).toEqual([["orders", "line_items"]]);
  });

  it("returns empty array without querying when tables is empty", async () => {
    (mockSql as any).unsafe.mockReset();

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const fks = await driver.getForeignKeys(conn, []);

    expect(fks).toEqual([]);
    expect((mockSql as any).unsafe.mock.calls.length).toBe(0);
  });

  it("returns empty array when no FK constraints match", async () => {
    (mockSql as any).unsafe.mockReset();
    (mockSql as any).unsafe.mockResolvedValue([]);

    const driver = new PostgresDriver();
    const conn = await driver.connect(cfg);
    const fks = await driver.getForeignKeys(conn, ["standalone_table"]);

    expect(fks).toEqual([]);
  });
});
