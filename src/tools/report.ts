import type {
  Engine,
  ForeignKey,
  Row,
  SnippetRunOutcome,
  JoinOnSpec,
  ReportMergeMode,
} from "../types.js";
import type { DbDeps } from "./db.js";
import { toolError } from "../util/errors.js";
import { makeWriteGuard, checkWriteAllowed } from "../safety/write-detect.js";
import { getForeignKeysSafe } from "../reports/fk-extractor.js";
import { buildGraph, findJoinPath, assembleSql } from "../reports/join-graph.js";
import { mergeObject, mergeUnion, mergeJoin } from "../reports/merge.js";

const ENGINES: Engine[] = ["postgres", "mysql", "mongo", "redis", "sqlite"];
const REPORT_HARD_CAP = 1000;

function isValidEngine(e: string): e is Engine {
  return ENGINES.includes(e as Engine);
}

function mcpContent(obj: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

// ─── SnippetStore shape (subset needed by report tools) ────────────────────

type ReportSnippetRecord = {
  name: string;
  engine: Engine;
  body: string;
  bodyKind: string;
  description: string | null;
  tags: string | null;
  category: string | null;
  usesCount: number;
  lastUsedAt: number | null;
};

type SnippetStoreShape = {
  get(key: { project: string; engine: Engine; name: string }): Promise<ReportSnippetRecord | null>;
  incrementUsage(key: { project: string; engine: Engine; name: string }): Promise<void>;
};

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface ReportDeps extends DbDeps {
  project: string;
  snippetStore: SnippetStoreShape;
  queryRunner?: (args: unknown, deps?: unknown) => Promise<unknown>;
}

// ─── db_describe_many ───────────────────────────────────────────────────────

export async function db_describe_many(
  args: { engine: Engine; tables: string[]; connection?: string },
  deps: DbDeps
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }

  if (!Array.isArray(args.tables) || args.tables.length === 0) {
    return mcpContent({ schemas: {}, missing: [] });
  }

  let cfg: Awaited<ReturnType<DbDeps["resolveConfig"]>>;
  try {
    cfg = await deps.resolveConfig(args.engine, args.connection ?? "main");
  } catch (err) {
    return toolError(`Config resolution failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  const driver = deps.getDriver(args.engine);
  const conn = await driver.connect(cfg) as { engine: Engine; native: unknown };

  const schemas: Record<string, Row[]> = {};
  const missing: string[] = [];
  const warnings: string[] = [];

  // REQ-26 degraded engine: mongo schema introspection is sampling-based, not structural
  if (args.engine === "mongo") {
    warnings.push(
      "mongo does not support structural schema introspection; describe falls back to collection sampling"
    );
  }

  try {
    // Prefetch known table list for fast missing detection
    let known: Set<string> | null = null;
    try {
      const items = await driver.list(conn, "tables");
      known = new Set(items);
    } catch {
      // list() may not be supported (redis, etc.) — fall through
    }

    for (const table of args.tables) {
      if (known && !known.has(table)) {
        missing.push(table);
        continue;
      }
      try {
        const columns = await driver.describe(conn, table);
        schemas[table] = columns;
      } catch {
        missing.push(table);
      }
    }
  } finally {
    driver.close(conn).catch(() => {});
  }

  const payload: Record<string, unknown> = { schemas, missing };
  if (warnings.length > 0) payload["warnings"] = warnings;
  return mcpContent(payload);
}

// ─── db_suggest_query ───────────────────────────────────────────────────────

export async function db_suggest_query(
  args: { engine: Engine; intent: string; tables: string[]; connection?: string },
  deps: DbDeps
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }

  if (!Array.isArray(args.tables) || args.tables.length === 0) {
    return toolError("tables must be a non-empty array");
  }

  const warnings: string[] = [];

  // Mongo/Redis: degenerate case — no FK concept, return skeleton immediately
  if (args.engine === "mongo") {
    const t0 = args.tables[0] ?? "<collection>";
    warnings.push(
      `mongo has no foreign-key concept; multi-table JOIN skeleton not supported. Single-collection skeleton returned.`
    );
    const sql = `db.${t0}.find({}).limit(100) /* intent: ${args.intent} */`;
    return mcpContent({
      sql,
      tables: [t0],
      join_path: [],
      warnings,
    });
  }

  if (args.engine === "redis") {
    warnings.push(
      `redis is a key-value store; query skeletons and FK-based JOINs are not supported.`
    );
    return mcpContent({
      sql: `# intent: ${args.intent}\n# redis has no JOIN semantics\nKEYS *`,
      tables: args.tables,
      join_path: [],
      warnings,
    });
  }

  let cfg: Awaited<ReturnType<DbDeps["resolveConfig"]>>;
  try {
    cfg = await deps.resolveConfig(args.engine, args.connection ?? "main");
  } catch (err) {
    return toolError(`Config resolution failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  const driver = deps.getDriver(args.engine);
  const conn = await driver.connect(cfg) as { engine: Engine; native: unknown };

  let fks: ForeignKey[] = [];
  try {
    fks = await getForeignKeysSafe(driver as any, conn as any, args.tables);
  } finally {
    driver.close(conn).catch(() => {});
  }

  const graph = buildGraph(fks);
  const { path, disconnected } = findJoinPath(args.tables, graph);

  for (const d of disconnected) {
    warnings.push(
      `Table "${d}" has no FK path to the other tables — excluded from JOIN chain.`
    );
  }

  const joinedTables = args.tables.filter((t) => !disconnected.includes(t));

  const sql = assembleSql({
    tables: joinedTables.length > 0 ? joinedTables : args.tables.slice(0, 1),
    joinPath: path,
    limit: 100,
    intent: args.intent,
  });

  // Convert ForeignKey path to JoinEdge shape for output
  const join_path = path.map((fk) => ({
    from: fk.from_table,
    from_col: fk.from_col,
    to: fk.to_table,
    to_col: fk.to_col,
  }));

  return mcpContent({
    sql,
    tables: joinedTables.length > 0 ? joinedTables : args.tables.slice(0, 1),
    join_path,
    warnings,
  });
}

// ─── db_report_run ──────────────────────────────────────────────────────────

export async function db_report_run(
  args: {
    engine: Engine;
    snippet_names: string[];
    merge?: ReportMergeMode;
    join_on?: JoinOnSpec[];
    connection?: string;
    cap?: number;
  },
  deps: ReportDeps
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }

  if (!Array.isArray(args.snippet_names) || args.snippet_names.length === 0) {
    return toolError("snippet_names must be a non-empty array");
  }

  const mode: ReportMergeMode = args.merge ?? "object";

  if (mode === "join" && (!args.join_on || args.join_on.length === 0)) {
    return toolError("merge='join' requires join_on parameter");
  }

  const cap = Math.min(args.cap ?? REPORT_HARD_CAP, REPORT_HARD_CAP);
  const outcomes: SnippetRunOutcome[] = [];
  const errors: { snippet_name: string; message: string }[] = [];

  for (const name of args.snippet_names) {
    // 1. Fetch snippet
    const snippet = await deps.snippetStore.get({
      project: deps.project,
      engine: args.engine,
      name,
    });

    if (!snippet) {
      errors.push({ snippet_name: name, message: `Snippet not found: ${name}` });
      continue;
    }

    // 2. Per-snippet write-guard (W6 pattern — applied BEFORE execution)
    try {
      const guard = makeWriteGuard(args.engine);
      checkWriteAllowed(guard, snippet.body, { allowWrite: deps.allowWrite ?? false });
    } catch (err) {
      errors.push({
        snippet_name: name,
        message: err instanceof Error ? err.message : String(err),
      });
      // Stop the whole sequence on write-guard failure — subsequent snippets must NOT run
      break;
    }

    // 3. Execute via query runner
    if (!deps.queryRunner) {
      errors.push({ snippet_name: name, message: "No query runner provided" });
      continue;
    }

    try {
      const raw = await deps.queryRunner(
        { engine: args.engine, body: snippet.body, connection: args.connection },
        undefined
      ) as { rows?: Row[]; docs?: Row[]; reply?: unknown; kind?: string };

      const rows: Row[] =
        raw.rows ??
        raw.docs ??
        (raw.reply !== undefined ? [{ reply: raw.reply }] : []);

      const kind =
        raw.rows !== undefined ? "rows" :
        raw.docs !== undefined ? "docs" :
        raw.reply !== undefined ? "reply" : "void";

      outcomes.push({
        snippet_name: name,
        rows,
        kind: kind as "rows" | "docs" | "reply" | "void",
      });

      // Increment usage counter (matches db_snippet_run side-effect)
      await deps.snippetStore.incrementUsage({
        project: deps.project,
        engine: args.engine,
        name,
      });
    } catch (err) {
      errors.push({
        snippet_name: name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Apply merge mode
  if (mode === "object") {
    const merged = mergeObject(outcomes);
    // REQ-30: apply 1000-row total cap across all snippet results in object mode
    let total = 0;
    let _truncated = false;
    const _total_rows = Object.values(merged).reduce((sum, rows) => sum + rows.length, 0);
    const capped: Record<string, Row[]> = {};
    for (const [snippetName, rows] of Object.entries(merged)) {
      if (total >= cap) {
        capped[snippetName] = [];
        _truncated = true;
        continue;
      }
      const remaining = cap - total;
      if (rows.length > remaining) {
        capped[snippetName] = rows.slice(0, remaining);
        _truncated = true;
      } else {
        capped[snippetName] = rows;
      }
      total += capped[snippetName]!.length;
    }
    return mcpContent({ mode, result: capped, errors, _truncated, _total_rows: _truncated ? _total_rows : _total_rows });
  }

  if (mode === "union") {
    const { rows, _truncated, total_before_cap } = mergeUnion(outcomes, cap);
    return mcpContent({
      mode,
      result: rows,
      _truncated,
      _total_rows: total_before_cap,
      errors,
    });
  }

  // mode === "join"
  const { rows, _truncated } = mergeJoin(outcomes, args.join_on ?? [], cap);
  const _total_rows = _truncated ? rows.length + 1 : rows.length; // best estimate
  return mcpContent({ mode, result: rows, _truncated, _total_rows, errors });
}
