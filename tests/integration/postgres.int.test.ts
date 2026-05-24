/**
 * Postgres integration smoke test.
 * Skipped unless INTEGRATION=1 env var is set.
 * Requires a running Postgres at localhost:5433 (see docker-compose.test.yml).
 */
import { describe, it, expect } from "bun:test";

const RUN = !!process.env["INTEGRATION"];

describe.skipIf(!RUN)("postgres integration smoke", () => {
  it("connects and executes SELECT 1", async () => {
    const { PostgresDriver } = await import("../../src/engines/postgres.js");
    const driver = new PostgresDriver();
    const config = {
      host: "localhost",
      port: 5433,
      database: "testdb",
      user: "testuser",
      password: "testpass",
    };

    const conn = await driver.connect(config as Parameters<typeof driver.connect>[0]);
    try {
      const result = await driver.query(conn, "SELECT 1 AS val");
      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as Record<string, unknown>)["val"]).toBe(1);
    } finally {
      await driver.close(conn);
    }
  });

  it("lists tables without error", async () => {
    const { PostgresDriver } = await import("../../src/engines/postgres.js");
    const driver = new PostgresDriver();
    const config = {
      host: "localhost",
      port: 5433,
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
    expect(isReadOnlySql("INSERT INTO foo VALUES (1)")).toBe(false);
    expect(isReadOnlySql("SELECT 1")).toBe(true);
  });
});
