import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Adapter, WriteOutcome } from "../lib/adapter";
import { dirExists } from "../lib/detect";
import { readYaml, mergeServer, writeYaml } from "../lib/yaml-config";
import { backup } from "../lib/fs-atomic";

interface Options {
  homeDir?: string;
}

export function makeContinueAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const continueDir = path.join(homeDir, ".continue");
  const configFile = path.join(continueDir, "config.yaml");

  return {
    id: "continue",
    label: "Continue",

    async detect() {
      if (await dirExists(continueDir)) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "~/.continue/ directory not found" };
    },

    configPath(): string {
      return configFile;
    },

    buildEntry(serverPath: string) {
      return {
        key: "mcpServers",
        name: "db-registry",
        value: {
          name: "db-registry",
          command: "bun",
          args: [serverPath],
        },
      };
    },

    async write(serverPath: string): Promise<WriteOutcome> {
      try {
        await fs.mkdir(continueDir, { recursive: true });

        const existing = await readYaml(configFile);
        const entry = {
          name: "db-registry",
          command: "bun",
          args: [serverPath],
        };

        const { outcome, config } = mergeServer(existing, "db-registry", entry);
        if (outcome === "skipped") {
          return { status: "already-configured" };
        }
        const bak = await backup(configFile);
        await writeYaml(configFile, config);
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

export const continueAdapter = makeContinueAdapter();
