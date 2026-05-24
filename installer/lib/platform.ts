import os from "node:os";
import path from "node:path";

export function home(): string {
  return os.homedir();
}

export function isSupported(): boolean {
  const plat = process.platform;
  if (plat === "win32") return false;
  const arch = process.arch;
  if (arch === "arm" || arch === "ia32") return false;
  return true;
}

export function resolveConfigPath(
  client:
    | "claude-code"
    | "claude-desktop"
    | "cursor"
    | "windsurf"
    | "cline"
    | "continue"
    | "zed",
  platform: NodeJS.Platform = process.platform
): string {
  const h = home();
  switch (client) {
    case "claude-code":
      return path.join(h, ".claude.json");
    case "claude-desktop":
      if (platform === "darwin") {
        return path.join(
          h,
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json"
        );
      }
      return path.join(h, ".config", "Claude", "claude_desktop_config.json");
    case "cursor":
      return path.join(h, ".cursor", "mcp.json");
    case "windsurf":
      return path.join(h, ".codeium", "windsurf", "mcp_config.json");
    case "cline": {
      // VSCode globalStorage — OS-aware
      if (platform === "darwin") {
        return path.join(
          h,
          "Library",
          "Application Support",
          "Code",
          "User",
          "globalStorage",
          "saoudrizwan.claude-dev",
          "settings",
          "cline_mcp_settings.json"
        );
      }
      if (platform === "win32") {
        return path.join(
          process.env.APPDATA ?? path.join(h, "AppData", "Roaming"),
          "Code",
          "User",
          "globalStorage",
          "saoudrizwan.claude-dev",
          "settings",
          "cline_mcp_settings.json"
        );
      }
      return path.join(
        h,
        ".config",
        "Code",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json"
      );
    }
    case "continue":
      return path.join(h, ".continue", "config.yaml");
    case "zed":
      return path.join(h, ".config", "zed", "settings.json");
  }
}
