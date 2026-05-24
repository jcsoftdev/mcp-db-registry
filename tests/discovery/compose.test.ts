import { describe, it, expect } from "bun:test";
import { parseCompose } from "../../src/discovery/compose.js";
import type { Engine } from "../../src/types.js";

// ── fixture helpers ───────────────────────────────────────────────────────────

const postgresCompose = `
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
    ports:
      - "5433:5432"
`;

const mysqlCompose = `
services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: rootpw
      MYSQL_DATABASE: shopdb
    ports:
      - "3307:3306"
`;

const mongoCompose = `
services:
  mongo:
    image: mongo:7
    ports:
      - "27018:27017"
`;

const redisCompose = `
services:
  cache:
    image: redis:7
    ports:
      - "6380:6379"
`;

const sqliteCompose = `
services:
  app:
    image: myapp:latest
    environment:
      SQLITE_PATH: /data/app.sqlite
`;

const multiCompose = `
services:
  postgres:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mydb
    ports:
      - "5432:5432"
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
`;

const envArrayCompose = `
services:
  pg:
    image: postgres:15
    environment:
      - POSTGRES_USER=u
      - POSTGRES_PASSWORD=pw
      - POSTGRES_DB=db
    ports:
      - "5432:5432"
`;

// ── postgres ──────────────────────────────────────────────────────────────────

describe("parseCompose — postgres", () => {
  it("extracts host/port from mapped port", () => {
    const cfg = parseCompose(postgresCompose, "postgres");
    expect(cfg?.engine).toBe("postgres");
    expect(cfg?.host).toBe("localhost");
    expect(cfg?.port).toBe(5433);
  });

  it("extracts user/password/database from environment (object form)", () => {
    const cfg = parseCompose(postgresCompose, "postgres");
    expect(cfg?.user).toBe("appuser");
    expect(cfg?.password).toBe("secret");
    expect(cfg?.database).toBe("appdb");
  });

  it("parses environment as array form (KEY=VALUE)", () => {
    const cfg = parseCompose(envArrayCompose, "postgres");
    expect(cfg?.user).toBe("u");
    expect(cfg?.password).toBe("pw");
    expect(cfg?.database).toBe("db");
  });
});

// ── mysql ─────────────────────────────────────────────────────────────────────

describe("parseCompose — mysql", () => {
  it("extracts port 3307 from host mapping", () => {
    const cfg = parseCompose(mysqlCompose, "mysql");
    expect(cfg?.port).toBe(3307);
    expect(cfg?.engine).toBe("mysql");
  });

  it("extracts password and database", () => {
    const cfg = parseCompose(mysqlCompose, "mysql");
    expect(cfg?.password).toBe("rootpw");
    expect(cfg?.database).toBe("shopdb");
  });
});

// ── mongo ─────────────────────────────────────────────────────────────────────

describe("parseCompose — mongo", () => {
  it("extracts port 27018", () => {
    const cfg = parseCompose(mongoCompose, "mongo");
    expect(cfg?.port).toBe(27018);
    expect(cfg?.engine).toBe("mongo");
  });
});

// ── redis ─────────────────────────────────────────────────────────────────────

describe("parseCompose — redis", () => {
  it("extracts port 6380 from mapped port", () => {
    const cfg = parseCompose(redisCompose, "redis");
    expect(cfg?.port).toBe(6380);
    expect(cfg?.engine).toBe("redis");
  });
});

// ── sqlite ────────────────────────────────────────────────────────────────────

describe("parseCompose — sqlite", () => {
  it("extracts SQLITE_PATH from environment", () => {
    const cfg = parseCompose(sqliteCompose, "sqlite");
    expect(cfg?.database).toBe("/data/app.sqlite");
    expect(cfg?.engine).toBe("sqlite");
  });
});

// ── multi-service + not-found ─────────────────────────────────────────────────

