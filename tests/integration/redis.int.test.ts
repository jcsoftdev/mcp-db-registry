/**
 * Redis integration smoke test.
 * Skipped unless INTEGRATION=1 env var is set.
 * Requires a running Redis at localhost:6380 (see docker-compose.test.yml).
 */
import { describe, it, expect } from "bun:test";

const RUN = !!process.env["INTEGRATION"];

describe.skipIf(!RUN)("redis integration smoke", () => {
  it("connects and executes PING", async () => {
    const { RedisDriver } = await import("../../src/engines/redis.js");
    const driver = new RedisDriver();
    const config = {
      host: "localhost",
      port: 6380,
    };

    const conn = await driver.connect(config as Parameters<typeof driver.connect>[0]);
    try {
      const result = await driver.query(conn, "PING");
      expect(result.rows).toHaveLength(1);
      const reply = (result.rows[0] as Record<string, unknown>)["reply"];
      expect(reply).toBe("PONG");
    } finally {
      await driver.close(conn);
    }
  });

  it("lists keys with db_list", async () => {
    const { RedisDriver } = await import("../../src/engines/redis.js");
    const driver = new RedisDriver();
    const config = {
      host: "localhost",
      port: 6380,
    };

    const conn = await driver.connect(config as Parameters<typeof driver.connect>[0]);
    try {
      const result = await driver.list(conn, "keys");
      expect(Array.isArray(result.rows)).toBe(true);
    } finally {
      await driver.close(conn);
    }
  });

  it("blocks SET command when write guard is active", async () => {
    const { isReadOnlyRedisCmd } = await import("../../src/safety/redis.js");
    expect(isReadOnlyRedisCmd("SET foo bar")).toBe(false);
    expect(isReadOnlyRedisCmd("GET foo")).toBe(true);
  });
});
