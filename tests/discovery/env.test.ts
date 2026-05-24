import { describe, it, expect } from "bun:test";
import { parseEnvFile, mapEnvToConfig } from "../../src/discovery/env.js";
import type { Engine } from "../../src/types.js";

// ── parseEnvFile ─────────────────────────────────────────────────────────────

describe("parseEnvFile", () => {
  it("parses key=value pairs", () => {
    const result = parseEnvFile("HOST=localhost\nPORT=5432\n");
    expect(result["HOST"]).toBe("localhost");
    expect(result["PORT"]).toBe("5432");
  });

  it("strips inline comments", () => {
    const result = parseEnvFile("HOST=localhost # production host\n");
    expect(result["HOST"]).toBe("localhost");
  });

  it("handles double-quoted values preserving spaces", () => {
    const result = parseEnvFile('DB_PASS="my secret pass"\n');
    expect(result["DB_PASS"]).toBe("my secret pass");
  });

  it("handles single-quoted values", () => {
    const result = parseEnvFile("DB_NAME='my_db'\n");
    expect(result["DB_NAME"]).toBe("my_db");
  });

  it("skips blank lines and comment lines", () => {
    const result = parseEnvFile("# comment\n\nFOO=bar\n");
    expect(result["FOO"]).toBe("bar");
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("returns empty object for empty input", () => {
    const result = parseEnvFile("");
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── mapEnvToConfig — postgres ─────────────────────────────────────────────────

describe("mapEnvToConfig — postgres", () => {
  const engine: Engine = "postgres";

  it("parses POSTGRES_URL", () => {
    const env = { POSTGRES_URL: "postgres://u:p@host:5432/mydb" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.url).toBe("postgres://u:p@host:5432/mydb");
    expect(cfg?.engine).toBe("postgres");
  });

  it("parses DATABASE_URL with postgres scheme", () => {
    const env = { DATABASE_URL: "postgres://u:p@db:5433/appdb" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.url).toBe("postgres://u:p@db:5433/appdb");
  });

  it("parses individual PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE vars", () => {
    const env = { PGHOST: "db.prod", PGPORT: "5433", PGUSER: "admin", PGPASSWORD: "s3cr3t", PGDATABASE: "app" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.host).toBe("db.prod");
    expect(cfg?.port).toBe(5433);
    expect(cfg?.user).toBe("admin");
    expect(cfg?.password).toBe("s3cr3t");
    expect(cfg?.database).toBe("app");
  });

  it("parses POSTGRES_HOST / POSTGRES_PORT / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB vars", () => {
    const env = { POSTGRES_HOST: "pg.local", POSTGRES_PORT: "5434", POSTGRES_USER: "u", POSTGRES_PASSWORD: "pw", POSTGRES_DB: "db" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.host).toBe("pg.local");
    expect(cfg?.port).toBe(5434);
    expect(cfg?.database).toBe("db");
  });

  it("returns null when no postgres vars present", () => {
    const env = { REDIS_URL: "redis://localhost:6379" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg).toBeNull();
  });
});

// ── mapEnvToConfig — mysql ────────────────────────────────────────────────────

describe("mapEnvToConfig — mysql", () => {
  const engine: Engine = "mysql";

  it("parses MYSQL_URL", () => {
    const env = { MYSQL_URL: "mysql://u:p@host:3306/mydb" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.url).toBe("mysql://u:p@host:3306/mydb");
  });

  it("parses DATABASE_URL with mysql scheme", () => {
    const env = { DATABASE_URL: "mysql://u:p@host:3306/mydb" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.url).toBe("mysql://u:p@host:3306/mydb");
  });

  it("parses MYSQL_HOST/PORT/USER/PASSWORD/DATABASE", () => {
    const env = { MYSQL_HOST: "db", MYSQL_PORT: "3307", MYSQL_USER: "root", MYSQL_PASSWORD: "pw", MYSQL_DATABASE: "shop" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.host).toBe("db");
    expect(cfg?.port).toBe(3307);
    expect(cfg?.database).toBe("shop");
  });

  it("returns null when no mysql vars present", () => {
    const env = { PGHOST: "localhost" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg).toBeNull();
  });
});

// ── mapEnvToConfig — mongo ────────────────────────────────────────────────────

describe("mapEnvToConfig — mongo", () => {
  const engine: Engine = "mongo";

  it("parses MONGODB_URI", () => {
    const env = { MONGODB_URI: "mongodb://u:p@localhost:27017/db" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.url).toBe("mongodb://u:p@localhost:27017/db");
  });

  it("parses MONGO_URL", () => {
    const env = { MONGO_URL: "mongodb://localhost:27017" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.url).toBe("mongodb://localhost:27017");
  });

  it("parses MONGO_HOST/PORT/USER/PASSWORD/DB", () => {
    const env = { MONGO_HOST: "m.host", MONGO_PORT: "27018", MONGO_USER: "u", MONGO_PASSWORD: "pw", MONGO_DB: "app" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.host).toBe("m.host");
    expect(cfg?.port).toBe(27018);
    expect(cfg?.database).toBe("app");
  });

  it("returns null when no mongo vars present", () => {
    const env = { PGHOST: "localhost" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg).toBeNull();
  });
});

// ── mapEnvToConfig — redis ────────────────────────────────────────────────────

describe("mapEnvToConfig — redis", () => {
  const engine: Engine = "redis";

  it("parses REDIS_URL", () => {
    const env = { REDIS_URL: "redis://localhost:6379/0" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.url).toBe("redis://localhost:6379/0");
  });

  it("parses REDIS_HOST + REDIS_PORT", () => {
    const env = { REDIS_HOST: "r.host", REDIS_PORT: "6380" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.host).toBe("r.host");
    expect(cfg?.port).toBe(6380);
  });

  it("includes REDIS_PASSWORD when present", () => {
    const env = { REDIS_HOST: "r.host", REDIS_PORT: "6380", REDIS_PASSWORD: "secret" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.password).toBe("secret");
  });

  it("returns null when no redis vars present", () => {
    const env = { PGHOST: "localhost" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg).toBeNull();
  });
});

// ── mapEnvToConfig — sqlite ───────────────────────────────────────────────────

describe("mapEnvToConfig — sqlite", () => {
  const engine: Engine = "sqlite";

  it("parses SQLITE_PATH", () => {
    const env = { SQLITE_PATH: "/app/data/store.sqlite" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.database).toBe("/app/data/store.sqlite");
  });

  it("parses DATABASE_URL with file: scheme", () => {
    const env = { DATABASE_URL: "file:./data/app.db" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg?.database).toBe("./data/app.db");
  });

  it("returns null when no sqlite vars present", () => {
    const env = { PGHOST: "localhost" };
    const cfg = mapEnvToConfig(env, engine);
    expect(cfg).toBeNull();
  });
});
