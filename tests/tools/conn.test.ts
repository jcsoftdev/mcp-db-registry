import { describe, test, expect } from "bun:test";
import type { Engine } from "../../src/types.js";

type SaveOpts = { project: string; engine: Engine; connectionName: string; dsn: string };
type GetOpts = { project: string; engine: Engine; connectionName: string };

function makeCredStore() {
  const store = new Map<string, string>();
  return {
    async save(opts: SaveOpts) {
      store.set(`${opts.engine}::${opts.connectionName}`, opts.dsn);
    },
    async get(opts: GetOpts) {
      return store.get(`${opts.engine}::${opts.connectionName}`) ?? null;
    },
    async clear(opts: GetOpts) {
      store.delete(`${opts.engine}::${opts.connectionName}`);
    },
  };
}

async function importConnTools() {
  return await import("../../src/tools/creds.js");
}

const PROJECT = "test-project";

describe("creds tools — db_credentials_save", () => {
  test("saves credential via dsn field and returns saved:true", async () => {
    const { db_credentials_save } = await importConnTools();
    const credStore = makeCredStore();
    const result = await db_credentials_save(
      { engine: "postgres", dsn: "postgres://user:pass@host:5432/db" },
      { project: PROJECT, credStore }
    );
    expect((result as { saved: boolean }).saved).toBe(true);
    const retrieved = await credStore.get({ project: PROJECT, engine: "postgres", connectionName: "main" });
    expect(retrieved).toBe("postgres://user:pass@host:5432/db");
  });

  test("overwrites existing credential for same engine+name", async () => {
    const { db_credentials_save } = await importConnTools();
    const credStore = makeCredStore();
    await db_credentials_save(
      { engine: "postgres", dsn: "postgres://old:old@host:5432/db" },
      { project: PROJECT, credStore }
    );
    const result = await db_credentials_save(
      { engine: "postgres", dsn: "postgres://new:new@host:5432/db", name: "main" },
      { project: PROJECT, credStore }
    );
    expect((result as { saved: boolean }).saved).toBe(true);
    const retrieved = await credStore.get({ project: PROJECT, engine: "postgres", connectionName: "main" });
    expect(retrieved).toBe("postgres://new:new@host:5432/db");
  });

  test("password not exposed in return value", async () => {
    const { db_credentials_save } = await importConnTools();
    const credStore = makeCredStore();
    const result = await db_credentials_save(
      { engine: "mongo", dsn: "mongodb://user:supersecret@host:27017/db" },
      { project: PROJECT, credStore }
    );
    const r = result as Record<string, unknown>;
    expect(r.saved).toBe(true);
    const resultStr = JSON.stringify(r);
    expect(resultStr).not.toContain("supersecret");
  });
});

describe("creds tools — db_credentials_clear", () => {
  test("clears credential and returns cleared:true", async () => {
    const { db_credentials_clear } = await importConnTools();
    const credStore = makeCredStore();
    await credStore.save({ project: PROJECT, engine: "mysql", connectionName: "main", dsn: "mysql://user:pass@host:3306/db" });
    const result = await db_credentials_clear(
      { engine: "mysql" },
      { project: PROJECT, credStore }
    );
    expect((result as { cleared: boolean }).cleared).toBe(true);
    const retrieved = await credStore.get({ project: PROJECT, engine: "mysql", connectionName: "main" });
    expect(retrieved).toBeNull();
  });

  test("clearing non-existent credential returns cleared:true (idempotent)", async () => {
    const { db_credentials_clear } = await importConnTools();
    const credStore = makeCredStore();
    const result = await db_credentials_clear(
      { engine: "redis" },
      { project: PROJECT, credStore }
    );
    expect((result as { cleared: boolean }).cleared).toBe(true);
  });
});
