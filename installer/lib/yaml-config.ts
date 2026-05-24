import fs from "node:fs/promises";
import * as yaml from "yaml";
import { atomicWrite } from "./fs-atomic";

interface YamlConfig {
  mcpServers?: unknown[];
  [key: string]: unknown;
}

interface MergeResult {
  outcome: "merged" | "skipped";
  config: YamlConfig;
}

/**
 * Upserts an entry by name in the `mcpServers` sequence.
 * - If an entry with the same `name` exists, it is replaced.
 * - Otherwise the entry is appended.
 * - Creates the `mcpServers` key if absent.
 */
export function mergeServer(
  config: YamlConfig,
  serverName: string,
  entry: Record<string, unknown>
): MergeResult {
  const servers: unknown[] = Array.isArray(config.mcpServers)
    ? [...config.mcpServers]
    : [];

  const idx = servers.findIndex(
    (e): e is Record<string, unknown> =>
      typeof e === "object" && e !== null && (e as any).name === serverName
  );

  if (idx !== -1 && deepEqual(servers[idx], entry)) {
    return { outcome: "skipped", config };
  }

  if (idx !== -1) {
    servers[idx] = entry;
  } else {
    servers.push(entry);
  }

  return {
    outcome: "merged",
    config: { ...config, mcpServers: servers },
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Reads a YAML file. Returns {} if the file does not exist or is empty.
 */
export async function readYaml(filePath: string): Promise<YamlConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = yaml.parse(raw);
    return parsed ?? {};
  } catch {
    return {};
  }
}

/**
 * Writes a config object to `filePath` as YAML using atomicWrite.
 */
export async function writeYaml(filePath: string, data: YamlConfig): Promise<void> {
  const content = yaml.stringify(data);
  await atomicWrite(filePath, content);
}
