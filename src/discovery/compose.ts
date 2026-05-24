import { parse as parseYaml } from "yaml";
import type { Engine } from "../types.js";
import { interpolateNode, RequiredVarError } from "./interpolate.js";

// Image regex patterns per engine — match common official image names
const ENGINE_IMAGE_RE: Record<Engine, RegExp> = {
  postgres: /postgres/i,
  mysql:    /mysql/i,
  mongo:    /mongo/i,
  redis:    /redis/i,
  sqlite:   /sqlite/i,
};

type PartialConfig = {
  engine: Engine;
  host: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
};

/**
 * Parses a docker-compose document and extracts a partial config for the requested engine.
 *
 * @param content Raw YAML content of docker-compose.yml.
 * @param engine  Engine to look up.
 * @param env     Optional map of variables used for Compose-style interpolation
 *                (`${VAR}`, `${VAR:-default}`, etc.). Callers typically pass
 *                `{ ...envFile, ...process.env }` so shell env wins over the local `.env`,
 *                matching Docker Compose's own precedence.
 */
export function parseCompose(
  content: string,
  engine: Engine,
  env: Record<string, string> = {}
): PartialConfig | null {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return null;
  }

  if (!doc || typeof doc !== "object") return null;

  // Apply Compose variable interpolation to every string in the document before
  // we extract fields. A missing required variable (${VAR:?...}) collapses the
  // whole parse so resolution falls through to the next discovery layer.
  try {
    doc = interpolateNode(doc, env);
  } catch (e) {
    if (e instanceof RequiredVarError) return null;
    throw e;
  }

  const root = doc as Record<string, unknown>;
  const services = root["services"];
  if (!services || typeof services !== "object") return null;

  const re = ENGINE_IMAGE_RE[engine];

  for (const [, svc] of Object.entries(services as Record<string, unknown>)) {
    if (!svc || typeof svc !== "object") continue;
    const s = svc as Record<string, unknown>;
    const image = typeof s["image"] === "string" ? s["image"] : "";

    if (!re.test(image)) {
      // sqlite has no official image; check environment for SQLITE_PATH
      if (engine === "sqlite") {
        const envMap = resolveEnvMap(s["environment"]);
        if (envMap["SQLITE_PATH"]) {
          return { engine: "sqlite", host: "localhost", port: 0, database: envMap["SQLITE_PATH"] };
        }
      }
      continue;
    }

    const envMap = resolveEnvMap(s["environment"]);
    const port = resolveHostPort(s["ports"], engine);

    switch (engine) {
      case "postgres":
        return {
          engine,
          host: "localhost",
          port,
          user: envMap["POSTGRES_USER"] ?? envMap["PGUSER"],
          password: envMap["POSTGRES_PASSWORD"] ?? envMap["PGPASSWORD"],
          database: envMap["POSTGRES_DB"] ?? envMap["PGDATABASE"],
        };
      case "mysql":
        return {
          engine,
          host: "localhost",
          port,
          user: envMap["MYSQL_USER"] ?? envMap["MYSQL_ROOT_USER"],
          password: envMap["MYSQL_PASSWORD"] ?? envMap["MYSQL_ROOT_PASSWORD"],
          database: envMap["MYSQL_DATABASE"] ?? envMap["MYSQL_DB"],
        };
      case "mongo":
        return {
          engine,
          host: "localhost",
          port,
          user: envMap["MONGO_INITDB_ROOT_USERNAME"] ?? envMap["MONGO_USER"],
          password: envMap["MONGO_INITDB_ROOT_PASSWORD"] ?? envMap["MONGO_PASSWORD"],
          database: envMap["MONGO_INITDB_DATABASE"] ?? envMap["MONGO_DB"],
        };
      case "redis":
        return {
          engine,
          host: "localhost",
          port,
          password: envMap["REDIS_PASSWORD"],
        };
      case "sqlite":
        return {
          engine,
          host: "localhost",
          port: 0,
          database: envMap["SQLITE_PATH"],
        };
    }
  }

  return null;
}

function resolveEnvMap(env: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!env) return result;

  if (Array.isArray(env)) {
    // Array form: ["KEY=VALUE", ...]
    for (const item of env) {
      if (typeof item !== "string") continue;
      const eq = item.indexOf("=");
      if (eq === -1) continue;
      result[item.slice(0, eq)] = item.slice(eq + 1);
    }
  } else if (typeof env === "object") {
    // Object form: { KEY: "VALUE", ... }
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      result[k] = String(v ?? "");
    }
  }
  return result;
}

const ENGINE_DEFAULTS: Record<Engine, number> = {
  postgres: 5432,
  mysql:    3306,
  mongo:    27017,
  redis:    6379,
  sqlite:   0,
};

function resolveHostPort(ports: unknown, engine: Engine): number {
  if (!Array.isArray(ports)) return ENGINE_DEFAULTS[engine];

  for (const p of ports) {
    if (typeof p !== "string") continue;
    // "hostPort:containerPort" — extract left side
    const m = p.match(/^"?(\d+):\d+"?$/);
    if (m) return parseInt(m[1], 10);
  }
  return ENGINE_DEFAULTS[engine];
}
