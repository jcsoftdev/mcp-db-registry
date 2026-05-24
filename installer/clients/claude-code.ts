import path from "node:path";
import os from "node:os";
import type { Adapter } from "../lib/adapter";
import { fileExists, whichBinary } from "../lib/detect";
import { makeJsonAdapter } from "../lib/make-json-adapter";

interface Options {
  homeDir?: string;
  whichOverride?: (bin: string) => Promise<boolean>;
}

export function makeClaudeCodeAdapter(opts: Options = {}): Adapter {
  const homeDir = opts.homeDir ?? os.homedir();
  const configFile = path.join(homeDir, ".claude.json");
  const which = opts.whichOverride ?? whichBinary;

  return makeJsonAdapter({
    id: "claude-code",
    label: "Claude Code",
    serverName: "db-registry",
    topLevelKey: "mcpServers",
    configFilePath: configFile,

    async detectFn() {
      if (await fileExists(configFile)) {
        return { installed: true, configPath: configFile };
      }
      if (await which("claude")) {
        return { installed: true, configPath: configFile };
      }
      return { installed: false, reason: "~/.claude.json not found and `claude` not in PATH" };
    },

    buildValue(serverPath: string) {
      return {
        type: "stdio",
        command: "bun",
        args: [serverPath],
      };
    },
  });
}

export const claudeCodeAdapter = makeClaudeCodeAdapter();
