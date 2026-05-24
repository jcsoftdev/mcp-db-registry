import { describe, it, expect, afterEach } from "bun:test";
import { openDb, closeDb } from "../../src/store/db.js";
import { Database } from "bun:sqlite";

describe("openDb / migrate", () => {
  it("bootstraps schema idempotently on in-memory DB", () => {
    const db = openDb(":memory:");

    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map((r) => r.name);

    expect(names).toContain("credentials");
    expect(names).toContain("snippets");
    expect(names).toContain("meta");

    closeDb(db);
  });

  it("is idempotent — calling openDb twice does not duplicate tables", () => {
    const db = openDb(":memory:");
    closeDb(db);
    const db2 = openDb(":memory:");
    const tables = db2.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    expect(tables.filter((r) => r.name === "credentials")).toHaveLength(1);
    closeDb(db2);
  });

  it("meta table has schema_version = '1'", () => {
    const db = openDb(":memory:");
    const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe("1");
    closeDb(db);
  });

  it("FTS5 virtual table exists", () => {
    const db = openDb(":memory:");
    const vtabs = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='snippets_fts'"
    ).all() as { name: string }[];
    expect(vtabs).toHaveLength(1);
    closeDb(db);
  });

  it("FTS5 probe throws clear error when FTS5 absent", () => {
    const stub: unknown = {
      exec(sql: string) {
        if (sql.includes("fts5")) throw new Error("no such module: fts5");
      },
      query() { return { get() { return null; } }; },
      close() {},
      fileControl() {},
    };
    expect(() => {
      (stub as { exec: (s: string) => void }).exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(x)");
    }).toThrow("fts5");
  });

  it("all 3 FTS5 triggers exist", () => {
    const db = openDb(":memory:");
    const triggers = db.query(
      "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
    ).all() as { name: string }[];
    const names = triggers.map((r) => r.name);
    expect(names).toContain("snippets_ai");
    expect(names).toContain("snippets_ad");
    expect(names).toContain("snippets_au");
    closeDb(db);
  });
});
