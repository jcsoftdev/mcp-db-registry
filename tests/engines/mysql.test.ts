import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock mysql2/promise before importing the driver.
// createConnection returns a connection object with execute, query, end methods.
const mockExecute = mock(() => Promise.resolve([[{ id: 1, name: "Bob" }], []]));
const mockEnd = mock(() => Promise.resolve());

const mockConnection = {
  execute: mockExecute,
  query: mock(() => Promise.resolve([[{ "QUERY PLAN": "full scan" }], []])),
  end: mockEnd,
};

const mockCreateConnection = mock(() => Promise.resolve(mockConnection));

mock.module("mysql2/promise", () => ({ default: { createConnection: mockCreateConnection } }));

const { MysqlDriver } = await import("../../src/engines/mysql.js");

const cfg = {
  engine: "mysql" as const,
  host: "localhost",
  port: 3306,
  user: "root",
  password: "secret",
  database: "testdb",
  source: {},
};

describe("MysqlDriver — connect", () => {
  beforeEach(() => {
    mockCreateConnection.mockReset();
    mockCreateConnection.mockResolvedValue(mockConnection);
  });

  it("calls createConnection with the resolved config and returns a Connection", async () => {
    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);

    expect(mockCreateConnection.mock.calls.length).toBe(1);
    const calledWith = mockCreateConnection.mock.calls[0][0] as Record<string, unknown>;
    expect(calledWith.host).toBe("localhost");
    expect(calledWith.port).toBe(3306);
    expect(calledWith.database).toBe("testdb");
    expect(conn.engine).toBe("mysql");
  });

  it("stores the raw connection as native on the Connection handle", async () => {
    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    expect(conn.native).toBe(mockConnection);
  });
});

describe("MysqlDriver — query", () => {
  beforeEach(() => mockExecute.mockReset());

  it("calls execute with body+params and returns rows result", async () => {
    mockExecute.mockResolvedValue([[{ id: 1 }, { id: 2 }], []]);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "SELECT id FROM users WHERE active = ?", [1]);

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
    }
    expect(mockExecute.mock.calls[0][0]).toBe("SELECT id FROM users WHERE active = ?");
    expect(mockExecute.mock.calls[0][1]).toEqual([1]);
  });

  it("truncates at 500 rows and sets truncated=true", async () => {
    const manyRows = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    mockExecute.mockResolvedValue([manyRows, []]);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "SELECT id FROM big_table");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows.length).toBe(500);
      expect(result.truncated).toBe(true);
      expect(result.rowCount).toBe(600);
    }
  });
});

describe("MysqlDriver — list", () => {
  it("returns table names from SHOW TABLES", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[{ Tables_in_testdb: "users" }, { Tables_in_testdb: "orders" }], []]);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const tables = await driver.list(conn, "tables");

    expect(tables).toEqual(["users", "orders"]);
    const sql = mockExecute.mock.calls[0][0] as string;
    expect(sql.toUpperCase()).toContain("SHOW TABLES");
  });

  it("returns index names when kind='indexes'", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[{ Key_name: "PRIMARY" }, { Key_name: "idx_email" }], []]);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const indexes = await driver.list(conn, "indexes");

    expect(indexes).toEqual(["PRIMARY", "idx_email"]);
  });
});

describe("MysqlDriver — describe", () => {
  it("returns column metadata for a given table via DESCRIBE", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([
      [{ Field: "id", Type: "int", Null: "NO" }, { Field: "name", Type: "varchar(255)", Null: "YES" }],
      [],
    ]);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const rows = await driver.describe(conn, "users");

    expect(rows.length).toBe(2);
    expect((rows[0] as Record<string, unknown>)["Field"]).toBe("id");
    expect((rows[1] as Record<string, unknown>)["Type"]).toBe("varchar(255)");
  });
});

describe("MysqlDriver — explain", () => {
  it("runs EXPLAIN and returns a rows result", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[{ id: 1, select_type: "SIMPLE", table: "users" }], []]);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.explain(conn, "SELECT * FROM users");

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows[0]).toMatchObject({ select_type: "SIMPLE" });
    }
    const sql = mockExecute.mock.calls[0][0] as string;
    expect(sql.toUpperCase()).toContain("EXPLAIN");
  });
});

describe("MysqlDriver — ping", () => {
  it("runs SELECT 1 and returns true on success", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[{ "1": 1 }], []]);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(true);
  });

  it("returns false when execute throws", async () => {
    mockExecute.mockReset();
    mockExecute.mockRejectedValue(new Error("ECONNREFUSED"));

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(false);
  });
});

describe("MysqlDriver — close", () => {
  it("calls connection.end() to release the connection", async () => {
    mockEnd.mockReset();
    mockEnd.mockResolvedValue(undefined);

    const driver = new MysqlDriver();
    const conn = await driver.connect(cfg);
    await driver.close(conn);

    expect(mockEnd.mock.calls.length).toBe(1);
  });
});
