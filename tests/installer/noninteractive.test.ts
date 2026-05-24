/**
 * Verifies non-interactive installer behavior:
 * - --yes flag skips prompts and installs all detected adapters
 * - --clients <list> installs only selected adapters
 */
import { describe, it, expect } from "bun:test";
import { filterAdaptersForNonInteractive } from "../../installer/index";
import { makeClaudeCodeAdapter } from "../../installer/clients/claude-code";
import { makeCursorAdapter } from "../../installer/clients/cursor";
import { makeWindsurfAdapter } from "../../installer/clients/windsurf";

describe("filterAdaptersForNonInteractive", () => {
  const adapters = [
    makeClaudeCodeAdapter({ homeDir: "/fake" }),
    makeCursorAdapter({ homeDir: "/fake" }),
    makeWindsurfAdapter({ homeDir: "/fake" }),
  ];

  it("returns all adapters when --clients is undefined (auto mode: detected)", () => {
    const result = filterAdaptersForNonInteractive(adapters, undefined);
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.id)).toEqual(["claude-code", "cursor", "windsurf"]);
  });

  it("returns only the named adapter when --clients specifies one id", () => {
    const result = filterAdaptersForNonInteractive(adapters, ["claude-code"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("claude-code");
  });

  it("returns multiple named adapters when --clients specifies several ids", () => {
    const result = filterAdaptersForNonInteractive(adapters, ["cursor", "windsurf"]);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toContain("cursor");
    expect(result.map((a) => a.id)).toContain("windsurf");
  });

  it("returns empty array when no adapters match the --clients filter", () => {
    const result = filterAdaptersForNonInteractive(adapters, ["zed"]);
    expect(result).toHaveLength(0);
  });
});
