import type { Engine, WriteGuard } from "../types.js";
import { isReadOnlySql } from "./sql.js";
import { isReadOnlyMongoOp, type MongoOp } from "./mongo.js";
import { isReadOnlyRedisCmd } from "./redis.js";

class SqlWriteGuard implements WriteGuard {
  constructor(readonly engine: Engine) {}
  isReadOnly(body: unknown): boolean {
    return isReadOnlySql(String(body));
  }
}

class MongoWriteGuard implements WriteGuard {
  readonly engine: Engine = "mongo";
  isReadOnly(body: unknown): boolean {
    return isReadOnlyMongoOp(body as MongoOp);
  }
}

class RedisWriteGuard implements WriteGuard {
  readonly engine: Engine = "redis";
  isReadOnly(body: unknown): boolean {
    return isReadOnlyRedisCmd(body as string[]);
  }
}

export function makeWriteGuard(engine: Engine): WriteGuard {
  switch (engine) {
    case "postgres":
    case "mysql":
    case "sqlite":
      return new SqlWriteGuard(engine);
    case "mongo":
      return new MongoWriteGuard();
    case "redis":
      return new RedisWriteGuard();
  }
}

export interface CheckWriteOpts {
  allowWrite?: boolean;
}

export function checkWriteAllowed(
  guard: WriteGuard,
  body: unknown,
  opts: CheckWriteOpts = {}
): void {
  if (guard.isReadOnly(body)) return;

  const envAllowed = process.env["DB_REGISTRY_ALLOW_WRITE"] === "1";
  if (envAllowed || opts.allowWrite) return;

  throw new Error(
    "Write operation blocked. Set DB_REGISTRY_ALLOW_WRITE=1 to allow write operations."
  );
}
