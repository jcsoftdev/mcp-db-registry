const WRITE_VERBS =
  /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE|MERGE|GRANT|REVOKE)\b/i;

// Matches: optional block or line comments + whitespace, then captures the first keyword token
const FIRST_TOKEN_RE =
  /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*([A-Za-z_]+)/;

export function isReadOnlySql(sql: string): boolean {
  const m = sql.match(FIRST_TOKEN_RE);
  const first = m?.[1]?.toUpperCase();
  if (!first) return true;

  if (first === "WITH") {
    // CTE: scan the full query for write verbs
    return !WRITE_VERBS.test(sql);
  }

  const READ_ONLY = new Set([
    "SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "PRAGMA",
    "WITH", // already handled above but kept for clarity
  ]);
  return READ_ONLY.has(first);
}
