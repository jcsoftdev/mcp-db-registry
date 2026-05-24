import { describe, it, expect } from "bun:test";
import { SqliteDriver } from "../../src/engines/sqlite.js";

// Uses a real in-memory SQLite database — no mock needed.
const cfg = {
  engine: "sqlite" as const,
  host: "localhost",
  port: 0,
  source: {},
};

describe("SqliteDriver — connect", () => {
  it("opens an in-memory DB when no url or path provided, returns a Connection", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    expect(conn.engine).toBe("sqlite");
    expect(conn.native).toBeDefined();
    await driver.close(conn);
  });

  it("opens a file DB when cfg.url is a file path", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect({ ...cfg, url: ":memory:" });

    expect(conn.engine).toBe("sqlite");
    await driver.close(conn);
  });
});

describe("SqliteDriver — query", () => {
  it("runs a SELECT and returns a rows result", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    const result = await driver.query(conn, "SELECT 1 AS value");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows[0]).toEqual({ value: 1 });
      expect(result.truncated).toBe(false);
      expect(result.rowCount).toBe(1);
    }
    await driver.close(conn);
  });

  it("returns multiple rows with params", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    await driver.query(conn, "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    await driver.query(conn, "INSERT INTO items VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma')");
    const result = await driver.query(conn, "SELECT * FROM items WHERE id > $1", [1]);

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows.length).toBe(2);
      expect(result.rows[0]).toMatchObject({ name: "beta" });
    }
    await driver.close(conn);
  });

  it("truncates at 500 rows and sets truncated=true", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    await driver.query(conn, "CREATE TABLE nums (n INTEGER)");
    const vals = Array.from({ length: 600 }, (_, i) => `(${i})`).join(",");
    await driver.query(conn, `INSERT INTO nums VALUES ${vals}`);
    const result = await driver.query(conn, "SELECT * FROM nums");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows.length).toBe(500);
      expect(result.truncated).toBe(true);
      expect(result.rowCount).toBe(600);
    }
    await driver.close(conn);
  });
});

describe("SqliteDriver — list", () => {
  it("returns table names from sqlite_master", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    await driver.query(conn, "CREATE TABLE users (id INTEGER)");
    await driver.query(conn, "CREATE TABLE orders (id INTEGER)");
    const tables = await driver.list(conn, "tables");

    expect(tables).toContain("users");
    expect(tables).toContain("orders");
    await driver.close(conn);
  });

  it("returns empty array for an empty database", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    const tables = await driver.list(conn, "tables");

    expect(tables).toEqual([]);
    await driver.close(conn);
  });
});

describe("SqliteDriver — describe", () => {
  it("returns column info via PRAGMA table_info", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    await driver.query(conn, "CREATE TABLE events (id INTEGER NOT NULL, label TEXT)");
    const rows = await driver.describe(conn, "events");

    expect(rows.length).toBe(2);
    const idRow = rows.find((r) => (r as Record<string, unknown>)["name"] === "id");
    expect(idRow).toBeDefined();
    expect((idRow as Record<string, unknown>)["type"]).toBe("INTEGER");
    await driver.close(conn);
  });
});

describe("SqliteDriver — explain", () => {
  it("returns EXPLAIN QUERY PLAN output as rows result", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    await driver.query(conn, "CREATE TABLE logs (id INTEGER, level TEXT)");
    const result = await driver.explain(conn, "SELECT * FROM logs WHERE id = 1");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows.length).toBeGreaterThan(0);
    }
    await driver.close(conn);
  });
});

describe("SqliteDriver — ping", () => {
  it("runs SELECT 1 and returns true for a valid in-memory DB", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(true);
    await driver.close(conn);
  });
});

describe("SqliteDriver — close", () => {
  it("closes the database without error", async () => {
    const driver = new SqliteDriver();
    const conn = await driver.connect(cfg);

    await expect(driver.close(conn)).resolves.toBeUndefined();
  });
});
