/**
 * MySQL integration smoke test.
 * Skipped unless INTEGRATION=1 env var is set.
 * Requires a running MySQL at localhost:3307 (see docker-compose.test.yml).
 */
import { describe, it, expect } from "bun:test";

const RUN = !!process.env["INTEGRATION"];

describe.skipIf(!RUN)("mysql integration smoke", () => {
  it("connects and executes SELECT 1", async () => {
    const { MysqlDriver } = await import("../../src/engines/mysql.js");
    const driver = new MysqlDriver();
    const config = {
      host: "localhost",
      port: 3307,
      database: "testdb",
      user: "testuser",
      password: "testpass",
    };

    const conn = await driver.connect(config as Parameters<typeof driver.connect>[0]);
    try {
      const result = await driver.query(conn, "SELECT 1 AS val");
      expect(result.rows).toHaveLength(1);
      const val = (result.rows[0] as Record<string, unknown>)["val"];
      expect(Number(val)).toBe(1);
    } finally {
      await driver.close(conn);
    }
  });

  it("lists tables without error", async () => {
    const { MysqlDriver } = await import("../../src/engines/mysql.js");
    const driver = new MysqlDriver();
    const config = {
      host: "localhost",
      port: 3307,
      database: "testdb",
      user: "testuser",
      password: "testpass",
    };

    const conn = await driver.connect(config as Parameters<typeof driver.connect>[0]);
    try {
      const result = await driver.list(conn, "tables");
      expect(Array.isArray(result.rows)).toBe(true);
    } finally {
      await driver.close(conn);
    }
  });

  it("blocks write query when write guard is active", async () => {
    const { isReadOnlySql } = await import("../../src/safety/sql.js");
    expect(isReadOnlySql("DELETE FROM users WHERE 1=1")).toBe(false);
    expect(isReadOnlySql("SHOW TABLES")).toBe(true);
  });
});
