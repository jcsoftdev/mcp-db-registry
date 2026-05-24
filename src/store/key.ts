import { readFile, writeFile, access } from "node:fs/promises";
import { wrapMasterKey, unwrapMasterKey } from "./crypto.js";
import type { WrappedKey } from "./crypto.js";
import type { KeyringProvider } from "../types.js";

const SERVICE = "db-registry";
const ACCOUNT = "master-key";

export interface LoadMasterKeyOpts {
  keyring: KeyringProvider;
  keyFilePath: string;
  passphraseFn?: () => Promise<string>;
}

export async function loadMasterKey(opts: LoadMasterKeyOpts): Promise<Uint8Array> {
  const fromKeychain = await opts.keyring.get(SERVICE, ACCOUNT);
  if (fromKeychain) {
    return new Uint8Array(Buffer.from(fromKeychain, "base64"));
  }

  if (await fileExists(opts.keyFilePath)) {
    if (!opts.passphraseFn) {
      throw new Error("keyring empty and no passphrase provider; cannot unlock");
    }
    const raw = JSON.parse(await readFile(opts.keyFilePath, "utf8"));
    const wrapped = deserializeWrapped(raw);
    return unwrapMasterKey(await opts.passphraseFn(), wrapped);
  }

  const master = globalThis.crypto.getRandomValues(new Uint8Array(32));

  try {
    await opts.keyring.set(SERVICE, ACCOUNT, Buffer.from(master).toString("base64"));
  } catch {
    if (!opts.passphraseFn) {
      throw new Error("keyring unavailable and no passphrase provider; cannot persist key");
    }
    const wrapped = wrapMasterKey(await opts.passphraseFn(), master);
    await writeFile(opts.keyFilePath, JSON.stringify(serializeWrapped(wrapped)), { mode: 0o600 });
  }

  return master;
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function serializeWrapped(w: WrappedKey): unknown {
  return {
    salt: Array.from(w.salt),
    sealed: {
      ciphertext: Array.from(w.sealed.ciphertext),
      nonce: Array.from(w.sealed.nonce),
    },
  };
}

function deserializeWrapped(raw: { salt: number[]; sealed: { ciphertext: number[]; nonce: number[] } }): WrappedKey {
  return {
    salt: new Uint8Array(raw.salt),
    sealed: {
      ciphertext: new Uint8Array(raw.sealed.ciphertext),
      nonce: new Uint8Array(raw.sealed.nonce),
    },
  };
}
