import path from "node:path";
import os from "node:os";
import type { Adapter } from "../lib/adapter";
import { dirExists } from "../lib/detect";
import { makeJsonAdapter } from "../lib/make-json-adapter";

interface Options {
  homeDir?: string;
}

export function makeCursorAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const configFile = path.join(homeDir, ".cursor", "mcp.json");
  const cursorDir = path.join(homeDir, ".cursor");

  return makeJsonAdapter({
    id: "cursor",
    label: "Cursor",
    serverName: "db-registry",
    topLevelKey: "mcpServers",
    configFilePath: configFile,

    async detectFn() {
      if (await dirExists(cursorDir)) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "~/.cursor/ directory not found" };
    },

    buildValue(serverPath: string) {
      return { command: "bun", args: [serverPath] };
    },
  });
}

export const cursorAdapter = makeCursorAdapter();
