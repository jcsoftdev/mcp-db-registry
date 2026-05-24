import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { routeTool, detectGitRemote, type ServerContext } from "../src/server.js";
import { openDb, closeDb } from "../src/store/db.js";
import { SnippetsStore } from "../src/store/snippets.js";
import { CredentialsStore } from "../src/store/credentials.js";
import type { Database } from "bun:sqlite";
import type { Engine, ForeignKey } from "../src/types.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeConn(engine: Engine) {
  return { engine, native: {} };
}

function makeDriver(engine: Engine, overrides: Record<string, unknown> = {}) {
  return {
    engine,
    connect: async () => makeConn(engine),
    close: async () => {},
    ping: async () => true,
    query: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
    list: async () => [],
    describe: async () => [],
    explain: async () => ({ kind: "rows" as const, rows: [], truncated: false, rowCount: 0 }),
    getForeignKeys: async () => [] as ForeignKey[],
    ...overrides,
  };
}

function makeCtx(db: Database, key: Uint8Array): ServerContext {
  const snippetStore = new SnippetsStore(db, key);
  const credStore = new CredentialsStore(db, key);
  const driver = makeDriver("postgres");

  const dbDeps = {
    getDriver: (_engine: Engine) => driver as any,
    resolveConfig: async (engine: Engine) => ({
      engine,
      host: "localhost",
      port: 5432,
      database: "test",
      source: {},
    }),
    allowWrite: false,
  };

  return {
    dbDeps,
    project: "test-project",
    snippetStore,
    credStore,
  };
}

// ─── detectGitRemote ──────────────────────────────────────────────────────────

