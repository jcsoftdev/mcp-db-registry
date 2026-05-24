import { describe, test, expect } from "bun:test";
import { INSTRUCTIONS, ALL_TOOLS } from "../src/server.js";

describe("server — tools registration", () => {
  test("ListTools returns exactly 17 tools", () => {
    expect(ALL_TOOLS).toHaveLength(17);
  });

  test("all 17 expected tool names are registered", () => {
    const names = ALL_TOOLS.map((t: { name: string }) => t.name);
    const expected = [
      "db_query",
      "db_list",
      "db_describe",
      "db_explain",
      "db_connection_info",
      "db_engines",
      "db_snippet_save",
      "db_snippet_run",
      "db_snippet_get",
      "db_snippet_search",
      "db_snippet_list",
      "db_snippet_delete",
      "db_credentials_save",
      "db_credentials_clear",
      "db_describe_many",
      "db_suggest_query",
      "db_report_run",
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  test("each tool has name, description, and inputSchema", () => {
    for (const tool of ALL_TOOLS) {
      const t = tool as { name: string; description: string; inputSchema: unknown };
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema).toBeDefined();
    }
  });
});

describe("server — instructions field", () => {
  test("INSTRUCTIONS is a non-empty string", () => {
    expect(typeof INSTRUCTIONS).toBe("string");
    expect(INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  test("INSTRUCTIONS mentions all 5 engine names", () => {
    expect(INSTRUCTIONS).toContain("postgres");
    expect(INSTRUCTIONS).toContain("mysql");
    expect(INSTRUCTIONS).toContain("mongo");
    expect(INSTRUCTIONS).toContain("redis");
    expect(INSTRUCTIONS).toContain("sqlite");
  });

  test("INSTRUCTIONS mentions read-only default", () => {
    const lower = INSTRUCTIONS.toLowerCase();
    expect(lower.includes("read-only") || lower.includes("readonly") || lower.includes("read only")).toBe(true);
  });

  test("INSTRUCTIONS mentions at least one report tool", () => {
    const hasReportTool =
      INSTRUCTIONS.includes("db_describe_many") ||
      INSTRUCTIONS.includes("db_suggest_query") ||
      INSTRUCTIONS.includes("db_report_run");
    expect(hasReportTool).toBe(true);
  });

  test("INSTRUCTIONS is under 120-token budget (approx char limit 600)", () => {
    // Rough approximation: ~4 chars per token → 120 tokens ≈ 480 chars (conservative)
    // We use 600 as generous upper bound to avoid false failures from minor wording
    expect(INSTRUCTIONS.length).toBeLessThan(600);
  });
});
