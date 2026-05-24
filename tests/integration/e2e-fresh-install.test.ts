import { describe, it, expect, beforeEach } from "bun:test";
import * as path from "node:path";
import { rmSync, existsSync } from "node:fs";

const SERVER_PATH = path.join(import.meta.dir, "../../src/server.ts");
const FRESH_DATA_DIR = "/tmp/db-registry-test-fresh";
const TIMEOUT_MS = 10000;

describe("e2e: fresh-install boot (regression for missing data dir)", () => {
  beforeEach(() => {
    if (existsSync(FRESH_DATA_DIR)) rmSync(FRESH_DATA_DIR, { recursive: true, force: true });
  });

  it("creates data dir and answers initialize when XDG_DATA_HOME does not yet exist", async () => {
    const proc = Bun.spawn(["bun", SERVER_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, XDG_DATA_HOME: FRESH_DATA_DIR },
    });

    const initReq = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "fresh-install", version: "1" },
      },
    };
    proc.stdin.write(JSON.stringify(initReq) + "\n");
    proc.stdin.end();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + TIMEOUT_MS;
    let parsed: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        parsed = JSON.parse(buf.slice(0, nl));
        break;
      }
    }
    proc.kill();
    await proc.exited;

    expect(parsed).not.toBeNull();
    expect((parsed as any).result?.serverInfo?.name).toBe("db-registry");
    expect(existsSync(path.join(FRESH_DATA_DIR, "db-registry"))).toBe(true);
  }, TIMEOUT_MS + 2000);
});
