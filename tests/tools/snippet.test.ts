import { describe, test, expect } from "bun:test";
import type { Engine } from "../../src/types.js";

type SnippetRecord = {
  name: string;
  engine: Engine;
  body: string;
  description?: string | null;
  tags?: string[] | null;
  usesCount?: number;
  lastUsedAt?: number | null;
};

function makeSnippetStore(initial: SnippetRecord[] = []) {
  const store = new Map<string, SnippetRecord & { usesCount: number; lastUsedAt: number | null }>();
  for (const s of initial) {
    store.set(`${s.engine}::${s.name}`, { ...s, usesCount: s.usesCount ?? 0, lastUsedAt: s.lastUsedAt ?? null });
  }

  return {
    async save(opts: SaveOpts) {
      const key = `${opts.engine}::${opts.name}`;
      const existing = store.get(key);
      store.set(key, {
        name: opts.name,
        engine: opts.engine,
        body: opts.body,
        description: opts.description ?? null,
        tags: opts.tags ?? null,
        usesCount: existing?.usesCount ?? 0,
        lastUsedAt: existing?.lastUsedAt ?? null,
      });
    },
    async get(key: { project: string; engine: Engine; name: string }) {
      const r = store.get(`${key.engine}::${key.name}`);
      if (!r) return null;
      return { ...r, bodyKind: "sql", tags: Array.isArray(r.tags) ? r.tags.join(",") : r.tags };
    },
    async list(opts: { project: string; engine?: Engine }) {
      const items = [...store.values()];
      const filtered = opts.engine ? items.filter((i) => i.engine === opts.engine) : items;
      return filtered.map((r) => ({
        name: r.name,
        engine: r.engine,
        description: r.description ?? null,
        tags: Array.isArray(r.tags) ? r.tags.join(",") : r.tags,
        usesCount: r.usesCount,
        lastUsedAt: r.lastUsedAt,
      }));
    },
    async delete(key: { project: string; engine: Engine; name: string }) {
      store.delete(`${key.engine}::${key.name}`);
    },
    async search(opts: { query: string }) {
      const q = opts.query.toLowerCase();
      const results: { name: string; engine: Engine; description: string | null; tags: string | null; score: number }[] = [];
      for (const r of store.values()) {
        const tagsStr = Array.isArray(r.tags) ? r.tags.join(",") : (r.tags ?? "");
        if (r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q) || tagsStr.toLowerCase().includes(q)) {
          results.push({
            name: r.name,
            engine: r.engine,
            description: r.description ?? null,
            tags: Array.isArray(r.tags) ? r.tags.join(",") : r.tags ?? null,
            score: 1,
          });
        }
      }
      return results;
    },
    async incrementUsage(key: { project: string; engine: Engine; name: string }) {
      const k = `${key.engine}::${key.name}`;
      const r = store.get(k);
      if (r) {
        r.usesCount++;
        r.lastUsedAt = Date.now();
      }
    },
  };
}

type SaveOpts = { project: string; engine: Engine; name: string; body: string; description?: string; tags?: string[]; paramsSchema?: string };

function makeQueryRunner(result: unknown) {
  return async (_args: unknown, _deps: unknown) => result;
}

async function importSnippetTools() {
  return await import("../../src/tools/snippet.js");
}

const PROJECT = "test-project";

describe("snippet tools — db_snippet_save", () => {
  test("saves snippet and returns id-like ok response", async () => {
    const { db_snippet_save } = await importSnippetTools();
    const snippetStore = makeSnippetStore();
    const result = await db_snippet_save(
      { engine: "postgres", name: "user-orders", body: "SELECT * FROM orders" },
      { project: PROJECT, snippetStore }
    );
    expect((result as { saved: boolean }).saved).toBe(true);
  });

  test("upserts existing snippet with same name+engine", async () => {
    const { db_snippet_save } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "daily-report", engine: "mysql", body: "SELECT 1" },
    ]);
    const result = await db_snippet_save(
      { engine: "mysql", name: "daily-report", body: "SELECT 2 FROM reports" },
      { project: PROJECT, snippetStore }
    );
    expect((result as { saved: boolean }).saved).toBe(true);
    const got = await snippetStore.get({ project: PROJECT, engine: "mysql", name: "daily-report" });
    expect(got!.body).toBe("SELECT 2 FROM reports");
  });
});

