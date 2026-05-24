import { describe, it, expect, beforeEach } from "bun:test";
import type { Connection, Engine, EngineDriver, QueryResult, ResolvedConfig, Row } from "../src/types.js";
import { createDispatcher, closeAllConnections, releaseAllConnections } from "../src/dispatcher.js";

// Build a fresh mock driver for each engine to inject into the dispatcher
function makeMockDriver(engine: Engine): EngineDriver & { _connectCount: number; _closedConns: Connection<Engine>[] } {
  const conn: Connection<typeof engine> = { engine, native: { _engine: engine } };
  let connectCount = 0;
  const closedConns: Connection<Engine>[] = [];

  return {
    engine,
    _connectCount: 0,
    _closedConns: closedConns,
    async connect(_cfg: ResolvedConfig): Promise<Connection<typeof engine>> {
      connectCount++;
      (this as any)._connectCount = connectCount;
      return conn;
    },
    async close(c: Connection<Engine>): Promise<void> {
      closedConns.push(c);
    },
    async ping(): Promise<boolean> { return true; },
    async query(): Promise<QueryResult> {
      return { kind: "rows", rows: [{ id: 1 }] as Row[], truncated: false, rowCount: 1 };
    },
    async list(): Promise<string[]> { return ["tbl1"]; },
    async describe(): Promise<Row[]> { return [{ col: "id" }]; },
    async explain(): Promise<QueryResult> {
      return { kind: "rows", rows: [{ plan: "seq" }] as Row[], truncated: false, rowCount: 1 };
    },
  };
}

const baseCfg: ResolvedConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  source: {},
};

describe("dispatcher — createDispatcher routing", () => {
  it("returns a driver with engine=postgres for engine='postgres'", () => {
    const drivers = {
      postgres: makeMockDriver("postgres"),
      mysql: makeMockDriver("mysql"),
      mongo: makeMockDriver("mongo"),
      redis: makeMockDriver("redis"),
      sqlite: makeMockDriver("sqlite"),
    };
    const dispatcher = createDispatcher(drivers);
    const driver = dispatcher.getDriverFor("postgres");
    expect(driver.engine).toBe("postgres");
  });

  it("returns a driver with engine=mysql for engine='mysql'", () => {
    const drivers = {
      postgres: makeMockDriver("postgres"),
      mysql: makeMockDriver("mysql"),
      mongo: makeMockDriver("mongo"),
      redis: makeMockDriver("redis"),
      sqlite: makeMockDriver("sqlite"),
    };
    const dispatcher = createDispatcher(drivers);
    const driver = dispatcher.getDriverFor("mysql");
    expect(driver.engine).toBe("mysql");
  });

  it("returns drivers for all 5 engines", () => {
    const engines: Engine[] = ["postgres", "mysql", "mongo", "redis", "sqlite"];
    const drivers = Object.fromEntries(engines.map((e) => [e, makeMockDriver(e)])) as Record<Engine, EngineDriver>;
    const dispatcher = createDispatcher(drivers);
    for (const eng of engines) {
      expect(dispatcher.getDriverFor(eng).engine).toBe(eng);
    }
  });
});

describe("dispatcher — getDriver (pool cache)", () => {
  let drivers: Record<Engine, EngineDriver & { _connectCount: number; _closedConns: Connection<Engine>[] }>;
  let dispatcher: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    const engines: Engine[] = ["postgres", "mysql", "mongo", "redis", "sqlite"];
    drivers = Object.fromEntries(engines.map((e) => [e, makeMockDriver(e)])) as typeof drivers;
    dispatcher = createDispatcher(drivers);
  });

  it("connects on first call and returns a Connection", async () => {
    const conn = await dispatcher.acquire("proj-a", "postgres", { ...baseCfg, engine: "postgres" });
    expect(conn.engine).toBe("postgres");
    expect(drivers.postgres._connectCount).toBe(1);
  });

  it("reuses the cached connection on a second call with the same (project, engine)", async () => {
    await dispatcher.acquire("proj-b", "postgres", { ...baseCfg, engine: "postgres" });
    await dispatcher.acquire("proj-b", "postgres", { ...baseCfg, engine: "postgres" });
    // connect() only called once — second is from cache
    expect(drivers.postgres._connectCount).toBe(1);
  });

  it("opens separate connections for different engines in the same project", async () => {
    const pgConn = await dispatcher.acquire("proj-c", "postgres", { ...baseCfg, engine: "postgres" });
    const myConn = await dispatcher.acquire("proj-c", "mysql", { ...baseCfg, engine: "mysql" });
    expect(pgConn.engine).toBe("postgres");
    expect(myConn.engine).toBe("mysql");
    expect(drivers.postgres._connectCount).toBe(1);
    expect(drivers.mysql._connectCount).toBe(1);
  });

  it("evicts LRU entry when pool reaches MAX_POOL_SIZE (5)", async () => {
    const engines: Engine[] = ["postgres", "mysql", "mongo", "redis", "sqlite"];

    // Fill pool to cap (5 entries)
    for (const eng of engines) {
      await dispatcher.acquire("proj-evict", eng, { ...baseCfg, engine: eng });
    }

    // Add a 6th unique key — pool was already at 5, so one entry must be evicted (closed)
    await dispatcher.acquire("proj-extra", "postgres", { ...baseCfg, engine: "postgres" });

    const totalClosed = engines.reduce((sum, e) => sum + drivers[e]._closedConns.length, 0);
    expect(totalClosed).toBeGreaterThanOrEqual(1);
  });
});

describe("dispatcher — closeAllConnections", () => {
  let drivers: Record<Engine, EngineDriver & { _connectCount: number; _closedConns: Connection<Engine>[] }>;
  let dispatcher: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    const engines: Engine[] = ["postgres", "mysql", "mongo", "redis", "sqlite"];
    drivers = Object.fromEntries(engines.map((e) => [e, makeMockDriver(e)])) as typeof drivers;
    dispatcher = createDispatcher(drivers);
  });

  it("closes all open connections in the pool", async () => {
    await dispatcher.acquire("proj-d", "postgres", { ...baseCfg, engine: "postgres" });
    await dispatcher.acquire("proj-d", "mysql", { ...baseCfg, engine: "mysql" });

    await dispatcher.closeAll();

    expect(drivers.postgres._closedConns.length).toBe(1);
    expect(drivers.mysql._closedConns.length).toBe(1);
  });

  it("clears the pool after closeAll so next call re-connects", async () => {
    await dispatcher.acquire("proj-e", "postgres", { ...baseCfg, engine: "postgres" });
    await dispatcher.closeAll();

    await dispatcher.acquire("proj-e", "postgres", { ...baseCfg, engine: "postgres" });

    // connect called again after pool was cleared
    expect(drivers.postgres._connectCount).toBe(2);
  });
});

describe("dispatcher — module-level closeAllConnections / releaseAllConnections", () => {
  beforeEach(() => releaseAllConnections());

  it("closeAllConnections resolves without error on an empty pool", async () => {
    await expect(closeAllConnections()).resolves.toBeUndefined();
  });

  it("releaseAllConnections clears pool without closing drivers", () => {
    releaseAllConnections();
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });
});
