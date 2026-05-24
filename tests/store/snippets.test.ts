import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openDb, closeDb } from "../../src/store/db.js";
import { SnippetsStore } from "../../src/store/snippets.js";
import type { Database } from "bun:sqlite";

describe("SnippetsStore", () => {
  let db: Database;
  let store: SnippetsStore;
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32));

  beforeEach(() => {
    db = openDb(":memory:");
    store = new SnippetsStore(db, key);
  });

  afterEach(() => closeDb(db));

  const BASE = {
    project: "myproj",
    engine: "postgres" as const,
    name: "user-orders",
    body: "SELECT * FROM orders WHERE user_id = 1",
    bodyKind: "sql" as const,
    description: "Orders by user",
    tags: ["orders", "analytics"],
  };

  it("save then get returns decrypted body", async () => {
    await store.save(BASE);
    const s = await store.get({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    expect(s).not.toBeNull();
    expect(s!.body).toBe(BASE.body);
    expect(s!.name).toBe(BASE.name);
    expect(s!.usesCount).toBe(0);
  });

  it("get returns null for non-existent snippet", async () => {
    const result = await store.get({ project: "x", engine: "postgres", name: "missing" });
    expect(result).toBeNull();
  });

  it("upsert replaces body and metadata on same (project, engine, name)", async () => {
    await store.save(BASE);
    await store.save({ ...BASE, body: "SELECT 1", description: "updated" });
    const s = await store.get({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    expect(s!.body).toBe("SELECT 1");
    expect(s!.description).toBe("updated");
  });

  it("list returns only snippets for requested engine (no bodies)", async () => {
    await store.save(BASE);
    await store.save({ ...BASE, engine: "mysql", name: "mysql-q" });

    const list = await store.list({ project: BASE.project, engine: "postgres" });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe(BASE.name);
    expect((list[0] as unknown as { body?: string }).body).toBeUndefined();
  });

  it("list without engine filter returns all engines", async () => {
    await store.save(BASE);
    await store.save({ ...BASE, engine: "mysql", name: "mysql-q" });

    const list = await store.list({ project: BASE.project });
    expect(list).toHaveLength(2);
  });

  it("delete removes the snippet", async () => {
    await store.save(BASE);
    await store.delete({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    const s = await store.get({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    expect(s).toBeNull();
  });

  it("FTS5 search finds snippet by tag", async () => {
    await store.save(BASE);
    await store.save({ ...BASE, name: "revenue", body: "SELECT sum(total) FROM orders", description: "Revenue report", tags: ["revenue", "finance"] });

    const results = await store.search({ query: "orders" });
    const names = results.map((r) => r.name);
    expect(names).toContain("user-orders");
  });

  it("FTS5 search returns results ordered by relevance", async () => {
    await store.save({ ...BASE, name: "orders-primary", description: "orders orders orders", tags: ["orders"] });
    await store.save({ ...BASE, name: "orders-secondary", description: "something else", tags: ["other"] });

    const results = await store.search({ query: "orders" });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].name).toBe("orders-primary");
  });

  it("search returns empty array for no-match query", async () => {
    await store.save(BASE);
    const results = await store.search({ query: "zxqzxqzxq_nomatch" });
    expect(results).toHaveLength(0);
  });

  it("incrementUsage increments uses_count and sets last_used_at", async () => {
    await store.save(BASE);
    const before = await store.get({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    expect(before!.usesCount).toBe(0);

    const t1 = Date.now();
    await store.incrementUsage({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    const after = await store.get({ project: BASE.project, engine: BASE.engine, name: BASE.name });

    expect(after!.usesCount).toBe(1);
    expect(after!.lastUsedAt).not.toBeNull();
    expect(after!.lastUsedAt!).toBeGreaterThanOrEqual(t1);
  });

  it("FTS5 sync on delete — search no longer returns deleted snippet", async () => {
    await store.save(BASE);
    await store.delete({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    const results = await store.search({ query: "orders" });
    expect(results.map((r) => r.name)).not.toContain(BASE.name);
  });

  it("body is encrypted at rest", async () => {
    await store.save(BASE);
    const row = db.query<{ body: Uint8Array }, []>(
      "SELECT body FROM snippets WHERE name = 'user-orders'"
    ).get();
    expect(row).not.toBeNull();
    const raw = Buffer.from(row!.body).toString("utf8");
    expect(raw).not.toContain("SELECT");
  });

  // Phase 2 — category CRUD (REQ-31)

  it("2.1 save snippet with category; get returns it", async () => {
    await store.save({ ...BASE, name: "revenue-report", category: "analytics" });
    const s = await store.get({ project: BASE.project, engine: BASE.engine, name: "revenue-report" });
    expect(s).not.toBeNull();
    expect(s!.category).toBe("analytics");
  });

  it("2.2 legacy snippet without category returns category=null", async () => {
    await store.save(BASE);
    const s = await store.get({ project: BASE.project, engine: BASE.engine, name: BASE.name });
    expect(s).not.toBeNull();
    expect(s!.category).toBeNull();
  });

  it("2.3 list({category:'analytics'}) returns only matching snippets", async () => {
    await store.save({ ...BASE, name: "rev", category: "analytics" });
    await store.save({ ...BASE, name: "ops-check", category: "ops" });
    await store.save({ ...BASE, name: "no-cat" });
    const list = await store.list({ project: BASE.project, category: "analytics" });
    expect(list.map((s) => s.name)).toContain("rev");
    expect(list.map((s) => s.name)).not.toContain("ops-check");
    expect(list.map((s) => s.name)).not.toContain("no-cat");
  });

  it("2.4 search('audit') matches snippet with category='audit' via FTS5", async () => {
    await store.save({ ...BASE, name: "login-events", category: "audit", description: "login tracking" });
    const results = await store.search({ query: "audit" });
    expect(results.map((r) => r.name)).toContain("login-events");
    const hit = results.find((r) => r.name === "login-events");
    expect(hit!.category).toBe("audit");
  });

  it("1000-row FTS5 search benchmark — under 5ms p99", async () => {
    const inserts: Promise<void>[] = [];
    for (let i = 0; i < 1000; i++) {
      inserts.push(store.save({
        project: "bench",
        engine: "postgres",
        name: `snippet-${i}`,
        body: `SELECT * FROM t${i}`,
        bodyKind: "sql",
        description: `Bench query for table t${i}`,
        tags: ["bench", `tag-${i % 10}`],
      }));
    }
    await Promise.all(inserts);

    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const t0 = performance.now();
      await store.search({ query: "bench" });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p99 = times[Math.floor(times.length * 0.99)];
    expect(p99).toBeLessThan(5);
  });
});
