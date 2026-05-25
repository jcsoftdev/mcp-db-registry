import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import type { Engine, ResolvedConfig, ConfigSource } from "../types.js";
import { parseEnvFile, mapEnvToConfig } from "./env.js";
import { parseCompose } from "./compose.js";
import { defaultsFor } from "./defaults.js";
import type { PortRegistryClient } from "./port-registry.js";

type StoreShape = {
  get(opts: { project: string; engine: Engine; connectionName: string }): Promise<string | null>;
};

type PortRegistryShape = {
  get(engine: Engine): Promise<{ host: string; port: number } | null>;
};

export interface ResolveOpts {
  engine: Engine;
  connectionName: string;
  cwd: string;
  /** Resolved project identity used by the credential store. Defaults to cwd
   * for backwards compatibility, but callers SHOULD pass the same value used
   * by `db_credentials_save` (i.e. resolved via util/project.projectId) so
   * stored credentials can be looked up successfully. */
  project?: string;
  store: StoreShape;
  portRegistry?: PortRegistryShape;
  /** Injected env file content for testing (skips fs.readFile when provided). */
  envContent?: string;
  /** Injected compose file content for testing. */
  composeContent?: string;
}

type CacheKey = string;
type CacheEntry = { config: ResolvedConfig; envMtime?: number; composeMtime?: number };

const CACHE = new Map<CacheKey, CacheEntry>();

export function clearDiscoveryCache(): void {
  CACHE.clear();
}

function cacheKey(opts: ResolveOpts): CacheKey {
  return `${opts.cwd}::${opts.engine}::${opts.connectionName}`;
}

async function getMtime(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return undefined;
  }
}

function buildConfig(
  partial: { host: string; port: number; user?: string; password?: string; database?: string; url?: string },
  engine: Engine,
  source: ConfigSource
): ResolvedConfig {
  const cfg: ResolvedConfig = {
    engine,
    host: partial.host,
    port: partial.port,
    source: {
      host: source,
      port: source,
    },
  };
  if (partial.user !== undefined) { cfg.user = partial.user; cfg.source.user = source; }
  if (partial.password !== undefined) { cfg.password = partial.password; cfg.source.password = source; }
  if (partial.database !== undefined) { cfg.database = partial.database; cfg.source.database = source; }
  if (partial.url !== undefined) { cfg.url = partial.url; cfg.source.url = source; }
  return cfg;
}

export async function resolveConnection(opts: ResolveOpts): Promise<ResolvedConfig> {
  const key = cacheKey(opts);
  const envPath = path.join(opts.cwd, ".env");
  const composePath = path.join(opts.cwd, "docker-compose.yml");
  const composePath2 = path.join(opts.cwd, "docker-compose.yaml");

  // Check cache — validate mtimes unless content was injected (test mode)
  const cached = CACHE.get(key);
  if (cached && !opts.envContent && !opts.composeContent) {
    const envMtime = await getMtime(envPath);
    const composeMtime = (await getMtime(composePath)) ?? (await getMtime(composePath2));
    if (cached.envMtime === envMtime && cached.composeMtime === composeMtime) {
      return cached.config;
    }
    CACHE.delete(key);
  } else if (cached && (opts.envContent !== undefined || opts.composeContent !== undefined)) {
    // In test mode, cache by key — return if already cached
    return cached.config;
  }

  // 1. Stored credential — keyed by resolved projectId (matches db_credentials_save).
  const stored = await opts.store.get({
    project: opts.project ?? opts.cwd,
    engine: opts.engine,
    connectionName: opts.connectionName,
  });
  if (stored) {
    const cfg = parseStoredDsn(stored, opts.engine);
    cache(key, cfg);
    return cfg;
  }

  // 2. .env
  let envContent = opts.envContent;
  let envMtime: number | undefined;
  if (envContent === undefined) {
    envMtime = await getMtime(envPath);
    if (envMtime !== undefined) {
      envContent = await readFile(envPath, "utf8").catch(() => "");
    }
  }
  // Parse .env once — used both for direct config mapping and for compose interpolation.
  const envFromFile = envContent ? parseEnvFile(envContent) : {};
  if (envContent) {
    const fromEnv = mapEnvToConfig(envFromFile, opts.engine);
    if (fromEnv) {
      const cfg = buildConfig(fromEnv, opts.engine, "env");
      cache(key, cfg, envMtime);
      return cfg;
    }
  }

  // 3. docker-compose.yml
  let composeContent = opts.composeContent;
  let composeMtime: number | undefined;
  if (composeContent === undefined) {
    const cp = (await getMtime(composePath) !== undefined) ? composePath : composePath2;
    composeMtime = await getMtime(cp);
    if (composeMtime !== undefined) {
      composeContent = await readFile(cp, "utf8").catch(() => "");
    }
  }
  if (composeContent) {
    // Compose precedence: shell env wins over .env for interpolation.
    const interpolationEnv: Record<string, string> = { ...envFromFile };
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") interpolationEnv[k] = v;
    }
    const fromCompose = parseCompose(composeContent, opts.engine, interpolationEnv);
    if (fromCompose) {
      const cfg = buildConfig(fromCompose, opts.engine, "compose");
      cache(key, cfg, envMtime, composeMtime);
      return cfg;
    }
  }

  // 4. port-registry MCP
  if (opts.portRegistry) {
    const fromPort = await opts.portRegistry.get(opts.engine);
    if (fromPort) {
      const cfg = buildConfig({ host: fromPort.host, port: fromPort.port }, opts.engine, "port-mcp");
      cache(key, cfg, envMtime, composeMtime);
      return cfg;
    }
  }

  // 5. Defaults
  const defaults = defaultsFor(opts.engine);
  const cfg = buildConfig(defaults, opts.engine, "default");
  cache(key, cfg, envMtime, composeMtime);
  return cfg;
}

function cache(key: string, config: ResolvedConfig, envMtime?: number, composeMtime?: number): void {
  CACHE.set(key, { config, envMtime, composeMtime });
}

/**
 * Parses a stored DSN string into a ResolvedConfig. Supports two forms:
 *  - Full connection URL (e.g. "postgres://user:pass@host:5432/db?sslmode=disable")
 *  - Bare host (legacy behavior — port 0, no user/pass)
 *
 * URL form is preferred because drivers can connect directly and we surface
 * the user/password/database that the caller supplied to `db_credentials_save`.
 */
function parseStoredDsn(stored: string, engine: Engine): ResolvedConfig {
  // URL-like (scheme://...) — extract components.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(stored)) {
    try {
      const u = new URL(stored);
      const partial: { host: string; port: number; user?: string; password?: string; database?: string; url?: string } = {
        host: u.hostname || "localhost",
        port: u.port ? parseInt(u.port, 10) : 0,
        url: stored,
      };
      if (u.username) partial.user = decodeURIComponent(u.username);
      if (u.password) partial.password = decodeURIComponent(u.password);
      const dbName = u.pathname.replace(/^\//, "");
      if (dbName) partial.database = dbName;
      return buildConfig(partial, engine, "stored");
    } catch {
      // fall through to bare-host fallback
    }
  }
  return buildConfig({ host: stored, port: 0 }, engine, "stored");
}
