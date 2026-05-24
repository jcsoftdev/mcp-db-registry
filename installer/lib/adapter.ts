export type DetectResult =
  | { installed: true; configPath: string }
  | { installed: false; reason: string };

export type WriteOutcome =
  | { status: "configured"; backup: string | null }
  | { status: "already-configured" }
  | { status: "failed"; error: string };

export interface Adapter {
  id: string;
  label: string;
  detect(): Promise<DetectResult>;
  configPath(): string;
  buildEntry(serverPath: string): { key: string; name: string; value: unknown };
  write(serverPath: string): Promise<WriteOutcome>;
}

export async function runAdapter(
  adapter: Adapter,
  serverPath: string
): Promise<WriteOutcome> {
  try {
    return await adapter.write(serverPath);
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