describe("snippet tools — db_snippet_get", () => {
  test("returns snippet with decrypted body", async () => {
    const { db_snippet_get } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "active-users", engine: "postgres", body: "SELECT * FROM users WHERE active=1", description: "Active users" },
    ]);
    const result = await db_snippet_get(
      { name: "active-users", engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    const r = result as { name: string; body: string; engine: Engine; description: string | null };
    expect(r.name).toBe("active-users");
    expect(r.body).toBe("SELECT * FROM users WHERE active=1");
    expect(r.engine).toBe("postgres");
  });

  test("returns error envelope when snippet not found", async () => {
    const { db_snippet_get } = await importSnippetTools();
    const snippetStore = makeSnippetStore();
    const result = await db_snippet_get(
      { name: "nonexistent", engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toContain("nonexistent");
  });
});

describe("snippet tools — db_snippet_run", () => {
  test("executes snippet body against engine and increments counter", async () => {
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "active-users", engine: "postgres", body: "SELECT * FROM users", usesCount: 5 },
    ]);
    let queryCalled = false;
    const queryRunner = async (_args: unknown, _deps: unknown) => {
      queryCalled = true;
      return { rows: [{ id: 1 }], truncated: false, rowCount: 1 };
    };
    const result = await db_snippet_run(
      { name: "active-users", engine: "postgres" },
      { project: PROJECT, snippetStore, queryRunner }
    );
    expect(queryCalled).toBe(true);
    expect((result as { rows: unknown[] }).rows).toHaveLength(1);
    const updated = await snippetStore.get({ project: PROJECT, engine: "postgres", name: "active-users" });
    expect(updated!.usesCount).toBe(6);
    expect(updated!.lastUsedAt).not.toBeNull();
  });

  test("returns error envelope when snippet not found", async () => {
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = makeSnippetStore();
    const result = await db_snippet_run(
      { name: "ghost", engine: "postgres" },
      { project: PROJECT, snippetStore, queryRunner: makeQueryRunner({}) }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});

describe("snippet tools — db_snippet_search", () => {
  test("returns FTS5 results matching query", async () => {
    const { db_snippet_search } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "orders-by-user", engine: "postgres", body: "SELECT *", description: "orders analytics", tags: ["analytics", "orders"] },
      { name: "revenue", engine: "postgres", body: "SELECT sum(total)", description: "revenue monthly", tags: ["finance"] },
    ]);
    const result = await db_snippet_search(
      { query: "orders" },
      { project: PROJECT, snippetStore }
    );
    const r = result as { results: { name: string; engine: Engine }[] };
    expect(r.results.length).toBeGreaterThanOrEqual(1);
    const names = r.results.map((x) => x.name);
    expect(names).toContain("orders-by-user");
  });

  test("empty results when query matches nothing", async () => {
    const { db_snippet_search } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "orders", engine: "postgres", body: "SELECT 1" },
    ]);
    const result = await db_snippet_search(
      { query: "zzznomatch" },
      { project: PROJECT, snippetStore }
    );
    expect((result as { results: unknown[] }).results).toHaveLength(0);
  });
});

describe("snippet tools — db_snippet_list", () => {
  test("lists snippets filtered by engine without bodies", async () => {
    const { db_snippet_list } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "pg-report", engine: "postgres", body: "SELECT 1" },
      { name: "redis-status", engine: "redis", body: "GET status" },
    ]);
    const result = await db_snippet_list(
      { engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    const r = result as { snippets: { name: string; engine: Engine }[] };
    expect(r.snippets).toHaveLength(1);
    expect(r.snippets[0].name).toBe("pg-report");
    expect((r.snippets[0] as Record<string, unknown>).body).toBeUndefined();
  });

  test("lists all snippets when no engine filter", async () => {
    const { db_snippet_list } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "a", engine: "postgres", body: "SELECT 1" },
      { name: "b", engine: "redis", body: "GET k" },
    ]);
    const result = await db_snippet_list({}, { project: PROJECT, snippetStore });
    const r = result as { snippets: { name: string }[] };
    expect(r.snippets).toHaveLength(2);
  });
});

