import { PostgresDriver } from "./engines/postgres.js";
import { MysqlDriver } from "./engines/mysql.js";
import { MongoDriver } from "./engines/mongo.js";
import { RedisDriver } from "./engines/redis.js";
import { SqliteDriver } from "./engines/sqlite.js";
import type { Connection, Engine, EngineDriver, ResolvedConfig } from "./types.js";

const MAX_POOL_SIZE = 5;

type PoolKey = `${string}::${Engine}`;

interface PoolEntry {
  conn: Connection<Engine>;
  driver: EngineDriver;
  lastUsed: number;
}

export interface Dispatcher {
  getDriverFor(engine: Engine): EngineDriver;
  acquire(project: string, engine: Engine, cfg: ResolvedConfig): Promise<Connection<Engine>>;
  closeAll(): Promise<void>;
  release(): void;
}

export function createDispatcher(driverMap: Record<Engine, EngineDriver>): Dispatcher {
  const pool = new Map<PoolKey, PoolEntry>();

  function evictLRU(): void {
    let oldest: PoolKey | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of pool) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldest = k;
      }
    }
    if (oldest !== null) {
      const entry = pool.get(oldest)!;
      entry.driver.close(entry.conn).catch(noop);
      pool.delete(oldest);
    }
  }

  return {
    getDriverFor(engine: Engine): EngineDriver {
      return driverMap[engine];
    },

    async acquire(project: string, engine: Engine, cfg: ResolvedConfig): Promise<Connection<Engine>> {
      const key: PoolKey = `${project}::${engine}`;
      const hit = pool.get(key);
      if (hit) {
        hit.lastUsed = Date.now();
        return hit.conn;
      }
      if (pool.size >= MAX_POOL_SIZE) {
        evictLRU();
      }
      const driver = driverMap[engine];
      const conn = await driver.connect(cfg);
      pool.set(key, { conn, driver, lastUsed: Date.now() });
      return conn;
    },

    async closeAll(): Promise<void> {
      for (const [, entry] of pool) {
        await entry.driver.close(entry.conn).catch(noop);
      }
      pool.clear();
    },

    release(): void {
      pool.clear();
    },
  };
}

function buildDefaultDriverMap(): Record<Engine, EngineDriver> {
  return {
    postgres: new PostgresDriver(),
    mysql: new MysqlDriver(),
    mongo: new MongoDriver(),
    redis: new RedisDriver(),
    sqlite: new SqliteDriver(),
  };
}

const defaultDispatcher = createDispatcher(buildDefaultDriverMap());

export function getDriver(
  project: string,
  engine: Engine,
  cfg: ResolvedConfig
): Promise<Connection<Engine>> {
  return defaultDispatcher.acquire(project, engine, cfg);
}

export async function closeAllConnections(): Promise<void> {
  await defaultDispatcher.closeAll();
}

export function releaseAllConnections(): void {
  defaultDispatcher.release();
}

export function createDriver(engine: Engine): EngineDriver {
  return buildDefaultDriverMap()[engine];
}

function noop(_err?: unknown): void {}

process.on("SIGTERM", () => {
  defaultDispatcher.closeAll().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  defaultDispatcher.closeAll().finally(() => process.exit(0));
});