describe("parseCompose — multi-service", () => {
  it("picks the correct service when multiple exist", () => {
    const cfg = parseCompose(multiCompose, "redis");
    expect(cfg?.engine).toBe("redis");
    expect(cfg?.port).toBe(6379);
  });

  it("returns null when no service matches the engine", () => {
    const cfg = parseCompose(mysqlCompose, "mongo" as Engine);
    expect(cfg).toBeNull();
  });
});

// ── variable interpolation ───────────────────────────────────────────────────

const interpolatedPostgres = `
services:
  db:
    image: postgres:\${PG_VERSION:-16}
    environment:
      POSTGRES_USER: \${DB_USER:-defaultuser}
      POSTGRES_PASSWORD: \${DB_PASSWORD:-defaultpw}
      POSTGRES_DB: \${DB_NAME:-defaultdb}
    ports:
      - "\${PG_HOST_PORT:-5433}:5432"
`;

const interpolatedArrayEnv = `
services:
  pg:
    image: postgres:15
    environment:
      - POSTGRES_USER=\${DB_USER:-arrdefault}
      - POSTGRES_PASSWORD=\${DB_PASSWORD-fallback}
      - POSTGRES_DB=\${DB_NAME}
    ports:
      - "\${PG_HOST_PORT:-5432}:5432"
`;

const nestedInterpolated = `
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: \${PRIMARY_USER:-\${SECONDARY_USER:-nesteddefault}}
    ports:
      - "5432:5432"
`;

const requiredVarCompose = `
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: \${MUST_BE_SET:?password required}
      POSTGRES_PASSWORD: pw
    ports:
      - "5432:5432"
`;

describe("parseCompose — variable interpolation", () => {
  it("expands defaults with :- when var is unset", () => {
    const cfg = parseCompose(interpolatedPostgres, "postgres");
    expect(cfg?.user).toBe("defaultuser");
    expect(cfg?.password).toBe("defaultpw");
    expect(cfg?.database).toBe("defaultdb");
    expect(cfg?.port).toBe(5433);
  });

  it("expands defaults with :- when var is empty string", () => {
    const cfg = parseCompose(interpolatedPostgres, "postgres", { DB_USER: "" });
    expect(cfg?.user).toBe("defaultuser");
  });

  it("uses provided env value over default", () => {
    const cfg = parseCompose(interpolatedPostgres, "postgres", {
      DB_USER: "realuser",
      DB_PASSWORD: "realpw",
      DB_NAME: "realdb",
      PG_HOST_PORT: "6543",
    });
    expect(cfg?.user).toBe("realuser");
    expect(cfg?.password).toBe("realpw");
    expect(cfg?.database).toBe("realdb");
    expect(cfg?.port).toBe(6543);
  });

  it("interpolates inside array env form (KEY=VALUE)", () => {
    const cfg = parseCompose(interpolatedArrayEnv, "postgres", { DB_NAME: "from_env" });
    expect(cfg?.user).toBe("arrdefault");
    expect(cfg?.password).toBe("fallback");
    expect(cfg?.database).toBe("from_env");
  });

  it("handles nested defaults", () => {
    const cfg1 = parseCompose(nestedInterpolated, "postgres");
    expect(cfg1?.user).toBe("nesteddefault");

    const cfg2 = parseCompose(nestedInterpolated, "postgres", { SECONDARY_USER: "two" });
    expect(cfg2?.user).toBe("two");

    const cfg3 = parseCompose(nestedInterpolated, "postgres", {
      PRIMARY_USER: "one",
      SECONDARY_USER: "two",
    });
    expect(cfg3?.user).toBe("one");
  });

  it("returns null when a ${VAR:?...} required variable is missing", () => {
    expect(parseCompose(requiredVarCompose, "postgres")).toBeNull();
  });

  it("parses normally when the required variable is provided", () => {
    const cfg = parseCompose(requiredVarCompose, "postgres", { MUST_BE_SET: "ok" });
    expect(cfg?.user).toBe("ok");
  });
});
