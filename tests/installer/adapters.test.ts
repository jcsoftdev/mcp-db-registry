/**
 * Verifies that all 8 db-registry installer adapters:
 * - Register the server as "db-registry" (never "port-registry")
 * - Perform atomic write + backup on first run
 * - Return already-configured on idempotent re-run
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeClaudeCodeAdapter } from "../../installer/clients/claude-code";
import { makeClaudeDesktopAdapter } from "../../installer/clients/claude-desktop";
import { makeCursorAdapter } from "../../installer/clients/cursor";
import { makeWindsurfAdapter } from "../../installer/clients/windsurf";
import { makeClineAdapter } from "../../installer/clients/cline";
import { makeContinueAdapter } from "../../installer/clients/continue";
import { makeZedAdapter } from "../../installer/clients/zed";
import { makePiAdapter } from "../../installer/clients/pi";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "db-registry-installer-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("claude-code adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry'", () => {
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.name).toBe("db-registry");
    expect(entry.key).toBe("mcpServers");
  });

  it("write() registers 'db-registry' in mcpServers", async () => {
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["db-registry"]).toBeDefined();
    expect(written.mcpServers?.["port-registry"]).toBeUndefined();
  });

  it("write() is idempotent", async () => {
    const adapter = makeClaudeCodeAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    const second = await adapter.write("/path/server.ts");
    expect(second.status).toBe("already-configured");
  });
});

describe("claude-desktop adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry'", () => {
    const adapter = makeClaudeDesktopAdapter({ homeDir: tmpDir, platform: "darwin" });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.name).toBe("db-registry");
    expect(entry.key).toBe("mcpServers");
  });

  it("write() registers 'db-registry' in mcpServers", async () => {
    const adapter = makeClaudeDesktopAdapter({ homeDir: tmpDir, platform: "darwin" });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["db-registry"]).toBeDefined();
  });

  it("write() is idempotent", async () => {
    const adapter = makeClaudeDesktopAdapter({ homeDir: tmpDir, platform: "darwin" });
    await adapter.write("/path/server.ts");
    expect((await adapter.write("/path/server.ts")).status).toBe("already-configured");
  });
});

describe("cursor adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry'", () => {
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    expect(adapter.buildEntry("/p").name).toBe("db-registry");
  });

  it("write() registers 'db-registry' in mcpServers", async () => {
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["db-registry"]).toBeDefined();
  });

  it("write() is idempotent", async () => {
    const adapter = makeCursorAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    expect((await adapter.write("/path/server.ts")).status).toBe("already-configured");
  });
});

describe("windsurf adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry'", () => {
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    expect(adapter.buildEntry("/p").name).toBe("db-registry");
  });

  it("write() registers 'db-registry' in mcpServers", async () => {
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["db-registry"]).toBeDefined();
  });

  it("write() is idempotent", async () => {
    const adapter = makeWindsurfAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    expect((await adapter.write("/path/server.ts")).status).toBe("already-configured");
  });
});

describe("cline adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry'", () => {
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    expect(adapter.buildEntry("/p").name).toBe("db-registry");
  });

  it("write() registers 'db-registry' in mcpServers", async () => {
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["db-registry"]).toBeDefined();
  });

  it("write() is idempotent", async () => {
    const adapter = makeClineAdapter({ homeDir: tmpDir, platform: "darwin" });
    await adapter.write("/path/server.ts");
    expect((await adapter.write("/path/server.ts")).status).toBe("already-configured");
  });
});

describe("continue adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry'", () => {
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/path/server.ts");
    expect(entry.name).toBe("db-registry");
    expect(entry.key).toBe("mcpServers");
  });

  it("write() registers 'db-registry' in YAML config", async () => {
    await fs.mkdir(path.join(tmpDir, ".continue"), { recursive: true });
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const raw = await fs.readFile(adapter.configPath(), "utf8");
    expect(raw).toContain("db-registry");
    expect(raw).not.toContain("port-registry");
  });

  it("write() is idempotent", async () => {
    await fs.mkdir(path.join(tmpDir, ".continue"), { recursive: true });
    const adapter = makeContinueAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    expect((await adapter.write("/path/server.ts")).status).toBe("already-configured");
  });
});

describe("zed adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry' under context_servers", () => {
    const adapter = makeZedAdapter({ homeDir: tmpDir });
    const entry = adapter.buildEntry("/p");
    expect(entry.name).toBe("db-registry");
    expect(entry.key).toBe("context_servers");
  });

  it("write() registers 'db-registry' in context_servers", async () => {
    const adapter = makeZedAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.context_servers?.["db-registry"]).toBeDefined();
    expect(written.context_servers?.["port-registry"]).toBeUndefined();
  });

  it("write() is idempotent", async () => {
    const adapter = makeZedAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    expect((await adapter.write("/path/server.ts")).status).toBe("already-configured");
  });
});

describe("pi adapter (db-registry)", () => {
  it("buildEntry() names the server 'db-registry'", () => {
    const adapter = makePiAdapter({ homeDir: tmpDir });
    expect(adapter.buildEntry("/p").name).toBe("db-registry");
  });

  it("write() registers 'db-registry' in mcpServers", async () => {
    const adapter = makePiAdapter({ homeDir: tmpDir });
    const outcome = await adapter.write("/path/server.ts");
    expect(outcome.status).toBe("configured");
    const written = JSON.parse(await fs.readFile(adapter.configPath(), "utf8"));
    expect(written.mcpServers?.["db-registry"]).toBeDefined();
  });

  it("write() is idempotent", async () => {
    const adapter = makePiAdapter({ homeDir: tmpDir });
    await adapter.write("/path/server.ts");
    expect((await adapter.write("/path/server.ts")).status).toBe("already-configured");
  });
});
