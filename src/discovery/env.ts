import type { Engine, ResolvedConfig } from "../types.js";

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip inline comment (outside quotes)
    if (val.startsWith('"')) {
      const close = val.indexOf('"', 1);
      val = close !== -1 ? val.slice(1, close) : val.slice(1);
    } else if (val.startsWith("'")) {
      const close = val.indexOf("'", 1);
      val = close !== -1 ? val.slice(1, close) : val.slice(1);
    } else {
      val = val.split("#")[0].trim();
    }
    result[key] = val;
  }
  return result;
}

type PartialConfig = Pick<ResolvedConfig, "engine" | "host" | "port"> &
  Partial<Pick<ResolvedConfig, "user" | "password" | "database" | "url">>;

export function mapEnvToConfig(
  env: Record<string, string>,
  engine: Engine
): PartialConfig | null {
  switch (engine) {
    case "postgres": return mapPostgres(env);
    case "mysql":    return mapMysql(env);
    case "mongo":    return mapMongo(env);
    case "redis":    return mapRedis(env);
    case "sqlite":   return mapSqlite(env);
  }
}

function mapPostgres(env: Record<string, string>): PartialConfig | null {
  const url =
    env["POSTGRES_URL"] ?? env["PG_URL"] ??
    (env["DATABASE_URL"]?.startsWith("postgres") ? env["DATABASE_URL"] : undefined);

  if (url) return { engine: "postgres", host: "localhost", port: 5432, url };

  const host = env["PGHOST"] ?? env["POSTGRES_HOST"];
  if (!host) return null;

  return {
    engine: "postgres",
    host,
    port: parseInt(env["PGPORT"] ?? env["POSTGRES_PORT"] ?? "5432", 10),
    user: env["PGUSER"] ?? env["POSTGRES_USER"],
    password: env["PGPASSWORD"] ?? env["POSTGRES_PASSWORD"],
    database: env["PGDATABASE"] ?? env["POSTGRES_DB"],
  };
}

function mapMysql(env: Record<string, string>): PartialConfig | null {
  const url =
    env["MYSQL_URL"] ??
    (env["DATABASE_URL"]?.startsWith("mysql") ? env["DATABASE_URL"] : undefined);

  if (url) return { engine: "mysql", host: "localhost", port: 3306, url };

  const host = env["MYSQL_HOST"];
  if (!host) return null;

  return {
    engine: "mysql",
    host,
    port: parseInt(env["MYSQL_PORT"] ?? "3306", 10),
    user: env["MYSQL_USER"],
    password: env["MYSQL_PASSWORD"],
    database: env["MYSQL_DATABASE"] ?? env["MYSQL_DB"],
  };
}

function mapMongo(env: Record<string, string>): PartialConfig | null {
  const url = env["MONGODB_URI"] ?? env["MONGO_URL"];
  if (url) return { engine: "mongo", host: "localhost", port: 27017, url };

  const host = env["MONGO_HOST"];
  if (!host) return null;

  return {
    engine: "mongo",
    host,
    port: parseInt(env["MONGO_PORT"] ?? "27017", 10),
    user: env["MONGO_USER"],
    password: env["MONGO_PASSWORD"],
    database: env["MONGO_DB"],
  };
}

function mapRedis(env: Record<string, string>): PartialConfig | null {
  const url = env["REDIS_URL"];
  if (url) return { engine: "redis", host: "localhost", port: 6379, url };

  const host = env["REDIS_HOST"];
  if (!host) return null;

  return {
    engine: "redis",
    host,
    port: parseInt(env["REDIS_PORT"] ?? "6379", 10),
    password: env["REDIS_PASSWORD"],
    database: env["REDIS_DB"],
  };
}

function mapSqlite(env: Record<string, string>): PartialConfig | null {
  if (env["SQLITE_PATH"]) {
    return { engine: "sqlite", host: "localhost", port: 0, database: env["SQLITE_PATH"] };
  }
  const dbUrl = env["DATABASE_URL"];
  if (dbUrl?.startsWith("file:")) {
    return { engine: "sqlite", host: "localhost", port: 0, database: dbUrl.slice(5) };
  }
  return null;
}
