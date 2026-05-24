import { describe, it, expect, afterEach } from "bun:test";
import { makeWriteGuard, checkWriteAllowed } from "../../src/safety/write-detect.js";

describe("makeWriteGuard — factory returns correct guard per engine", () => {
  it("postgres guard: SELECT is read-only", () => {
    const guard = makeWriteGuard("postgres");
    expect(guard.engine).toBe("postgres");
    expect(guard.isReadOnly("SELECT * FROM users")).toBe(true);
  });

  it("postgres guard: INSERT is write", () => {
    const guard = makeWriteGuard("postgres");
    expect(guard.isReadOnly("INSERT INTO t VALUES (1)")).toBe(false);
  });

  it("mysql guard: UPDATE is write", () => {
    const guard = makeWriteGuard("mysql");
    expect(guard.engine).toBe("mysql");
    expect(guard.isReadOnly("UPDATE t SET x = 1")).toBe(false);
  });

  it("sqlite guard: DROP is write", () => {
    const guard = makeWriteGuard("sqlite");
    expect(guard.engine).toBe("sqlite");
    expect(guard.isReadOnly("DROP TABLE temp")).toBe(false);
  });

  it("mongo guard: insertOne is write", () => {
    const guard = makeWriteGuard("mongo");
    expect(guard.engine).toBe("mongo");
    expect(guard.isReadOnly({ method: "insertOne", args: {} })).toBe(false);
  });

  it("mongo guard: find is read-only", () => {
    const guard = makeWriteGuard("mongo");
    expect(guard.isReadOnly({ method: "find", args: {} })).toBe(true);
  });

  it("redis guard: SET is write", () => {
    const guard = makeWriteGuard("redis");
    expect(guard.engine).toBe("redis");
    expect(guard.isReadOnly(["SET", "key", "val"])).toBe(false);
  });

  it("redis guard: GET is read-only", () => {
    const guard = makeWriteGuard("redis");
    expect(guard.isReadOnly(["GET", "key"])).toBe(true);
  });
});

describe("checkWriteAllowed — override behavior", () => {
  const origEnv = process.env["DB_REGISTRY_ALLOW_WRITE"];

  afterEach(() => {
    if (origEnv === undefined) delete process.env["DB_REGISTRY_ALLOW_WRITE"];
    else process.env["DB_REGISTRY_ALLOW_WRITE"] = origEnv;
  });

  it("throws toolError when write detected and env not set", () => {
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];
    const guard = makeWriteGuard("postgres");
    expect(() => checkWriteAllowed(guard, "INSERT INTO t VALUES (1)")).toThrow();
  });

  it("does not throw when write detected and DB_REGISTRY_ALLOW_WRITE=1", () => {
    process.env["DB_REGISTRY_ALLOW_WRITE"] = "1";
    const guard = makeWriteGuard("postgres");
    expect(() => checkWriteAllowed(guard, "INSERT INTO t VALUES (1)")).not.toThrow();
  });

  it("does not throw for read-only query regardless of env", () => {
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];
    const guard = makeWriteGuard("postgres");
    expect(() => checkWriteAllowed(guard, "SELECT 1")).not.toThrow();
  });

  it("per-call override flag allows writes even without env var", () => {
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];
    const guard = makeWriteGuard("mysql");
    expect(() => checkWriteAllowed(guard, "DELETE FROM t", { allowWrite: true })).not.toThrow();
  });

  it("error message contains 'Write operation blocked'", () => {
    delete process.env["DB_REGISTRY_ALLOW_WRITE"];
    const guard = makeWriteGuard("sqlite");
    let msg = "";
    try { checkWriteAllowed(guard, "DROP TABLE t"); } catch (e) { msg = String(e); }
    expect(msg).toContain("Write operation blocked");
  });
});
