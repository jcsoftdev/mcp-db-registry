import fs from "node:fs/promises";
import path from "node:path";
import type { Adapter, DetectResult, WriteOutcome } from "./adapter";
import { readJson, mergeServer, writeJson } from "./json-config";
import { backup } from "./fs-atomic";

export interface JsonAdapterOptions {
  id: string;
  label: string;
  serverName: string;
  topLevelKey: string; // "mcpServers" | "context_servers"
  configFilePath: string;
  detectFn: () => Promise<DetectResult>;
  buildValue: (serverPath: string) => unknown;
}

export function makeJsonAdapter(opts: JsonAdapterOptions): Adapter {
  return {
    id: opts.id,
    label: opts.label,

    detect: opts.detectFn,

    configPath(): string {
      return opts.configFilePath;
    },

    buildEntry(serverPath: string) {
      return {
        key: opts.topLevelKey,
        name: opts.serverName,
        value: opts.buildValue(serverPath),
      };
    },

    async write(serverPath: string): Promise<WriteOutcome> {
      const configPath = opts.configFilePath;
      try {
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(configPath), { recursive: true });

        const existing = await readJson(configPath);
        const { outcome, config } = mergeServer(
          existing,
          opts.topLevelKey,
          opts.serverName,
          opts.buildValue(serverPath)
        );

        if (outcome === "skipped") {
          return { status: "already-configured" };
        }

        const bak = await backup(configPath);
        await writeJson(configPath, config);
        return { status: "configured", backup: bak };
      } catch (err) {
        return {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
