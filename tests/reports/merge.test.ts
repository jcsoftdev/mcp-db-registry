import { describe, it, expect } from "bun:test";
import { mergeObject, mergeUnion, mergeJoin } from "../../src/reports/merge";
import type { SnippetRunOutcome } from "../../src/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function outcome(name: string, rows: Record<string, unknown>[]): SnippetRunOutcome {
  return { snippet_name: name, rows, kind: "rows" };
}

// ─── mergeObject ─────────────────────────────────────────────────────────────

describe("mergeObject", () => {
  it("3 snippets → 3-key object keyed by name", () => {
    const results = [
      outcome("users", [{ id: 1 }]),
      outcome("orders", [{ id: 10 }, { id: 11 }]),
      outcome("products", []),
    ];
    const merged = mergeObject(results);
    expect(Object.keys(merged)).toHaveLength(3);
    expect(merged["users"]).toEqual([{ id: 1 }]);
    expect(merged["orders"]).toHaveLength(2);
    expect(merged["products"]).toEqual([]);
  });

  it("empty input → empty object", () => {
    expect(mergeObject([])).toEqual({});
  });

  it("duplicate snippet name → last one wins", () => {
    const results = [outcome("a", [{ x: 1 }]), outcome("a", [{ x: 2 }])];
    const merged = mergeObject(results);
    expect(merged["a"]).toEqual([{ x: 2 }]);
  });
});

// ─── mergeUnion ──────────────────────────────────────────────────────────────

describe("mergeUnion", () => {
  it("different column sets → null-filled superset", () => {
    const results = [
      outcome("q1", [{ id: 1, name: "Alice" }]),
      outcome("q2", [{ id: 2, status: "active" }]),
    ];
    const { rows } = mergeUnion(results);
    const q1row = rows.find((r) => r["_source"] === "q1")!;
    const q2row = rows.find((r) => r["_source"] === "q2")!;
    expect(q1row["status"]).toBeNull();
    expect(q2row["name"]).toBeNull();
  });

  it("adds _source column per row = snippet name", () => {
    const results = [outcome("s1", [{ x: 1 }]), outcome("s2", [{ x: 2 }])];
    const { rows } = mergeUnion(results);
    expect(rows[0]["_source"]).toBe("s1");
    expect(rows[1]["_source"]).toBe("s2");
  });

  it("respects cap — truncates at 1000 rows and sets _truncated + total_before_cap", () => {
    const bigRows = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    const results = [outcome("a", bigRows), outcome("b", bigRows)];
    const { rows, _truncated, total_before_cap } = mergeUnion(results, 1000);
    expect(rows.length).toBe(1000);
    expect(_truncated).toBe(true);
    expect(total_before_cap).toBe(1200);
  });

  it("no truncation when under cap", () => {
    const results = [outcome("a", [{ id: 1 }]), outcome("b", [{ id: 2 }])];
    const { _truncated, total_before_cap } = mergeUnion(results);
    expect(_truncated).toBe(false);
    expect(total_before_cap).toBe(2);
  });

  it("empty results → empty rows", () => {
    const { rows, _truncated } = mergeUnion([]);
    expect(rows).toHaveLength(0);
    expect(_truncated).toBe(false);
  });
});

// ─── mergeJoin ───────────────────────────────────────────────────────────────

describe("mergeJoin", () => {
  it("2 snippets sharing a column → inner-joined rows", () => {
    const results = [
      outcome("users", [
        { user_id: 1, name: "Alice" },
        { user_id: 2, name: "Bob" },
        { user_id: 3, name: "Carol" },
      ]),
      outcome("orders", [
        { user_id: 1, amount: 100 },
        { user_id: 2, amount: 200 },
      ]),
    ];
    const { rows } = mergeJoin(results, [
      { snippet_name: "users", column: "user_id" },
      { snippet_name: "orders", column: "user_id" },
    ]);
    // user_id 3 has no match in orders → excluded (inner join)
    expect(rows.length).toBe(2);
    // verify join correctness
    const alice = rows.find((r) => r["name"] === "Alice");
    expect(alice?.["amount"]).toBe(100);
  });

  it("collision suffix — duplicate column names get _<snippet_name> suffix", () => {
    const results = [
      outcome("a", [{ id: 1, value: "from-a" }]),
      outcome("b", [{ id: 1, value: "from-b" }]),
    ];
    const { rows } = mergeJoin(results, [
      { snippet_name: "a", column: "id" },
      { snippet_name: "b", column: "id" },
    ]);
    expect(rows.length).toBe(1);
    // 'value' appears in both → one gets suffixed
    const r = rows[0]!;
    const keys = Object.keys(r);
    // either value_a + value_b, or value + value_b — at least two distinct value keys
    const valueKeys = keys.filter((k) => k.startsWith("value"));
    expect(valueKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("respects cap and sets _truncated", () => {
    // Both sides have id=1 repeated 600 times → 600×600=360_000 cross-product rows
    // Use a small cap to verify truncation
    const left = Array.from({ length: 40 }, () => ({ id: 1, lval: "x" }));
    const right = Array.from({ length: 40 }, () => ({ id: 1, rval: "y" }));
    const results = [outcome("l", left), outcome("r", right)];
    const { rows, _truncated } = mergeJoin(
      results,
      [
        { snippet_name: "l", column: "id" },
        { snippet_name: "r", column: "id" },
      ],
      50,
    );
    // 40 × 40 = 1600 matches, capped at 50
    expect(rows.length).toBe(50);
    expect(_truncated).toBe(true);
  });
});
