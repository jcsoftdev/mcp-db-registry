PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS credentials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project         TEXT    NOT NULL,
  connection_name TEXT    NOT NULL,
  engine          TEXT    NOT NULL CHECK (engine IN ('postgres','mysql','mongo','redis','sqlite')),
  ciphertext      BLOB    NOT NULL,
  nonce           BLOB    NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (project, connection_name, engine)
);
CREATE INDEX IF NOT EXISTS idx_credentials_project ON credentials(project);

CREATE TABLE IF NOT EXISTS snippets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project       TEXT    NOT NULL,
  engine        TEXT    NOT NULL CHECK (engine IN ('postgres','mysql','mongo','redis','sqlite')),
  name          TEXT    NOT NULL,
  description   TEXT,
  tags          TEXT,
  params_schema TEXT,
  body_kind     TEXT    NOT NULL CHECK (body_kind IN ('sql','mongo-op','redis-cmd')),
  body          BLOB    NOT NULL,
  body_nonce    BLOB    NOT NULL,
  uses_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (project, engine, name)
);
CREATE INDEX IF NOT EXISTS idx_snippets_project_engine ON snippets(project, engine);

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
