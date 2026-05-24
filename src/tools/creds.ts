import type { Engine } from "../types.js";
import { toolError } from "../util/errors.js";

type CredStoreShape = {
  save(opts: { project: string; engine: Engine; connectionName: string; dsn: string }): Promise<void>;
  clear(opts: { project: string; engine: Engine; connectionName: string }): Promise<void>;
};

export interface CredsDeps {
  project: string;
  credStore: CredStoreShape;
}

export async function db_credentials_save(
  args: { engine: Engine; dsn: string; config?: string; name?: string },
  deps: CredsDeps
): Promise<unknown> {
  const connectionName = args.name ?? "main";
  try {
    await deps.credStore.save({
      project: deps.project,
      engine: args.engine,
      connectionName,
      dsn: args.dsn ?? args.config ?? "",
    });
    return { saved: true };
  } catch (err) {
    return toolError(`Credentials save failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function db_credentials_clear(
  args: { engine: Engine; name?: string },
  deps: CredsDeps
): Promise<unknown> {
  const connectionName = args.name ?? "main";
  try {
    await deps.credStore.clear({
      project: deps.project,
      engine: args.engine,
      connectionName,
    });
    return { cleared: true };
  } catch (err) {
    return toolError(`Credentials clear failed [${args.engine}]: ${err instanceof Error ? err.message : String(err)}`);
  }
}
