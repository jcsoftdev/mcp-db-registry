import { describe, it, expect } from "bun:test";
import { VERSION } from "../src/version.ts";

describe("VERSION", () => {
  it("is a non-empty semver-like string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
