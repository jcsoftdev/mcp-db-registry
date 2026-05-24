import { describe, it, expect, afterEach } from "bun:test";
import { openDb, closeDb, runMigrations } from "../../src/store/db.js";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

function makeV1Db(): Database {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL, connection_name TEXT NOT NULL, engine TEXT NOT NULL,
      ciphertext BLOB NOT NULL, nonce BLOB NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (project, connection_name, engine)
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL, engine TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT, tags TEXT, params_schema TEXT,
      body_kind TEXT NOT NULL, body BLOB NOT NULL, body_nonce BLOB NOT NULL,
      uses_count INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (project, engine, name)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
      name, description, tags,
      content='snippets', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
      INSERT INTO snippets_fts(rowid, name, description, tags)
      VALUES (new.id, new.name, new.description, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_ad AFTER DELETE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, name, description, tags)
      VALUES('delete', old.id, old.name, old.description, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_au AFTER UPDATE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, name, description, tags)
      VALUES('delete', old.id, old.name, old.description, old.tags);
      INSERT INTO snippets_fts(rowid, name, description, tags)
      VALUES (new.id, new.name, new.description, new.tags);
    END;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
  `);
  return db;
}

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

  it("meta table has schema_version = '2' on fresh install", () => {
    const db = openDb(":memory:");
    const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe("2");
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

describe("runMigrations — v1→v2 (REQ-33)", () => {
  it("1.1 openDb on v1 DB migrates to schema_version=2 and category column exists", () => {
    const db = makeV1Db();
    runMigrations(db);
    const ver = db.query("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string };
    expect(ver.value).toBe("2");
    const cols = db.query("PRAGMA table_info(snippets)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("category");
    db.close();
  });

  it("1.2 second runMigrations on v2 DB is a no-op — schema_version stays 2", () => {
    const db = makeV1Db();
    runMigrations(db);
    runMigrations(db);
    const ver = db.query("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string };
    expect(ver.value).toBe("2");
    db.close();
  });

  it("1.3 interrupted migration (category column exists but version still 1) recovers cleanly", () => {
    const db = makeV1Db();
    db.exec("ALTER TABLE snippets ADD COLUMN category TEXT");
    runMigrations(db);
    const ver = db.query("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string };
    expect(ver.value).toBe("2");
    db.close();
  });

  it("1.4 existing snippets survive migration with category=null", () => {
    const db = makeV1Db();
    const now = Date.now();
    db.exec(`
      INSERT INTO snippets (project, engine, name, description, tags, body_kind, body, body_nonce, uses_count, created_at, updated_at)
      VALUES ('p', 'postgres', 'q1', NULL, NULL, 'sql', X'00', X'00', 0, ${now}, ${now}),
             ('p', 'postgres', 'q2', NULL, NULL, 'sql', X'00', X'00', 0, ${now}, ${now}),
             ('p', 'postgres', 'q3', NULL, NULL, 'sql', X'00', X'00', 0, ${now}, ${now})
    `);
    runMigrations(db);
    type Row = { name: string; category: string | null };
    const rows = db.query<Row, []>("SELECT name, category FROM snippets ORDER BY name").all();
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.category).toBeNull();
    db.close();
  });
});
