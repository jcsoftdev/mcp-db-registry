import path from "node:path";
import os from "node:os";
import type { Adapter } from "../lib/adapter";
import { dirExists } from "../lib/detect";
import { makeJsonAdapter } from "../lib/make-json-adapter";

interface Options {
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export function makeClaudeDesktopAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const platform = opts.platform ?? process.platform;

  const configFile =
    platform === "darwin"
      ? path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : path.join(homeDir, ".config", "Claude", "claude_desktop_config.json");

  return makeJsonAdapter({
    id: "claude-desktop",
    label: "Claude Desktop",
    serverName: "db-registry",
    topLevelKey: "mcpServers",
    configFilePath: configFile,

    async detectFn() {
      const parentDir = path.dirname(configFile);
      if (await dirExists(parentDir)) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "Claude Desktop config directory not found" };
    },

    buildValue(serverPath: string) {
      return { command: "bun", args: [serverPath] };
    },
  });
}

export const claudeDesktopAdapter = makeClaudeDesktopAdapter();
