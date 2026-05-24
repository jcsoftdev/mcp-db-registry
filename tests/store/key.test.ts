import { describe, it, expect, beforeEach } from "bun:test";
import type { KeyringProvider } from "../../src/types.js";
import { loadMasterKey } from "../../src/store/key.js";
import { wrapMasterKey } from "../../src/store/crypto.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeKeyring(store: Map<string, string>): KeyringProvider {
  return {
    async get(service, account) {
      return store.get(`${service}:${account}`) ?? null;
    },
    async set(service, account, secret) {
      store.set(`${service}:${account}`, secret);
    },
    async delete(service, account) {
      store.delete(`${service}:${account}`);
    },
  };
}

describe("loadMasterKey", () => {
  let tmpDir: string;
  let keyFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "key-test-"));
    keyFilePath = join(tmpDir, "master.key.json");
  });

  it("returns key from keychain when present", async () => {
    const stored = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const store = new Map([["db-registry:master-key", Buffer.from(stored).toString("base64")]]);
    const kr = makeKeyring(store);

    const key = await loadMasterKey({ keyring: kr, keyFilePath });

    expect(Buffer.from(key).toString("hex")).toBe(Buffer.from(stored).toString("hex"));
  });

  it("decrypts from wrapped-file when keychain empty and file exists", async () => {
    const master = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const passphrase = "test-pass-phrase";
    const wrapped = wrapMasterKey(passphrase, master);

    const serialized = {
      salt: Array.from(wrapped.salt),
      sealed: {
        ciphertext: Array.from(wrapped.sealed.ciphertext),
        nonce: Array.from(wrapped.sealed.nonce),
      },
    };
    await writeFile(keyFilePath, JSON.stringify(serialized), { mode: 0o600 });

    const kr = makeKeyring(new Map());
    const key = await loadMasterKey({
      keyring: kr,
      keyFilePath,
      passphraseFn: async () => passphrase,
    });

    expect(Buffer.from(key).toString("hex")).toBe(Buffer.from(master).toString("hex"));
  });

  it("throws when keychain empty, file exists, but no passphrase provider", async () => {
    const master = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const wrapped = wrapMasterKey("some-pass", master);
    const serialized = {
      salt: Array.from(wrapped.salt),
      sealed: {
        ciphertext: Array.from(wrapped.sealed.ciphertext),
        nonce: Array.from(wrapped.sealed.nonce),
      },
    };
    await writeFile(keyFilePath, JSON.stringify(serialized), { mode: 0o600 });

    const kr = makeKeyring(new Map());
    await expect(loadMasterKey({ keyring: kr, keyFilePath })).rejects.toThrow();
  });

  it("first-run: generates key and stores it in keychain", async () => {
    const store = new Map<string, string>();
    const kr = makeKeyring(store);

    const key = await loadMasterKey({ keyring: kr, keyFilePath });

    expect(key.byteLength).toBe(32);
    expect(store.has("db-registry:master-key")).toBe(true);
  });

  it("first-run: falls back to wrapped-file when keychain set throws", async () => {
    const failingKr: KeyringProvider = {
      async get() { return null; },
      async set() { throw new Error("keychain unavailable"); },
      async delete() { },
    };

    const key = await loadMasterKey({
      keyring: failingKr,
      keyFilePath,
      passphraseFn: async () => "fallback-pass",
    });

    expect(key.byteLength).toBe(32);
    const { existsSync } = await import("node:fs");
    expect(existsSync(keyFilePath)).toBe(true);
  });

  it("first-run with no keychain and no passphrase fn throws", async () => {
    const failingKr: KeyringProvider = {
      async get() { return null; },
      async set() { throw new Error("unavailable"); },
      async delete() { },
    };

    await expect(loadMasterKey({ keyring: failingKr, keyFilePath })).rejects.toThrow();
  });
});
