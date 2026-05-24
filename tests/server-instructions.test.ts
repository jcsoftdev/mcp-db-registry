import { describe, test, expect } from "bun:test";
import { INSTRUCTIONS } from "../src/server.js";

describe("INSTRUCTIONS — token count heuristic", () => {
  test("INSTRUCTIONS is under 120 tokens (chars/4 heuristic)", () => {
    const estimatedTokens = Math.ceil(INSTRUCTIONS.length / 4);
    expect(estimatedTokens).toBeLessThanOrEqual(120);
  });

  test("INSTRUCTIONS contains all 5 engine names", () => {
    expect(INSTRUCTIONS).toContain("postgres");
    expect(INSTRUCTIONS).toContain("mysql");
    expect(INSTRUCTIONS).toContain("mongo");
    expect(INSTRUCTIONS).toContain("redis");
    expect(INSTRUCTIONS).toContain("sqlite");
  });

  test("INSTRUCTIONS describes read-only default", () => {
    const lower = INSTRUCTIONS.toLowerCase();
    const hasReadOnly = lower.includes("read-only") || lower.includes("readonly");
    expect(hasReadOnly).toBe(true);
  });

  test("INSTRUCTIONS mentions db_engines or available engines", () => {
    expect(INSTRUCTIONS.includes("db_engines") || INSTRUCTIONS.includes("db_connection_info")).toBe(true);
  });

  test("INSTRUCTIONS mentions auto-discovery", () => {
    const lower = INSTRUCTIONS.toLowerCase();
    expect(lower.includes("auto-discov") || lower.includes("auto discov")).toBe(true);
  });
});
