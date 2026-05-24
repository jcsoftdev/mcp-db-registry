/**
 * Triangulation tests for installer/lib utilities that were below 60% coverage.
 * Covers: runAdapter, fileExists, dirExists, whichBinary, isInteractive.
 */
import { describe, it, expect } from "bun:test";
import * as path from "node:path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// ── runAdapter ──────────────────────────────────────────────────────────────

describe("runAdapter", () => {
  it("returns the adapter.write() result on success", async () => {
    const { runAdapter } = await import("../../installer/lib/adapter.js");

    const fakeAdapter = {
      id: "fake",
      label: "Fake",
      detect: async () => ({ installed: false as const, reason: "test" }),
      configPath: () => "/tmp/fake",
      buildEntry: () => ({ key: "fake", name: "fake", value: {} }),
      write: async () => ({ status: "configured" as const, backup: null }),
    };

    const result = await runAdapter(fakeAdapter, "/fake/server.ts");
    expect(result.status).toBe("configured");
  });

  it("catches exceptions from adapter.write() and returns failed status", async () => {
    const { runAdapter } = await import("../../installer/lib/adapter.js");

    const throwingAdapter = {
      id: "bad",
      label: "Bad",
      detect: async () => ({ installed: false as const, reason: "test" }),
      configPath: () => "/tmp/bad",
      buildEntry: () => ({ key: "bad", name: "bad", value: {} }),
      write: async () => { throw new Error("disk full"); },
    };

    const result = await runAdapter(throwingAdapter, "/fake/server.ts");
    expect(result.status).toBe("failed");
    expect((result as { status: "failed"; error: string }).error).toContain("disk full");
  });
});

// ── fileExists / dirExists ─────────────────────────────────────────────────

describe("fileExists", () => {
  it("returns true for a real file", async () => {
    const { fileExists } = await import("../../installer/lib/detect.js");
    const dir = mkdtempSync(path.join(tmpdir(), "db-reg-detect-"));
    const fp = path.join(dir, "exists.txt");
    writeFileSync(fp, "hello");

    expect(await fileExists(fp)).toBe(true);

    rmSync(dir, { recursive: true });
  });

  it("returns false for a path that does not exist", async () => {
    const { fileExists } = await import("../../installer/lib/detect.js");
    expect(await fileExists("/tmp/db-reg-no-such-file-xyzzy-12345.txt")).toBe(false);
  });

  it("returns false for a directory (not a file)", async () => {
    const { fileExists } = await import("../../installer/lib/detect.js");
    const dir = mkdtempSync(path.join(tmpdir(), "db-reg-dir-"));
    expect(await fileExists(dir)).toBe(false);
    rmSync(dir, { recursive: true });
  });
});

describe("dirExists", () => {
  it("returns true for a real directory", async () => {
    const { dirExists } = await import("../../installer/lib/detect.js");
    const dir = mkdtempSync(path.join(tmpdir(), "db-reg-de-"));
    expect(await dirExists(dir)).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it("returns false for a path that does not exist", async () => {
    const { dirExists } = await import("../../installer/lib/detect.js");
    expect(await dirExists("/tmp/db-reg-no-such-dir-xyzzy-12345")).toBe(false);
  });

  it("returns false for a file (not a directory)", async () => {
    const { dirExists } = await import("../../installer/lib/detect.js");
    const dir = mkdtempSync(path.join(tmpdir(), "db-reg-df-"));
    const fp = path.join(dir, "file.txt");
    writeFileSync(fp, "x");
    expect(await dirExists(fp)).toBe(false);
    rmSync(dir, { recursive: true });
  });
});

// ── whichBinary ──────────────────────────────────────────────────────────────

describe("whichBinary", () => {
  it("returns true for 'bun' (which is definitely on PATH in this test env)", async () => {
    const { whichBinary } = await import("../../installer/lib/detect.js");
    expect(await whichBinary("bun")).toBe(true);
  });

  it("returns false for a binary that definitely does not exist", async () => {
    const { whichBinary } = await import("../../installer/lib/detect.js");
    expect(await whichBinary("db-registry-fake-binary-xyzzy")).toBe(false);
  });
});

// ── isInteractive ─────────────────────────────────────────────────────────

describe("isInteractive", () => {
  it("returns false in test environment (stdin is not a TTY when piped)", async () => {
    const { isInteractive } = await import("../../installer/lib/tty.js");
    // In bun test, stdin is not a TTY — so this is deterministically false.
    expect(isInteractive()).toBe(false);
  });
});
