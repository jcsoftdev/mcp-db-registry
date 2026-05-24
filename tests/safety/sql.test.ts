import { describe, it, expect } from "bun:test";
import { isReadOnlySql } from "../../src/safety/sql.js";

describe("isReadOnlySql — read-only queries pass", () => {
  it("SELECT is read-only", () => {
    expect(isReadOnlySql("SELECT * FROM users")).toBe(true);
  });

  it("SELECT with leading whitespace is read-only", () => {
    expect(isReadOnlySql("   SELECT id FROM t")).toBe(true);
  });

  it("SHOW is read-only", () => {
    expect(isReadOnlySql("SHOW TABLES")).toBe(true);
  });

  it("EXPLAIN is read-only", () => {
    expect(isReadOnlySql("EXPLAIN SELECT * FROM t")).toBe(true);
  });

  it("DESCRIBE is read-only", () => {
    expect(isReadOnlySql("DESCRIBE users")).toBe(true);
  });

  it("PRAGMA is read-only", () => {
    expect(isReadOnlySql("PRAGMA table_info('users')")).toBe(true);
  });

  it("case-insensitive: select is read-only", () => {
    expect(isReadOnlySql("select id from users")).toBe(true);
  });
});

describe("isReadOnlySql — write queries blocked", () => {
  it("INSERT is blocked", () => {
    expect(isReadOnlySql("INSERT INTO logs VALUES (1, 'msg')")).toBe(false);
  });

  it("UPDATE is blocked", () => {
    expect(isReadOnlySql("UPDATE users SET name = 'x' WHERE id = 1")).toBe(false);
  });

  it("DELETE is blocked", () => {
    expect(isReadOnlySql("DELETE FROM sessions WHERE expired = true")).toBe(false);
  });

  it("DROP is blocked", () => {
    expect(isReadOnlySql("DROP TABLE temp")).toBe(false);
  });

  it("CREATE is blocked", () => {
    expect(isReadOnlySql("CREATE TABLE new_table (id INT)")).toBe(false);
  });

  it("ALTER is blocked", () => {
    expect(isReadOnlySql("ALTER TABLE users ADD COLUMN phone TEXT")).toBe(false);
  });

  it("TRUNCATE is blocked", () => {
    expect(isReadOnlySql("TRUNCATE TABLE logs")).toBe(false);
  });

  it("REPLACE is blocked", () => {
    expect(isReadOnlySql("REPLACE INTO t VALUES (1, 'x')")).toBe(false);
  });

  it("MERGE is blocked", () => {
    expect(isReadOnlySql("MERGE INTO target USING source ON ...")).toBe(false);
  });

  it("case-insensitive: insert is blocked", () => {
    expect(isReadOnlySql("insert into t values (1)")).toBe(false);
  });
});

describe("isReadOnlySql — CTE (WITH) handling", () => {
  it("CTE-only SELECT is read-only", () => {
    expect(isReadOnlySql("WITH cte AS (SELECT id FROM t) SELECT * FROM cte")).toBe(true);
  });

  it("CTE-prefixed DELETE is blocked", () => {
    expect(isReadOnlySql("WITH cte AS (SELECT id FROM logs WHERE old = true) DELETE FROM logs WHERE id IN (SELECT id FROM cte)")).toBe(false);
  });

  it("CTE-prefixed INSERT is blocked", () => {
    expect(isReadOnlySql("WITH src AS (SELECT * FROM staging) INSERT INTO prod SELECT * FROM src")).toBe(false);
  });

  it("CTE-prefixed UPDATE is blocked", () => {
    expect(isReadOnlySql("WITH vals AS (SELECT 1 AS x) UPDATE t SET col = x FROM vals")).toBe(false);
  });

  it("case-insensitive WITH: with cte ... delete is blocked", () => {
    expect(isReadOnlySql("with cte as (select 1) delete from t")).toBe(false);
  });
});

describe("isReadOnlySql — comments before first token", () => {
  it("-- line comment before SELECT is read-only", () => {
    expect(isReadOnlySql("-- get users\nSELECT * FROM users")).toBe(true);
  });

  it("/* block comment */ before INSERT is blocked", () => {
    expect(isReadOnlySql("/* admin op */\nINSERT INTO t VALUES (1)")).toBe(false);
  });
});
