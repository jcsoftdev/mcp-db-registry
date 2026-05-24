import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openDb, closeDb } from "../../src/store/db.js";
import { CredentialsStore } from "../../src/store/credentials.js";
import type { Database } from "bun:sqlite";

describe("CredentialsStore", () => {
  let db: Database;
  let store: CredentialsStore;
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32));

  beforeEach(() => {
    db = openDb(":memory:");
    store = new CredentialsStore(db, key);
  });

  afterEach(() => closeDb(db));

  it("save then get returns decrypted DSN", async () => {
    await store.save({ project: "proj", engine: "postgres", connectionName: "main", dsn: "postgres://user:pass@host:5432/db" });
    const result = await store.get({ project: "proj", engine: "postgres", connectionName: "main" });
    expect(result).toBe("postgres://user:pass@host:5432/db");
  });

  it("get returns null for non-existent credential", async () => {
    const result = await store.get({ project: "proj", engine: "postgres", connectionName: "missing" });
    expect(result).toBeNull();
  });

  it("overwrite updates the stored value", async () => {
    await store.save({ project: "proj", engine: "postgres", connectionName: "main", dsn: "postgres://old" });
    await store.save({ project: "proj", engine: "postgres", connectionName: "main", dsn: "postgres://new" });
    const result = await store.get({ project: "proj", engine: "postgres", connectionName: "main" });
    expect(result).toBe("postgres://new");
  });

  it("clear removes the record", async () => {
    await store.save({ project: "proj", engine: "postgres", connectionName: "main", dsn: "postgres://x" });
    await store.clear({ project: "proj", engine: "postgres", connectionName: "main" });
    const result = await store.get({ project: "proj", engine: "postgres", connectionName: "main" });
    expect(result).toBeNull();
  });

  it("different (project, engine, name) keys don't collide", async () => {
    await store.save({ project: "a", engine: "postgres", connectionName: "main", dsn: "postgres://a" });
    await store.save({ project: "b", engine: "postgres", connectionName: "main", dsn: "postgres://b" });
    await store.save({ project: "a", engine: "mysql", connectionName: "main", dsn: "mysql://a" });
    await store.save({ project: "a", engine: "postgres", connectionName: "other", dsn: "postgres://other" });

    expect(await store.get({ project: "a", engine: "postgres", connectionName: "main" })).toBe("postgres://a");
    expect(await store.get({ project: "b", engine: "postgres", connectionName: "main" })).toBe("postgres://b");
    expect(await store.get({ project: "a", engine: "mysql", connectionName: "main" })).toBe("mysql://a");
    expect(await store.get({ project: "a", engine: "postgres", connectionName: "other" })).toBe("postgres://other");
  });

  it("body is encrypted at rest — raw BLOB differs from plaintext", async () => {
    const dsn = "postgres://user:secret@host:5432/db";
    await store.save({ project: "proj", engine: "postgres", connectionName: "enc-test", dsn });

    const row = db.query<{ ciphertext: Uint8Array }, []>(
      "SELECT ciphertext FROM credentials WHERE connection_name = 'enc-test'"
    ).get();

    expect(row).not.toBeNull();
    const raw = Buffer.from(row!.ciphertext).toString("utf8");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain(dsn);
  });
});
