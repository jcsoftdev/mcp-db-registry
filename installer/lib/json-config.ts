import fs from "node:fs/promises";
import { atomicWrite } from "./fs-atomic";

type AnyObject = Record<string, unknown>;

interface MergeResult {
  outcome: "merged" | "skipped";
  config: AnyObject;
}

/**
 * Deep-equality check (JSON-safe objects only).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges `entry` under `config[topLevelKey][serverName]`.
 * Returns `{ outcome: "skipped" }` if the existing entry is already identical.
 * Returns `{ outcome: "merged", config }` otherwise.
 */
export function mergeServer(
  config: AnyObject,
  topLevelKey: string,
  serverName: string,
  entry: unknown
): MergeResult {
  const section = (config[topLevelKey] ?? {}) as AnyObject;
  const existing = section[serverName];
  if (deepEqual(existing, entry)) {
    return { outcome: "skipped", config };
  }
  const newConfig = {
    ...config,
    [topLevelKey]: {
      ...section,
      [serverName]: entry,
    },
  };
  return { outcome: "merged", config: newConfig };
}

/**
 * Reads a JSON file. Returns {} if the file does not exist or is empty.
 */
export async function readJson(filePath: string): Promise<AnyObject> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) return {};
    return JSON.parse(trimmed) as AnyObject;
  } catch {
    return {};
  }
}

/**
 * Writes an object to `filePath` as pretty-printed JSON with trailing newline.
 * Uses atomicWrite under the hood.
 */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2) + "\n";
  await atomicWrite(filePath, content);
}
