import fs from "node:fs/promises";

/**
 * Atomically writes `content` to `target`.
 * Strategy: write to a `.tmp.{pid}` file in the SAME directory,
 * then fs.rename (atomic on same filesystem).
 */
export async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = `${target}.tmp.${process.pid}`;
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, target);
  } catch (err) {
    // Clean up tmp on failure; ignore cleanup errors
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Copies `target` to `{target}.bak.{ISO-timestamp}` (colons → hyphens).
 * Returns the backup path, or null if target does not exist.
 */
export async function backup(target: string): Promise<string | null> {
  try {
    await fs.access(target);
  } catch {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bakPath = `${target}.bak.${stamp}`;
  await fs.copyFile(target, bakPath);
  return bakPath;
}
