import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

/**
 * Returns true if `filePath` is a regular file (not a directory).
 * Never throws — failed stat returns false.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Returns true if `dirPath` is a directory.
 * Never throws — failed stat returns false.
 */
export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Returns true if `binaryName` can be resolved via the system PATH.
 * Uses a synchronous `which` check (POSIX) or `where` (Windows).
 */
export async function whichBinary(binaryName: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [binaryName], { stdio: "ignore" });
  return result.status === 0;
}
