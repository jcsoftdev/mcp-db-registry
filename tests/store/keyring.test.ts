import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockSpawn = mock(() => ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") }));

mock.module("node:child_process", () => ({ spawnSync: mockSpawn }));

const { makeKeyring } = await import("../../src/store/keyring.js");

const SERVICE = "db-registry";
const ACCOUNT = "master-key";

describe("macOS keyring (security CLI)", () => {
  beforeEach(() => mockSpawn.mockReset());

  it("get: calls find-generic-password -w and returns trimmed hex", async () => {
    mockSpawn.mockReturnValue({
      status: 0,
      stdout: Buffer.from("deadbeef\n"),
      stderr: Buffer.from(""),
    });

    const kr = makeKeyring("darwin");
    const result = await kr.get(SERVICE, ACCOUNT);

    expect(result).toBe("deadbeef");
    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain("find-generic-password");
    expect(args).toContain("-w");
    expect(args).toContain(SERVICE);
    expect(args).toContain(ACCOUNT);
  });

  it("get: returns null when security exits non-zero (key not found)", async () => {
    mockSpawn.mockReturnValue({ status: 44, stdout: Buffer.from(""), stderr: Buffer.from("") });
    const kr = makeKeyring("darwin");
    const result = await kr.get(SERVICE, ACCOUNT);
    expect(result).toBeNull();
  });

  it("set: calls add-generic-password with -U flag", async () => {
    mockSpawn.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    const kr = makeKeyring("darwin");
    await kr.set(SERVICE, ACCOUNT, "aabbccdd");

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain("add-generic-password");
    expect(args).toContain("-U");
    expect(args).toContain("-w");
    expect(args).toContain("aabbccdd");
    expect(args).toContain(SERVICE);
    expect(args).toContain(ACCOUNT);
  });

  it("set: throws when security exits non-zero", async () => {
    mockSpawn.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from("err") });
    const kr = makeKeyring("darwin");
    await expect(kr.set(SERVICE, ACCOUNT, "xx")).rejects.toThrow();
  });

  it("delete: calls delete-generic-password", async () => {
    mockSpawn.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    const kr = makeKeyring("darwin");
    await kr.delete(SERVICE, ACCOUNT);

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain("delete-generic-password");
    expect(args).toContain(SERVICE);
    expect(args).toContain(ACCOUNT);
  });
});

describe("Linux keyring (secret-tool)", () => {
  beforeEach(() => mockSpawn.mockReset());

  it("get: calls secret-tool lookup and returns trimmed value", async () => {
    mockSpawn.mockReturnValue({
      status: 0,
      stdout: Buffer.from("myhex\n"),
      stderr: Buffer.from(""),
    });
    const kr = makeKeyring("linux");
    const result = await kr.get(SERVICE, ACCOUNT);

    expect(result).toBe("myhex");
    const cmd: string = mockSpawn.mock.calls[0][0];
    expect(cmd).toBe("secret-tool");
    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain("lookup");
  });

  it("get: returns null when secret-tool exits non-zero", async () => {
    mockSpawn.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from("") });
    const kr = makeKeyring("linux");
    expect(await kr.get(SERVICE, ACCOUNT)).toBeNull();
  });
});

describe("Windows stub", () => {
  it("get: always returns null (not supported)", async () => {
    const kr = makeKeyring("win32");
    expect(await kr.get(SERVICE, ACCOUNT)).toBeNull();
  });

  it("set: throws (not supported)", async () => {
    const kr = makeKeyring("win32");
    await expect(kr.set(SERVICE, ACCOUNT, "x")).rejects.toThrow("not supported");
  });

  it("delete: resolves without error (no-op)", async () => {
    const kr = makeKeyring("win32");
    await expect(kr.delete(SERVICE, ACCOUNT)).resolves.toBeUndefined();
  });
});
