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

  // 1. Stored credential
  const stored = await opts.store.get({
    project: opts.cwd,
    engine: opts.engine,
    connectionName: opts.connectionName,
  });
  if (stored) {
    const cfg = buildConfig({ host: stored, port: 0 }, opts.engine, "stored");
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
  if (envContent) {
    const env = parseEnvFile(envContent);
    const fromEnv = mapEnvToConfig(env, opts.engine);
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
    const fromCompose = parseCompose(composeContent, opts.engine);
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
