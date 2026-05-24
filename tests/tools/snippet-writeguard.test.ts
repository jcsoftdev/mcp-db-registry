import { describe, test, expect, afterEach } from "bun:test";
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
    async save(opts: { project: string; engine: Engine; name: string; body: string; description?: string; tags?: string[]; paramsSchema?: string }) {
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
      return opts.engine ? items.filter((i) => i.engine === opts.engine) : items;
    },
    async delete(key: { project: string; engine: Engine; name: string }) {
      store.delete(`${key.engine}::${key.name}`);
    },
    async search(opts: { query: string }) {
      const q = opts.query.toLowerCase();
      return [...store.values()]
        .filter((r) => r.name.toLowerCase().includes(q))
        .map((r) => ({ name: r.name, engine: r.engine, description: r.description ?? null, tags: null, score: 1 }));
    },
    async incrementUsage(key: { project: string; engine: Engine; name: string }) {
      const k = `${key.engine}::${key.name}`;
      const r = store.get(k);
      if (r) { r.usesCount++; r.lastUsedAt = Date.now(); }
    },
  };
}

function makeQueryRunner(result: unknown) {
  return async (_args: unknown, _deps: unknown) => result;
}

async function importSnippetTools() {
  return await import("../../src/tools/snippet.js");
}

const PROJECT = "test-project";

afterEach(() => {
  delete process.env["DB_REGISTRY_ALLOW_WRITE"];
});

describe("snippet write-guard — db_snippet_run", () => {
  test("blocks write SQL snippet when DB_REGISTRY_ALLOW_WRITE is unset", async () => {
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "danger", engine: "sqlite", body: "DELETE FROM users" },
    ]);
    const result = await db_snippet_run(
      { name: "danger", engine: "sqlite" },
      { project: PROJECT, snippetStore, queryRunner: makeQueryRunner({ rows: [] }) }
    );
    expect((result as { isError: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text.toLowerCase()).toContain("write");
    expect(text.toLowerCase()).toContain("block");
  });

  test("allows write SQL snippet when DB_REGISTRY_ALLOW_WRITE=1", async () => {
    process.env["DB_REGISTRY_ALLOW_WRITE"] = "1";
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "cleanup", engine: "sqlite", body: "DELETE FROM temp_data" },
    ]);
    let queryCalled = false;
    const queryRunner = async (_args: unknown, _deps: unknown) => {
      queryCalled = true;
      return { rows: [], truncated: false, rowCount: 0 };
    };
    const result = await db_snippet_run(
      { name: "cleanup", engine: "sqlite" },
      { project: PROJECT, snippetStore, queryRunner }
    );
    expect(queryCalled).toBe(true);
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });

  test("allows read SQL snippet even without env override", async () => {
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];
    const { db_snippet_run } = await importSnippetTools();
    const snippetStore = makeSnippetStore([
      { name: "safe-query", engine: "postgres", body: "SELECT * FROM users" },
    ]);
    let queryCalled = false;
    const queryRunner = async (_args: unknown, _deps: unknown) => {
      queryCalled = true;
      return { rows: [{ id: 1 }], truncated: false, rowCount: 1 };
    };
    const result = await db_snippet_run(
      { name: "safe-query", engine: "postgres" },
      { project: PROJECT, snippetStore, queryRunner }
    );
    expect(queryCalled).toBe(true);
    expect((result as { rows: unknown[] }).rows).toHaveLength(1);
  });
});
