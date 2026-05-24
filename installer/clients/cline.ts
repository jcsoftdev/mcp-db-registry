import path from "node:path";
import os from "node:os";
import type { Adapter } from "../lib/adapter";
import { dirExists } from "../lib/detect";
import { makeJsonAdapter } from "../lib/make-json-adapter";

interface Options {
  homeDir?: string;
  platform?: NodeJS.Platform;
}

function getConfigPath(homeDir: string, platform: NodeJS.Platform): string {
  const settingsSuffix = [
    "globalStorage",
    "saoudrizwan.claude-dev",
    "settings",
    "cline_mcp_settings.json",
  ];

  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Code", "User", ...settingsSuffix);
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, "Code", "User", ...settingsSuffix);
  }
  return path.join(homeDir, ".config", "Code", "User", ...settingsSuffix);
}

export function makeClineAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const configFile = getConfigPath(homeDir, platform);

  const globalStorageDir = path.join(path.dirname(path.dirname(configFile)));

  return makeJsonAdapter({
    id: "cline",
    label: "Cline",
    serverName: "db-registry",
    topLevelKey: "mcpServers",
    configFilePath: configFile,

    async detectFn() {
      if (await dirExists(globalStorageDir)) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "Cline globalStorage directory not found" };
    },

    buildValue(serverPath: string) {
      return { command: "bun", args: [serverPath] };
    },
  });
}

export const clineAdapter = makeClineAdapter();
