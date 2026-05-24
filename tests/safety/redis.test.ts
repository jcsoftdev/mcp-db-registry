import { describe, it, expect } from "bun:test";
import { isReadOnlyRedisCmd } from "../../src/safety/redis.js";

describe("isReadOnlyRedisCmd — read commands pass", () => {
  it("GET is read-only", () => {
    expect(isReadOnlyRedisCmd(["GET", "mykey"])).toBe(true);
  });

  it("HGET is read-only", () => {
    expect(isReadOnlyRedisCmd(["HGET", "myhash", "field"])).toBe(true);
  });

  it("LRANGE is read-only", () => {
    expect(isReadOnlyRedisCmd(["LRANGE", "mylist", "0", "-1"])).toBe(true);
  });

  it("SMEMBERS is read-only", () => {
    expect(isReadOnlyRedisCmd(["SMEMBERS", "myset"])).toBe(true);
  });

  it("ZRANGE is read-only", () => {
    expect(isReadOnlyRedisCmd(["ZRANGE", "myzset", "0", "-1"])).toBe(true);
  });

  it("KEYS is read-only", () => {
    expect(isReadOnlyRedisCmd(["KEYS", "*"])).toBe(true);
  });

  it("TTL is read-only", () => {
    expect(isReadOnlyRedisCmd(["TTL", "mykey"])).toBe(true);
  });

  it("INFO is read-only", () => {
    expect(isReadOnlyRedisCmd(["INFO"])).toBe(true);
  });

  it("empty argv is read-only (no-op)", () => {
    expect(isReadOnlyRedisCmd([])).toBe(true);
  });
});

describe("isReadOnlyRedisCmd — write commands blocked", () => {
  it("SET is blocked", () => {
    expect(isReadOnlyRedisCmd(["SET", "foo", "bar"])).toBe(false);
  });

  it("DEL is blocked", () => {
    expect(isReadOnlyRedisCmd(["DEL", "mykey"])).toBe(false);
  });

  it("MSET is blocked", () => {
    expect(isReadOnlyRedisCmd(["MSET", "k1", "v1", "k2", "v2"])).toBe(false);
  });

  it("HSET is blocked", () => {
    expect(isReadOnlyRedisCmd(["HSET", "myhash", "field", "val"])).toBe(false);
  });

  it("LPUSH is blocked", () => {
    expect(isReadOnlyRedisCmd(["LPUSH", "mylist", "val"])).toBe(false);
  });

  it("RPUSH is blocked", () => {
    expect(isReadOnlyRedisCmd(["RPUSH", "mylist", "val"])).toBe(false);
  });

  it("SADD is blocked", () => {
    expect(isReadOnlyRedisCmd(["SADD", "myset", "member"])).toBe(false);
  });

  it("ZADD is blocked", () => {
    expect(isReadOnlyRedisCmd(["ZADD", "myzset", "1", "member"])).toBe(false);
  });

  it("EXPIRE is blocked", () => {
    expect(isReadOnlyRedisCmd(["EXPIRE", "mykey", "60"])).toBe(false);
  });

  it("RENAME is blocked", () => {
    expect(isReadOnlyRedisCmd(["RENAME", "old", "new"])).toBe(false);
  });

  it("FLUSHDB is blocked", () => {
    expect(isReadOnlyRedisCmd(["FLUSHDB"])).toBe(false);
  });

  it("FLUSHALL is blocked", () => {
    expect(isReadOnlyRedisCmd(["FLUSHALL"])).toBe(false);
  });

  it("INCR is blocked", () => {
    expect(isReadOnlyRedisCmd(["INCR", "counter"])).toBe(false);
  });

  it("DECR is blocked", () => {
    expect(isReadOnlyRedisCmd(["DECR", "counter"])).toBe(false);
  });

  it("UNLINK is blocked", () => {
    expect(isReadOnlyRedisCmd(["UNLINK", "mykey"])).toBe(false);
  });

  it("XADD is blocked", () => {
    expect(isReadOnlyRedisCmd(["XADD", "mystream", "*", "field", "val"])).toBe(false);
  });
});

describe("isReadOnlyRedisCmd — case-insensitive", () => {
  it("set (lowercase) is blocked", () => {
    expect(isReadOnlyRedisCmd(["set", "foo", "bar"])).toBe(false);
  });

  it("Set (mixed case) is blocked", () => {
    expect(isReadOnlyRedisCmd(["Set", "foo", "bar"])).toBe(false);
  });

  it("get (lowercase) is read-only", () => {
    expect(isReadOnlyRedisCmd(["get", "mykey"])).toBe(true);
  });
});
