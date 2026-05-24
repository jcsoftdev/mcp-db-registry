import path from "node:path";
import os from "node:os";
import type { Adapter } from "../lib/adapter";
import { dirExists } from "../lib/detect";
import { makeJsonAdapter } from "../lib/make-json-adapter";

interface Options {
  homeDir?: string;
}

export function makePiAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const configFile = path.join(homeDir, ".config", "mcp", "mcp.json");

  return makeJsonAdapter({
    id: "pi",
    label: "Pi (gentle-ai)",
    serverName: "db-registry",
    topLevelKey: "mcpServers",
    configFilePath: configFile,

    async detectFn() {
      const parentDir = path.dirname(configFile);
      if (await dirExists(parentDir)) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "Pi MCP config directory not found" };
    },

    buildValue(serverPath: string) {
      return { command: "bun", args: [serverPath] };
    },
  });
}

export const piAdapter = makePiAdapter();
