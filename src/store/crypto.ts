import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2id } from "@noble/hashes/argon2.js";

export interface Sealed {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export function seal(key: Uint8Array, plaintext: Uint8Array): Sealed {
  if (key.byteLength !== 32) throw new Error("seal: key must be 32 bytes");
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(24));
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return { ciphertext, nonce };
}

export function open(key: Uint8Array, sealed: Sealed): Uint8Array {
  return xchacha20poly1305(key, sealed.nonce).decrypt(sealed.ciphertext);
}

export interface WrappedKey {
  salt: Uint8Array;
  sealed: Sealed;
}

export function wrapMasterKey(passphrase: string, masterKey: Uint8Array): WrappedKey {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const kek = argon2id(passphrase, salt, { t: 3, m: 65536, p: 1, dkLen: 32 });
  const sealed = seal(kek, masterKey);
  return { salt, sealed };
}

export function unwrapMasterKey(passphrase: string, wrapped: WrappedKey): Uint8Array {
  const kek = argon2id(passphrase, wrapped.salt, { t: 3, m: 65536, p: 1, dkLen: 32 });
  return open(kek, wrapped.sealed);
}
