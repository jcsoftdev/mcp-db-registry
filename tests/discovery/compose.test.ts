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
