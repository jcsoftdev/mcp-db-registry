import path from "node:path";
import os from "node:os";
import type { Adapter } from "../lib/adapter";
import { dirExists } from "../lib/detect";
import { makeJsonAdapter } from "../lib/make-json-adapter";

interface Options {
  homeDir?: string;
}

export function makeZedAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const zedConfigDir = path.join(homeDir, ".config", "zed");
  const configFile = path.join(zedConfigDir, "settings.json");

  return makeJsonAdapter({
    id: "zed",
    label: "Zed",
    serverName: "db-registry",
    topLevelKey: "context_servers",
    configFilePath: configFile,

    async detectFn() {
      if (await dirExists(zedConfigDir)) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "~/.config/zed/ directory not found" };
    },

    buildValue(serverPath: string) {
      return {
        command: {
          path: "bun",
          args: [serverPath],
        },
      };
    },
  });
}

export const zedAdapter = makeZedAdapter();
