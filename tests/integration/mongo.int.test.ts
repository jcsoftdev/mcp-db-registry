/**
 * MongoDB integration smoke test.
 * Skipped unless INTEGRATION=1 env var is set.
 * Requires a running Mongo at localhost:27018 (see docker-compose.test.yml).
 */
import { describe, it, expect } from "bun:test";

const RUN = !!process.env["INTEGRATION"];

describe.skipIf(!RUN)("mongo integration smoke", () => {
  it("connects and executes a find", async () => {
    const { MongoDriver } = await import("../../src/engines/mongo.js");
    const driver = new MongoDriver();
    const config = {
      host: "localhost",
      port: 27018,
      database: "testdb",
    };

    const conn = await driver.connect(config as Parameters<typeof driver.connect>[0]);
    try {
      const result = await driver.query(conn, '{"find":"__test__","filter":{}}');
      expect(Array.isArray(result.rows)).toBe(true);
    } finally {
      await driver.close(conn);
    }
  });

  it("lists collections without error", async () => {
    const { MongoDriver } = await import("../../src/engines/mongo.js");
    const driver = new MongoDriver();
    const config = {
      host: "localhost",
      port: 27018,
      database: "testdb",
    };

    const conn = await driver.connect(config as Parameters<typeof driver.connect>[0]);
    try {
      const result = await driver.list(conn, "collections");
      expect(Array.isArray(result.rows)).toBe(true);
    } finally {
      await driver.close(conn);
    }
  });

  it("blocks $set mutation when write guard is active", async () => {
    const { isReadOnlyMongoOp } = await import("../../src/safety/mongo.js");
    expect(isReadOnlyMongoOp('{"update":"col","updates":[{"q":{},"u":{"$set":{"x":1}}}]}')).toBe(false);
    expect(isReadOnlyMongoOp('{"find":"col","filter":{}}')).toBe(true);
  });
});
