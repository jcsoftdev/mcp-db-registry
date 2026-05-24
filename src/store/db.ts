import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export function openDb(path: string): Database {
  const db = new Database(path);

  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(x)");
    db.exec("DROP TABLE IF EXISTS _fts5_probe");
  } catch (err) {
    throw new Error(
      `FTS5 not available in this SQLite build; db-registry requires FTS5. (${err})`
    );
  }

  const schema = readFileSync(join(__dir, "schema.sql"), "utf8");
  db.exec(schema);

  runMigrations(db);

  return db;
}

export function runMigrations(db: Database): void {
  const row = db.query("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
  const current = row?.value ?? "1";

  if (current === "1") migrateV1ToV2(db);
}

function migrateV1ToV2(db: Database): void {
  db.transaction(() => {
    try {
      db.exec("ALTER TABLE snippets ADD COLUMN category TEXT");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }

    db.exec(`
      DROP TRIGGER IF EXISTS snippets_ai;
      DROP TRIGGER IF EXISTS snippets_au;
      DROP TRIGGER IF EXISTS snippets_ad;
    `);

    db.exec("DROP TABLE IF EXISTS snippets_fts");
    db.exec(`
      CREATE VIRTUAL TABLE snippets_fts USING fts5(
        name, description, tags, category,
        content='snippets', content_rowid='id'
      )
    `);

    db.exec(`
      CREATE TRIGGER snippets_ai AFTER INSERT ON snippets BEGIN
        INSERT INTO snippets_fts(rowid, name, description, tags, category)
        VALUES (new.id, new.name, new.description, new.tags, new.category);
      END;
      CREATE TRIGGER snippets_ad AFTER DELETE ON snippets BEGIN
        INSERT INTO snippets_fts(snippets_fts, rowid, name, description, tags, category)
        VALUES('delete', old.id, old.name, old.description, old.tags, old.category);
      END;
      CREATE TRIGGER snippets_au AFTER UPDATE ON snippets BEGIN
        INSERT INTO snippets_fts(snippets_fts, rowid, name, description, tags, category)
        VALUES('delete', old.id, old.name, old.description, old.tags, old.category);
        INSERT INTO snippets_fts(rowid, name, description, tags, category)
        VALUES (new.id, new.name, new.description, new.tags, new.category);
      END;
    `);

    db.exec("INSERT INTO snippets_fts(snippets_fts) VALUES('rebuild')");

    db.exec("UPDATE meta SET value='2' WHERE key='schema_version'");
  })();
}

export function closeDb(db: Database): void {
  try {
    db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
  } catch {
    // in-memory DBs don't support fileControl — ignore
  }
  db.close();
}

const constants = {
  SQLITE_FCNTL_PERSIST_WAL: 10,
};
