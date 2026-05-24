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

  return db;
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
