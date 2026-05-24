import { describe, it, expect } from "bun:test";
import { seal, open, wrapMasterKey, unwrapMasterKey } from "../../src/store/crypto.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("seal / open", () => {
  it("round-trips a plaintext blob", () => {
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const plaintext = enc.encode("hello, secrets");

    const sealed = seal(key, plaintext);
    const recovered = open(key, sealed);

    expect(dec.decode(recovered)).toBe("hello, secrets");
  });

  it("round-trips an empty payload", () => {
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const sealed = seal(key, new Uint8Array(0));
    const recovered = open(key, sealed);
    expect(recovered.byteLength).toBe(0);
  });

  it("produces a unique nonce on each call", () => {
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const pt = enc.encode("same plaintext");
    const s1 = seal(key, pt);
    const s2 = seal(key, pt);
    expect(Buffer.from(s1.nonce).toString("hex")).not.toBe(
      Buffer.from(s2.nonce).toString("hex")
    );
  });

  it("nonce is 24 bytes", () => {
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const { nonce } = seal(key, enc.encode("x"));
    expect(nonce.byteLength).toBe(24);
  });

  it("throws when key is not 32 bytes", () => {
    const badKey = new Uint8Array(16);
    expect(() => seal(badKey, enc.encode("x"))).toThrow("32 bytes");
  });

  it("throws on tampered ciphertext (authentication failure)", () => {
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const { ciphertext, nonce } = seal(key, enc.encode("secret"));
    const tampered = ciphertext.slice();
    tampered[0] ^= 0xff;
    expect(() => open(key, { ciphertext: tampered, nonce })).toThrow();
  });
});

// argon2 key derivation is CPU-intensive; give extra time when coverage
// instrumentation is active (which can slow hashing by 3-5x).
const KDF_TIMEOUT = 30_000;

describe("wrapMasterKey / unwrapMasterKey", () => {
  it("round-trips a master key via passphrase", () => {
    const master = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const wrapped = wrapMasterKey("correct-horse-battery", master);
    const unwrapped = unwrapMasterKey("correct-horse-battery", wrapped);
    expect(Buffer.from(unwrapped).toString("hex")).toBe(
      Buffer.from(master).toString("hex")
    );
  }, KDF_TIMEOUT);

  it("throws when passphrase is wrong", () => {
    const master = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const wrapped = wrapMasterKey("right-pass", master);
    expect(() => unwrapMasterKey("wrong-pass", wrapped)).toThrow();
  }, KDF_TIMEOUT);

  it("salt is 16 bytes and random across calls", () => {
    const master = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const w1 = wrapMasterKey("pass", master);
    const w2 = wrapMasterKey("pass", master);
    expect(w1.salt.byteLength).toBe(16);
    expect(Buffer.from(w1.salt).toString("hex")).not.toBe(
      Buffer.from(w2.salt).toString("hex")
    );
  }, KDF_TIMEOUT);
});