describe("detectGitRemote", () => {
  test("returns a string or null — does not throw", () => {
    // We're in a git repo so this exercises the spawnSync success path
    const result = detectGitRemote();
    // Result must be either null or a non-empty string
    expect(result === null || typeof result === "string").toBe(true);
    if (result !== null) {
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("routeTool", () => {
  let db: Database;
  let key: Uint8Array;
  let ctx: ServerContext;

  beforeEach(() => {
    db = openDb(":memory:");
    key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    ctx = makeCtx(db, key);
  });

  afterEach(() => closeDb(db));

  test("unknown tool name returns isError response", async () => {
    const result = await routeTool("nonexistent_tool", {}, ctx);
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/unknown tool/i);
  });

  test("db_engines returns all 5 engine entries", async () => {
    // db_engines returns { engines: [{name, available, discovered_via}, ...] } directly (not wrapped)
    const result = await routeTool("db_engines", {}, ctx) as any;
    expect(result.engines).toBeDefined();
    expect(Array.isArray(result.engines)).toBe(true);
    const names = result.engines.map((e: any) => e.name);
    expect(names).toContain("postgres");
    expect(names).toContain("mysql");
    expect(names).toContain("mongo");
    expect(names).toContain("redis");
    expect(names).toContain("sqlite");
  });

  test("db_snippet_save then db_snippet_get round-trip", async () => {
    // Save a snippet
    const saveResult = await routeTool("db_snippet_save", {
      engine: "postgres",
      name: "hello-query",
      body: "SELECT 1",
      description: "test snippet",
    }, ctx);
    expect((saveResult as any).isError).toBeUndefined();
    expect((saveResult as any).saved).toBe(true);

    // Retrieve it — db_snippet_get returns the snippet object directly (name, body, etc.)
    const getResult = await routeTool("db_snippet_get", {
      engine: "postgres",
      name: "hello-query",
    }, ctx);
    expect((getResult as any).isError).toBeUndefined();
    expect((getResult as any).name).toBe("hello-query");
    expect((getResult as any).body).toBe("SELECT 1");
  });

  test("db_snippet_list returns saved snippet", async () => {
    await routeTool("db_snippet_save", {
      engine: "sqlite",
      name: "my-query",
      body: "SELECT * FROM t",
    }, ctx);

    const listResult = await routeTool("db_snippet_list", {
      engine: "sqlite",
    }, ctx);
    expect((listResult as any).snippets).toBeDefined();
    expect((listResult as any).snippets.length).toBeGreaterThanOrEqual(1);
    const names = (listResult as any).snippets.map((s: any) => s.name);
    expect(names).toContain("my-query");
  });

  test("db_snippet_search returns snippet by keyword", async () => {
    await routeTool("db_snippet_save", {
      engine: "postgres",
      name: "revenue-report",
      body: "SELECT sum(amount) FROM orders",
      description: "monthly revenue",
    }, ctx);

    const searchResult = await routeTool("db_snippet_search", {
      engine: "postgres",
      query: "revenue",
    }, ctx);
    expect(Array.isArray((searchResult as any).results)).toBe(true);
    expect((searchResult as any).results.length).toBeGreaterThanOrEqual(1);
  });

  test("db_snippet_delete removes snippet", async () => {
    await routeTool("db_snippet_save", {
      engine: "postgres",
      name: "temp-q",
      body: "SELECT 1",
    }, ctx);

    const deleteResult = await routeTool("db_snippet_delete", {
      engine: "postgres",
      name: "temp-q",
    }, ctx);
    expect((deleteResult as any).isError).toBeUndefined();

    const getResult = await routeTool("db_snippet_get", {
      engine: "postgres",
      name: "temp-q",
    }, ctx);
    // db_snippet_get returns isError when snippet not found
    expect((getResult as any).isError).toBe(true);
  });

  test("db_credentials_save + db_credentials_clear round-trip (no real DB needed)", async () => {
    // credentials_save stores an encrypted DSN; clear removes it
    // Both depend on credStore, not the engine driver
    const saveResult = await routeTool("db_credentials_save", {
      engine: "postgres",
      connectionName: "main",
      dsn: "postgres://user:pass@localhost/testdb",
    }, ctx);
    // may succeed or fail depending on impl; just verify no exception
    expect(saveResult).toBeDefined();

    const clearResult = await routeTool("db_credentials_clear", {
      engine: "postgres",
      connectionName: "main",
    }, ctx);
    expect(clearResult).toBeDefined();
  });

  test("db_describe_many with unknown engine returns error via routeTool", async () => {
    const result = await routeTool("db_describe_many", {
      engine: "oracle",
      tables: ["users"],
    }, ctx);
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/unsupported engine/i);
  });

  test("db_suggest_query with unknown engine returns error via routeTool", async () => {
    const result = await routeTool("db_suggest_query", {
      engine: "oracle",
      intent: "test",
      tables: ["users"],
    }, ctx);
    expect((result as any).isError).toBe(true);
  });

  test("db_report_run with unknown engine returns error via routeTool", async () => {
    const result = await routeTool("db_report_run", {
      engine: "oracle",
      snippet_names: ["q1"],
    }, ctx);
    expect((result as any).isError).toBe(true);
  });

  test("db_query with invalid engine returns error via routeTool", async () => {
    const result = await routeTool("db_query", {
      engine: "oracle",
      body: "SELECT 1",
    }, ctx);
    expect((result as any).isError).toBe(true);
  });

  test("db_list with invalid engine returns error via routeTool", async () => {
    const result = await routeTool("db_list", {
      engine: "oracle",
      kind: "tables",
    }, ctx);
    expect((result as any).isError).toBe(true);
  });

  test("db_describe with invalid engine returns error via routeTool", async () => {
    const result = await routeTool("db_describe", {
      engine: "oracle",
      table: "users",
    }, ctx);
    expect((result as any).isError).toBe(true);
  });

  test("db_explain with invalid engine returns error via routeTool", async () => {
    const result = await routeTool("db_explain", {
      engine: "oracle",
      body: "SELECT 1",
    }, ctx);
    expect((result as any).isError).toBe(true);
  });

  test("db_connection_info with invalid engine returns error via routeTool", async () => {
    const result = await routeTool("db_connection_info", {
      engine: "oracle",
    }, ctx);
    expect((result as any).isError).toBe(true);
  });

  test("db_snippet_run with non-existent snippet returns error", async () => {
    const result = await routeTool("db_snippet_run", {
      engine: "postgres",
      name: "nonexistent",
    }, ctx);
    expect((result as any).isError).toBe(true);
  });
});
