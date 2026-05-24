import path from "node:path";
import os from "node:os";
import type { Adapter } from "../lib/adapter";
import { dirExists } from "../lib/detect";
import { makeJsonAdapter } from "../lib/make-json-adapter";

interface Options {
  homeDir?: string;
}

export function makeWindsurfAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const windsurfDir = path.join(homeDir, ".codeium", "windsurf");
  const configFile = path.join(windsurfDir, "mcp_config.json");

  return makeJsonAdapter({
    id: "windsurf",
    label: "Windsurf",
    serverName: "db-registry",
    topLevelKey: "mcpServers",
    configFilePath: configFile,

    async detectFn() {
      if (await dirExists(windsurfDir)) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "~/.codeium/windsurf/ directory not found" };
    },

    buildValue(serverPath: string) {
      return { command: "bun", args: [serverPath] };
    },
  });
}

export const windsurfAdapter = makeWindsurfAdapter();