describe("snippet tools — db_snippet_delete", () => {
  test("deletes snippet and returns deleted:true", async () => {
    const { db_snippet_delete } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "old-report", engine: "postgres", body: "SELECT 1" },
    ]);
    const result = await db_snippet_delete(
      { name: "old-report", engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    expect((result as { deleted: boolean }).deleted).toBe(true);
    const got = await snippetStore.get({ project: PROJECT, engine: "postgres", name: "old-report" });
    expect(got).toBeNull();
  });

  test("deleting non-existent snippet returns deleted:true (idempotent)", async () => {
    const { db_snippet_delete } = await importSnippetTools();
    const snippetStore = makeSnippetStore();
    const result = await db_snippet_delete(
      { name: "ghost", engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    expect((result as { deleted: boolean }).deleted).toBe(true);
  });
});

describe("snippet tools — error path coverage", () => {
  test("db_snippet_save — store.save() throws returns isError", async () => {
    const { db_snippet_save } = await importSnippetTools();
    const snippetStore = {
      ...makeSnippetStore(),
      save: async () => { throw new Error("disk full"); },
    };
    const result = await db_snippet_save(
      { engine: "postgres", name: "q", body: "SELECT 1" },
      { project: PROJECT, snippetStore, queryRunner: undefined }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/save failed/i);
  });

  test("db_snippet_get — store.get() throws returns isError", async () => {
    const { db_snippet_get } = await importSnippetTools();
    const snippetStore = {
      ...makeSnippetStore(),
      get: async () => { throw new Error("db error"); },
    };
    const result = await db_snippet_get(
      { name: "q", engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/get failed/i);
  });

  test("db_snippet_run — store.get() throws returns isError", async () => {
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = {
      ...makeSnippetStore(),
      get: async () => { throw new Error("db error"); },
    };
    const result = await db_snippet_run(
      { name: "q", engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/run failed/i);
  });

  test("db_snippet_run — no queryRunner returns isError", async () => {
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "q", engine: "postgres", body: "SELECT 1" },
    ]);
    const result = await db_snippet_run(
      { name: "q", engine: "postgres" },
      { project: PROJECT, snippetStore, queryRunner: undefined }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/no query runner/i);
  });

  test("db_snippet_run — queryRunner throws returns isError", async () => {
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "q", engine: "postgres", body: "SELECT 1" },
    ]);
    const result = await db_snippet_run(
      { name: "q", engine: "postgres" },
      {
        project: PROJECT,
        snippetStore,
        queryRunner: async () => { throw new Error("query failed"); },
      }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/execution failed/i);
  });

  test("db_snippet_search — store.search() throws returns isError", async () => {
    const { db_snippet_search } = await importSnippetTools();
    const snippetStore = {
      ...makeSnippetStore(),
      search: async () => { throw new Error("fts error"); },
    };
    const result = await db_snippet_search(
      { query: "test" },
      { project: PROJECT, snippetStore }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/search failed/i);
  });

  test("db_snippet_list — store.list() throws returns isError", async () => {
    const { db_snippet_list } = await importSnippetTools();
    const snippetStore = {
      ...makeSnippetStore(),
      list: async () => { throw new Error("db error"); },
    };
    const result = await db_snippet_list(
      { engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/list failed/i);
  });

  test("db_snippet_delete — store.delete() throws returns isError", async () => {
    const { db_snippet_delete } = await importSnippetTools();
    const snippetStore = {
      ...makeSnippetStore(),
      delete: async () => { throw new Error("db error"); },
    };
    const result = await db_snippet_delete(
      { name: "q", engine: "postgres" },
      { project: PROJECT, snippetStore }
    );
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/delete failed/i);
  });
});
