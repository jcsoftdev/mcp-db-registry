import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock ioredis before importing the driver.
// ioredis exports a default class Redis with call(), keys(), type(), ttl(), disconnect() methods.

const mockCall = mock(() => Promise.resolve("OK"));
const mockKeys = mock(() => Promise.resolve(["key:1", "key:2"]));
const mockType = mock(() => Promise.resolve("string"));
const mockTtl = mock(() => Promise.resolve(3600));
const mockDisconnect = mock(() => undefined);
const mockGet = mock(() => Promise.resolve("value"));

const mockRedisInstance = {
  call: mockCall,
  keys: mockKeys,
  type: mockType,
  ttl: mockTtl,
  disconnect: mockDisconnect,
  get: mockGet,
};

const MockRedis = mock((_config: unknown) => mockRedisInstance);

mock.module("ioredis", () => ({ default: MockRedis }));

const { RedisDriver } = await import("../../src/engines/redis.js");

const cfg = {
  engine: "redis" as const,
  host: "localhost",
  port: 6379,
  source: {},
};

describe("RedisDriver — connect", () => {
  beforeEach(() => {
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);
  });

  it("creates a Redis client with host and port, returns a Connection", async () => {
    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);

    expect(MockRedis.mock.calls.length).toBe(1);
    const calledWith = MockRedis.mock.calls[0][0] as Record<string, unknown>;
    expect(calledWith.host).toBe("localhost");
    expect(calledWith.port).toBe(6379);
    expect(conn.engine).toBe("redis");
    expect(conn.native).toBe(mockRedisInstance);
  });

  it("uses cfg.url directly when provided", async () => {
    const driver = new RedisDriver();
    await driver.connect({ ...cfg, url: "redis://user:pass@myredis:6380" });

    const calledWith = MockRedis.mock.calls[0][0] as string;
    expect(calledWith).toBe("redis://user:pass@myredis:6380");
  });
});

describe("RedisDriver — query", () => {
  beforeEach(() => {
    mockCall.mockReset();
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);
  });

  it("sends GET command via call() and returns a reply result", async () => {
    mockCall.mockResolvedValue("hello-world");

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "GET mykey");

    expect(result.kind).toBe("reply");
    if (result.kind === "reply") {
      expect(result.reply).toBe("hello-world");
    }
    expect(mockCall.mock.calls[0]).toEqual(["GET", "mykey"]);
  });

  it("sends multi-token commands correctly (HGET collection field)", async () => {
    mockCall.mockResolvedValue("field-value");

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "HGET myhash field1");

    expect(result.kind).toBe("reply");
    if (result.kind === "reply") {
      expect(result.reply).toBe("field-value");
    }
    expect(mockCall.mock.calls[0]).toEqual(["HGET", "myhash", "field1"]);
  });

  it("returns reply with null value when key does not exist", async () => {
    mockCall.mockResolvedValue(null);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.query(conn, "GET nonexistent");

    expect(result.kind).toBe("reply");
    if (result.kind === "reply") {
      expect(result.reply).toBeNull();
    }
  });
});

describe("RedisDriver — list", () => {
  beforeEach(() => {
    mockKeys.mockReset();
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);
  });

  it("calls KEYS * and returns key names", async () => {
    mockKeys.mockResolvedValue(["session:1", "user:2", "cache:3"]);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const keys = await driver.list(conn, "keys");

    expect(keys).toEqual(["session:1", "user:2", "cache:3"]);
    expect(mockKeys.mock.calls[0][0]).toBe("*");
  });

  it("returns empty array when no keys exist", async () => {
    mockKeys.mockResolvedValue([]);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const keys = await driver.list(conn, "keys");

    expect(keys).toEqual([]);
  });
});

describe("RedisDriver — describe", () => {
  beforeEach(() => {
    mockType.mockReset();
    mockTtl.mockReset();
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);
  });

  it("returns TYPE and TTL for a given key", async () => {
    mockType.mockResolvedValue("hash");
    mockTtl.mockResolvedValue(7200);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const rows = await driver.describe(conn, "myhash");

    expect(rows.length).toBe(1);
    expect((rows[0] as Record<string, unknown>)["type"]).toBe("hash");
    expect((rows[0] as Record<string, unknown>)["ttl"]).toBe(7200);
    expect((rows[0] as Record<string, unknown>)["key"]).toBe("myhash");
  });

  it("returns -1 ttl for persistent keys", async () => {
    mockType.mockResolvedValue("string");
    mockTtl.mockResolvedValue(-1);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const rows = await driver.describe(conn, "persistent-key");

    expect((rows[0] as Record<string, unknown>)["ttl"]).toBe(-1);
  });
});

describe("RedisDriver — explain", () => {
  it("returns a not-supported notice as a reply result", async () => {
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const result = await driver.explain(conn, "GET foo");

    expect(result.kind).toBe("reply");
    if (result.kind === "reply") {
      expect(String(result.reply)).toContain("not supported");
    }
  });
});

describe("RedisDriver — ping", () => {
  beforeEach(() => {
    mockCall.mockReset();
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);
  });

  it("sends PING and returns true on success", async () => {
    mockCall.mockResolvedValue("PONG");

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(true);
  });

  it("returns false when PING throws", async () => {
    mockCall.mockRejectedValue(new Error("ECONNREFUSED"));

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(false);
  });
});

describe("RedisDriver — getForeignKeys", () => {
  it("returns empty array without error (no FK concept in redis)", async () => {
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const fks = await driver.getForeignKeys(conn, ["sessions"]);

    expect(fks).toEqual([]);
  });

  it("returns empty array even when tables is empty", async () => {
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    const fks = await driver.getForeignKeys(conn, []);

    expect(fks).toEqual([]);
  });
});

describe("RedisDriver — close", () => {
  it("calls disconnect() to release the connection", async () => {
    mockDisconnect.mockReset();
    MockRedis.mockReset();
    MockRedis.mockImplementation(() => mockRedisInstance);

    const driver = new RedisDriver();
    const conn = await driver.connect(cfg);
    await driver.close(conn);

    expect(mockDisconnect.mock.calls.length).toBe(1);
  });
});
