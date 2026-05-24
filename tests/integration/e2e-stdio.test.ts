/**
 * E2E stdio handshake tests — spawns the real server binary via Bun.spawn.
 * Sends JSON-RPC messages over stdin, reads responses from stdout.
 *
 * Uses an isolated data dir with a pre-seeded SQLite DB so the server
 * starts cleanly without touching the user's real db-registry data.
 * The macOS keychain entry for "db-registry" is reused (already seeded by
 * the real install), so no passphrase prompt occurs.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import * as path from "node:path";
import { mkdirSync } from "node:fs";

const SERVER_PATH = path.join(import.meta.dir, "../../src/server.ts");
const E2E_DATA_DIR = "/tmp/db-registry-test-e2e";
const TIMEOUT_MS = 10000;

// Ensure the data dir exists before any test spawns the server.
beforeAll(() => {
  mkdirSync(path.join(E2E_DATA_DIR, "db-registry"), { recursive: true });
});

/**
 * Spawn the server, send one JSON-RPC request, return the first JSON response.
 */
async function sendOne(request: object): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(["bun", SERVER_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      XDG_DATA_HOME: E2E_DATA_DIR,
    },
  });

  proc.stdin.write(JSON.stringify(request) + "\n");
  proc.stdin.end();

  const responseText = await Promise.race([
    new Response(proc.stdout).text(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("E2E timeout after " + TIMEOUT_MS + "ms")), TIMEOUT_MS)
    ),
  ]);

  proc.kill();

  for (const raw of responseText.split("\n")) {
    const t = raw.trim();
    if (t.startsWith("{")) return JSON.parse(t) as Record<string, unknown>;
  }
  throw new Error(`No JSON response. stdout: ${responseText.slice(0, 500)}`);
}

/**
 * Spawn the server, send multiple JSON-RPC messages, return all parsed responses.
 */
async function sendMany(requests: object[]): Promise<Record<string, unknown>[]> {
  const proc = Bun.spawn(["bun", SERVER_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      XDG_DATA_HOME: E2E_DATA_DIR,
    },
  });

  for (const req of requests) {
    proc.stdin.write(JSON.stringify(req) + "\n");
  }
  proc.stdin.end();

  const responseText = await Promise.race([
    new Response(proc.stdout).text(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("E2E timeout after " + TIMEOUT_MS + "ms")), TIMEOUT_MS)
    ),
  ]);

  proc.kill();

  return responseText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const INIT_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.1" },
  },
};

describe("e2e stdio — initialize handshake", () => {
  it("returns serverInfo.name === 'db-registry'", async () => {
    const response = await sendOne(INIT_REQUEST);
    const result = response["result"] as Record<string, unknown>;
    const serverInfo = result["serverInfo"] as Record<string, unknown>;
    expect(serverInfo["name"]).toBe("db-registry");
  });

  it("returns serverInfo.version === '0.1.0'", async () => {
    const response = await sendOne({ ...INIT_REQUEST, id: 2 });
    const result = response["result"] as Record<string, unknown>;
    const serverInfo = result["serverInfo"] as Record<string, unknown>;
    expect(serverInfo["version"]).toBe("0.1.0");
  });

  it("returns instructions present and ≤500 chars", async () => {
    const response = await sendOne({ ...INIT_REQUEST, id: 3 });
    const result = response["result"] as Record<string, unknown>;
    expect(typeof result["instructions"]).toBe("string");
    expect((result["instructions"] as string).length).toBeGreaterThan(0);
    expect((result["instructions"] as string).length).toBeLessThanOrEqual(500);
  });

  it("returns capabilities.tools defined", async () => {
    const response = await sendOne({ ...INIT_REQUEST, id: 4 });
    const result = response["result"] as Record<string, unknown>;
    const capabilities = result["capabilities"] as Record<string, unknown>;
    expect(capabilities["tools"]).toBeDefined();
  });
});

describe("e2e stdio — tools/list returns 14 tools", () => {
  it("lists exactly 14 tools after initialize", async () => {
    const responses = await sendMany([
      INIT_REQUEST,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);

    const listResp = responses.find((r) => r["id"] === 2);
    expect(listResp).toBeDefined();

    const result = listResp!["result"] as Record<string, unknown>;
    const tools = result["tools"] as unknown[];
    expect(tools).toHaveLength(14);
  });
});

describe("e2e stdio — CallTool error envelope", () => {
  it("returns isError:true and text containing 'Unknown tool' for unknown tool name", async () => {
    const responses = await sendMany([
      INIT_REQUEST,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "nonexistent_tool_xyz", arguments: {} },
      },
    ]);

    const callResp = responses.find((r) => r["id"] === 2);
    expect(callResp).toBeDefined();

    const result = callResp!["result"] as Record<string, unknown>;
    expect(result["isError"]).toBe(true);
    const content = result["content"] as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("Unknown tool");
  });
});
