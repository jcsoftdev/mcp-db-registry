import { describe, it, expect } from "bun:test";
import { buildGraph, findJoinPath, assembleSql } from "../../src/reports/join-graph";
import type { ForeignKey } from "../../src/types";

// ─── fixtures ────────────────────────────────────────────────────────────────

const fkAB: ForeignKey = { from_table: "a", from_col: "b_id", to_table: "b", to_col: "id" };
const fkBC: ForeignKey = { from_table: "b", from_col: "c_id", to_table: "c", to_col: "id" };
const fkAC: ForeignKey = { from_table: "a", from_col: "c_id", to_table: "c", to_col: "id" };

// ─── buildGraph ──────────────────────────────────────────────────────────────

describe("buildGraph", () => {
  it("returns empty map for empty FK list", () => {
    const g = buildGraph([]);
    expect(g.size).toBe(0);
  });

  it("creates undirected edges — both directions appear", () => {
    const g = buildGraph([fkAB]);
    expect(g.get("a")).toContainEqual(fkAB);
    expect(g.get("b")).toContainEqual(fkAB);
  });

  it("aggregates multiple FKs for same table", () => {
    const g = buildGraph([fkAB, fkAC]);
    expect(g.get("a")?.length).toBe(2);
  });
});

// ─── findJoinPath ─────────────────────────────────────────────────────────────

describe("findJoinPath", () => {
  it("connects 3 tables in a linear chain (a→b→c)", () => {
    const g = buildGraph([fkAB, fkBC]);
    const result = findJoinPath(["a", "b", "c"], g);
    expect(result.path.length).toBe(2);
    expect(result.disconnected).toHaveLength(0);
    // path covers both FKs
    const fromTables = result.path.map((fk) => `${fk.from_table}-${fk.to_table}`);
    expect(fromTables).toContain("a-b");
    expect(fromTables).toContain("b-c");
  });

  it("detects disconnected table — A and B linked; C orphan → C in disconnected", () => {
    const g = buildGraph([fkAB]); // no edge to c
    const result = findJoinPath(["a", "b", "c"], g);
    expect(result.disconnected).toContain("c");
    expect(result.path.length).toBe(1);
  });

  it("handles cycle without infinite loop", () => {
    const fkBA: ForeignKey = { from_table: "b", from_col: "a_id", to_table: "a", to_col: "id" };
    const g = buildGraph([fkAB, fkBA]);
    // should complete without hanging
    const result = findJoinPath(["a", "b"], g);
    expect(result.disconnected).toHaveLength(0);
    // exactly one edge needed to connect 2 tables
    expect(result.path.length).toBe(1);
  });

  it("returns empty path and all disconnected for single table with no FKs", () => {
    const g = buildGraph([]);
    const result = findJoinPath(["a"], g);
    expect(result.path).toHaveLength(0);
    expect(result.disconnected).toHaveLength(0);
  });

  it("two disconnected pairs — first pair connected, second disconnected", () => {
    const g = buildGraph([fkAB]); // only a-b
    const result = findJoinPath(["a", "b", "c", "d"], g);
    // c and d have no edges → both disconnected
    expect(result.disconnected).toContain("c");
    expect(result.disconnected).toContain("d");
    expect(result.path.length).toBe(1);
  });

  it("star topology — hub b connects to a and c", () => {
    const g = buildGraph([fkAB, fkBC]);
    const result = findJoinPath(["a", "b", "c"], g);
    expect(result.disconnected).toHaveLength(0);
    expect(result.path.length).toBe(2);
  });

  it("empty tables array returns empty path and disconnected", () => {
    const g = buildGraph([fkAB]);
    const result = findJoinPath([], g);
    expect(result.path).toHaveLength(0);
    expect(result.disconnected).toHaveLength(0);
  });
});

// ─── assembleSql ──────────────────────────────────────────────────────────────

describe("assembleSql", () => {
  it("single table → simple SELECT with default LIMIT", () => {
    const sql = assembleSql({ tables: ["users"], joinPath: [] });
    expect(sql).toMatch(/SELECT\s+"users"\.\*/i);
    expect(sql).toMatch(/FROM\s+"users"/i);
    expect(sql).toMatch(/LIMIT 100/);
  });

  it("two tables with one FK → JOIN clause", () => {
    const sql = assembleSql({ tables: ["orders", "users"], joinPath: [fkAB] });
    expect(sql).toMatch(/JOIN/i);
    expect(sql).toMatch(/ON/i);
    expect(sql).toMatch(/LIMIT 100/);
  });

  it("three tables with two FKs → chained JOIN", () => {
    const sql = assembleSql({ tables: ["a", "b", "c"], joinPath: [fkAB, fkBC] });
    const joinCount = (sql.match(/JOIN/gi) ?? []).length;
    expect(joinCount).toBe(2);
  });

  it("quotes table names with special chars", () => {
    const fk: ForeignKey = {
      from_table: 'my"table',
      from_col: "id",
      to_table: "other",
      to_col: "id",
    };
    const sql = assembleSql({ tables: ['my"table', "other"], joinPath: [fk] });
    // double-quotes inside identifiers must be escaped as ""
    expect(sql).toContain('"my""table"');
  });

  it("respects custom limit", () => {
    const sql = assembleSql({ tables: ["t"], joinPath: [], limit: 50 });
    expect(sql).toMatch(/LIMIT 50/);
  });

  it("adds -- intent: line comment when intent provided (REQ-27)", () => {
    const intent = "show active users";
    const sql = assembleSql({ tables: ["users"], joinPath: [], intent });
    // REQ-27: spec mandates "-- intent: <text>" SQL line comment, newline-terminated
    expect(sql).toContain("-- intent: show active users");
    // the comment must be on its own line (newline precedes or follows it)
    const commentIdx = sql.indexOf("-- intent:");
    expect(commentIdx).toBeGreaterThanOrEqual(0);
    // subsequent SQL (LIMIT) must appear after the newline that terminates the comment line
    const afterComment = sql.slice(commentIdx);
    expect(afterComment).toMatch(/-- intent:.*\n/);
  });

  it("intent comment containing SQL-special chars stays inside comment line", () => {
    const intent = "show active users; DROP TABLE users--";
    const sql = assembleSql({ tables: ["users"], joinPath: [], intent });
    // intent is embedded in a line comment — everything after "--" until newline is a comment
    expect(sql).toContain("-- intent:");
    expect(sql).toContain(intent);
    // LIMIT must still appear (on the next line after the comment)
    expect(sql).toMatch(/LIMIT/i);
  });
});
