import type { Row, SnippetRunOutcome, JoinOnSpec } from "../types";

export function mergeObject(results: SnippetRunOutcome[]): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const r of results) {
    out[r.snippet_name] = r.rows;
  }
  return out;
}

export interface MergeUnionResult {
  rows: Row[];
  _truncated: boolean;
  total_before_cap: number;
}

export function mergeUnion(results: SnippetRunOutcome[], cap = 1000): MergeUnionResult {
  // Collect superset of column names (excluding _source which we add)
  const allCols = new Set<string>();
  for (const r of results) {
    for (const row of r.rows) {
      for (const k of Object.keys(row)) {
        allCols.add(k);
      }
    }
  }

  const cols = Array.from(allCols);
  const all: Row[] = [];

  for (const r of results) {
    for (const row of r.rows) {
      const out: Row = {};
      for (const c of cols) {
        out[c] = c in row ? row[c] : null;
      }
      out["_source"] = r.snippet_name;
      all.push(out);
    }
  }

  const total_before_cap = all.length;
  const _truncated = total_before_cap > cap;
  const rows = _truncated ? all.slice(0, cap) : all;

  return { rows, _truncated, total_before_cap };
}

export interface MergeJoinResult {
  rows: Row[];
  _truncated: boolean;
}

export function mergeJoin(
  results: SnippetRunOutcome[],
  joinOn: JoinOnSpec[],
  cap = 1000,
): MergeJoinResult {
  if (results.length === 0) return { rows: [], _truncated: false };

  // Build index for the right-side snippets keyed by join column value
  // We do a sequential inner join: left ⨝ right[0] ⨝ right[1] ...
  let accumulated: Row[] = results[0]!.rows;

  for (let i = 1; i < results.length; i++) {
    const right = results[i]!;
    const leftSpec = joinOn[i - 1]!;
    const rightSpec = joinOn[i]!;

    const rightIndex = new Map<unknown, Row[]>();
    for (const row of right.rows) {
      const key = row[rightSpec.column];
      const existing = rightIndex.get(key);
      if (existing) {
        existing.push(row);
      } else {
        rightIndex.set(key, [row]);
      }
    }

    const rightSnippetName = right.snippet_name;

    // Gather column names that exist on both sides (for collision suffix)
    const leftCols = new Set(accumulated.length > 0 ? Object.keys(accumulated[0]!) : []);
    const rightCols = new Set(right.rows.length > 0 ? Object.keys(right.rows[0]!) : []);
    const collisions = new Set([...leftCols].filter((c) => rightCols.has(c) && c !== leftSpec.column));

    const next: Row[] = [];
    for (const lrow of accumulated) {
      const key = lrow[leftSpec.column];
      const matches = rightIndex.get(key);
      if (!matches) continue;
      for (const rrow of matches) {
        const merged: Row = { ...lrow };
        for (const [k, v] of Object.entries(rrow)) {
          if (k === rightSpec.column) continue; // skip duplicate join key from right
          if (collisions.has(k)) {
            merged[`${k}_${rightSnippetName}`] = v;
          } else {
            merged[k] = v;
          }
        }
        next.push(merged);
      }
    }

    accumulated = next;
  }

  const _truncated = accumulated.length > cap;
  const rows = _truncated ? accumulated.slice(0, cap) : accumulated;
  return { rows, _truncated };
}
