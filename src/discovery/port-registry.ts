import { spawnSync } from "node:child_process";
import type { Engine } from "../types.js";

type SpawnFn = (cmd: string, args: string[], opts: { input: string }) => { stdout: string; status: number };

export interface PortRegistryClientOptions {
  /** Injected for testing; defaults to spawnSync. */
  spawnFn?: SpawnFn;
}

export class PortRegistryClient {
  private readonly spawnFn: SpawnFn;

  constructor(opts: PortRegistryClientOptions = {}) {
    this.spawnFn = opts.spawnFn ?? defaultSpawn;
  }

  async get(engine: Engine): Promise<{ host: string; port: number } | null> {
    const mcpName = process.env["DB_REGISTRY_PORT_MCP_NAME"] ?? "port-registry";

    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "port_get", arguments: { technology: engine } },
    });

    let result: { stdout: string; status: number };
    try {
      result = this.spawnFn(mcpName, [], { input: request });
    } catch {
      return null;
    }

    if (result.status !== 0 || !result.stdout) return null;

    try {
      const response = JSON.parse(result.stdout) as {
        result?: { content?: Array<{ type: string; text: string }> };
      };
      const text = response.result?.content?.[0]?.text;
      if (!text) return null;
      const data = JSON.parse(text) as Record<string, unknown>;
      if (typeof data["port"] !== "number") return null;
      return { host: "localhost", port: data["port"] as number };
    } catch {
      return null;
    }
  }
}

function defaultSpawn(cmd: string, args: string[], opts: { input: string }): { stdout: string; status: number } {
  const r = spawnSync(cmd, args, {
    input: opts.input,
    encoding: "utf8",
    timeout: 5000,
  });
  return { stdout: (r.stdout as string) ?? "", status: r.status ?? 1 };
}
