import type { Engine, EngineDriver, QueryResult, ResolvedConfig, Row } from "../types.js";
import { toolError } from "../util/errors.js";
import { makeWriteGuard, checkWriteAllowed } from "../safety/write-detect.js";

const ENGINES: Engine[] = ["postgres", "mysql", "mongo", "redis", "sqlite"];

const DEFAULT_LIMIT = 100;
const HARD_CAP = 1000;

export interface DbDeps {
  getDriver(engine: Engine): EngineDriver;
  resolveConfig(engine: Engine, connectionName: string): Promise<ResolvedConfig>;
  allowWrite?: boolean;
}

function isValidEngine(e: string): e is Engine {
  return ENGINES.includes(e as Engine);
}

function truncateRows(result: QueryResult, limit: number): {
  rows: Row[];
  _truncated: boolean;
  _total_rows: number;
} | null {
  if (result.kind !== "rows") return null;
  const cap = Math.min(limit, HARD_CAP);
  const truncated = result.rows.length > cap;
  return {
    rows: truncated ? result.rows.slice(0, cap) : result.rows,
    _truncated: truncated,
    _total_rows: result.rowCount,
  };
}

function extractPlan(result: QueryResult): string {
  if (result.kind === "reply") return String(result.reply);
  if (result.kind === "rows") return result.rows.map((r) => JSON.stringify(r)).join("\n");
  if (result.kind === "docs") return result.docs.map((d) => JSON.stringify(d)).join("\n");
  return "";
}

export async function db_query(
  args: { engine: Engine; body: string; connection?: string; params?: unknown[]; limit?: number },
  deps: DbDeps
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }

  const writeAllowed = deps.allowWrite ?? false;
  try {
    const guard = makeWriteGuard(args.engine);
    checkWriteAllowed(guard, args.body, { allowWrite: writeAllowed });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }

  let cfg: ResolvedConfig;
  try {
    cfg = await deps.resolveConfig(args.engine, args.connection ?? "main");
  } catch (err) {
    return toolError(`Config resolution failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  const driver = deps.getDriver(args.engine);
  let conn: { engine: Engine; native: unknown };
  try {
    conn = await driver.connect(cfg) as { engine: Engine; native: unknown };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(`Connection failed [${args.engine}]: ${msg}`);
  }

  try {
    const raw = await driver.query(conn, args.body, args.params);
    const limit = args.limit ?? DEFAULT_LIMIT;

    if (raw.kind === "rows") {
      const r = truncateRows(raw, limit)!;
      return r;
    }
    if (raw.kind === "docs") {
      const cap = Math.min(limit, HARD_CAP);
      const truncated = raw.docs.length > cap;
      return { docs: truncated ? raw.docs.slice(0, cap) : raw.docs, truncated };
    }
    if (raw.kind === "reply") {
      return { reply: raw.reply };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(`Query failed [${args.engine}]: ${msg}`);
  } finally {
    driver.close(conn).catch(() => {});
  }
}

export async function db_list(
  args: { engine: Engine; kind?: string },
  deps: DbDeps
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }

  let cfg: ResolvedConfig;
  try {
    cfg = await deps.resolveConfig(args.engine, "main");
  } catch (err) {
    return toolError(`Config resolution failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  const driver = deps.getDriver(args.engine);
  let conn: { engine: Engine; native: unknown };
  try {
    conn = await driver.connect(cfg) as { engine: Engine; native: unknown };
  } catch (err) {
    return toolError(`Connection failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const kind = (args.kind as "tables" | "collections" | "keys" | "indexes") ?? "tables";
    const items = await driver.list(conn, kind);
    return { items };
  } catch (err) {
    return toolError(`List failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    driver.close(conn).catch(() => {});
  }
}

export async function db_describe(
  args: { engine: Engine; target: string },
  deps: DbDeps
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }
  if (!args.target) {
    return toolError("Missing required field: target");
  }

  let cfg: ResolvedConfig;
  try {
    cfg = await deps.resolveConfig(args.engine, "main");
  } catch (err) {
    return toolError(`Config resolution failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  const driver = deps.getDriver(args.engine);
  let conn: { engine: Engine; native: unknown };
  try {
    conn = await driver.connect(cfg) as { engine: Engine; native: unknown };
  } catch (err) {
    return toolError(`Connection failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const schema = await driver.describe(conn, args.target);
    return { schema };
  } catch (err) {
    return toolError(`Describe failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    driver.close(conn).catch(() => {});
  }
}

export async function db_explain(
  args: { engine: Engine; body: string },
  deps: DbDeps
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }

  let cfg: ResolvedConfig;
  try {
    cfg = await deps.resolveConfig(args.engine, "main");
  } catch (err) {
    return toolError(`Config resolution failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  const driver = deps.getDriver(args.engine);
  let conn: { engine: Engine; native: unknown };
  try {
    conn = await driver.connect(cfg) as { engine: Engine; native: unknown };
  } catch (err) {
    return toolError(`Connection failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const raw = await driver.explain(conn, args.body);
    return { plan: extractPlan(raw) };
  } catch (err) {
    return toolError(`Explain failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    driver.close(conn).catch(() => {});
  }
}

export async function db_connection_info(
  args: { engine: Engine; connection?: string },
  deps: Pick<DbDeps, "resolveConfig">
): Promise<unknown> {
  if (!isValidEngine(args.engine)) {
    return toolError(`Unsupported engine: ${args.engine}. Valid values: ${ENGINES.join(", ")}`);
  }

  let cfg: ResolvedConfig;
  try {
    cfg = await deps.resolveConfig(args.engine, args.connection ?? "main");
  } catch (err) {
    return toolError(`Config resolution failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { password: _pw, ...safe } = cfg;
  const sourceWithoutPassword = { ...cfg.source };
  delete (sourceWithoutPassword as Record<string, unknown>).password;

  return {
    ...safe,
    source: sourceWithoutPassword,
  };
}

export async function db_engines(
  _args: Record<string, never>,
  deps: Pick<DbDeps, "resolveConfig">
): Promise<unknown> {
  const results: { name: Engine; available: boolean; discovered_via: string }[] = [];

  for (const engine of ENGINES) {
    try {
      const cfg = await deps.resolveConfig(engine, "main");
      const sourceValues = Object.values(cfg.source ?? {});
      const hasNonDefault = sourceValues.some((s) => s !== "default");
      results.push({ name: engine, available: hasNonDefault, discovered_via: sourceValues[0] ?? "default" });
    } catch {
      results.push({ name: engine, available: false, discovered_via: "none" });
    }
  }

  return { engines: results };
}
