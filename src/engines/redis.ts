import Redis from "ioredis";
import type { Connection, EngineDriver, ForeignKey, QueryResult, ResolvedConfig, Row } from "../types.js";

type RedisClient = InstanceType<typeof Redis>;

export class RedisDriver implements EngineDriver<"redis"> {
  readonly engine = "redis" as const;

  async connect(cfg: ResolvedConfig): Promise<Connection<"redis">> {
    const native: RedisClient = cfg.url
      ? new Redis(cfg.url)
      : new Redis({ host: cfg.host, port: cfg.port, password: cfg.password });
    return { engine: "redis", native };
  }

  async close(conn: Connection<"redis">): Promise<void> {
    (conn.native as RedisClient).disconnect();
  }

  async ping(conn: Connection<"redis">): Promise<boolean> {
    try {
      await (conn.native as RedisClient).call("PING");
      return true;
    } catch {
      return false;
    }
  }

  async query(conn: Connection<"redis">, body: string, _params?: unknown[]): Promise<QueryResult> {
    const argv = body.trim().split(/\s+/);
    const [cmd, ...args] = argv;
    const reply = await (conn.native as RedisClient).call(cmd, ...args);
    return { kind: "reply", reply };
  }

  async list(conn: Connection<"redis">, _kind: "tables" | "collections" | "keys" | "indexes"): Promise<string[]> {
    return (conn.native as RedisClient).keys("*");
  }

  async describe(conn: Connection<"redis">, target: string): Promise<Row[]> {
    const client = conn.native as RedisClient;
    const [type, ttl] = await Promise.all([client.type(target), client.ttl(target)]);
    return [{ key: target, type, ttl }];
  }

  async getForeignKeys(_conn: Connection<"redis">, _tables: string[]): Promise<ForeignKey[]> {
    return [];
  }

  async explain(conn: Connection<"redis">, _body: string): Promise<QueryResult> {
    return { kind: "reply", reply: "EXPLAIN not supported for redis" };
  }
}
