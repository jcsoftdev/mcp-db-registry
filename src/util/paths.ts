import path from "node:path";
import os from "node:os";

const APP_NAME = "db-registry";

export function getDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, APP_NAME);
}
