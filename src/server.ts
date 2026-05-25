#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { toolError } from "./util/errors.js";
import { closeAllConnections } from "./dispatcher.js";
import { VERSION } from "./version.js";

import {
  db_query,
  db_list,
  db_describe,
  db_explain,
  db_connection_info,
  db_engines,
  type DbDeps,
} from "./tools/db.js";
import {
  db_snippet_save,
  db_snippet_get,
  db_snippet_run,
  db_snippet_search,
  db_snippet_list,
  db_snippet_delete,
} from "./tools/snippet.js";
import {
  db_credentials_save,
  db_credentials_clear,
} from "./tools/creds.js";
import {
  db_describe_many,
  db_suggest_query,
  db_report_run,
} from "./tools/report.js";
import { resolveConnection } from "./discovery/resolve.js";
import { CredentialsStore } from "./store/credentials.js";
import { SnippetsStore } from "./store/snippets.js";
import { openDb } from "./store/db.js";
import { loadMasterKey } from "./store/key.js";
import { makeKeyring } from "./store/keyring.js";
import { getDataDir } from "./util/paths.js";
import { projectId as resolveProjectId } from "./util/project.js";
import { createDispatcher } from "./dispatcher.js";
import { PostgresDriver } from "./engines/postgres.js";
import { MysqlDriver } from "./engines/mysql.js";
import { MongoDriver } from "./engines/mongo.js";
import { RedisDriver } from "./engines/redis.js";
import { SqliteDriver } from "./engines/sqlite.js";
import type { Engine } from "./types.js";
import * as path from "node:path";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

export { INSTRUCTIONS } from "./instructions.js";
export { ALL_TOOLS } from "./tool-descriptors.js";

/**
 * Wraps tool handler results in MCP's required `{content: [...]}` envelope
 * WITHOUT discarding the original payload. routeTool historically returned
 * raw objects (e.g. {rows: [...], saved: true}); the existing stdio test
 * suite parses those fields directly off the JSON-RPC result. To keep both
 * MCP clients happy AND those tests, this helper merges:
 *
 *   - an MCP-compliant `content: [{type: "text", text: ...}]` block, and
 *   - all original fields from `result` spread alongside it.
 *
 * Results that already include a `content` array are passed through unchanged
 * (e.g. `toolError(...)` output).
 */
function wrapMcpResult(result: unknown): Record<string, unknown> {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    return result as Record<string, unknown>;
  }
  const text =
    result === undefined || result === null
      ? ""
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
  const base: Record<string, unknown> =
    result && typeof result === "object" ? { ...(result as Record<string, unknown>) } : {};
  base["content"] = [{ type: "text", text }];
  return base;
}

export function detectGitRemote(): string | null {
  try {
    const r = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
    if (r.status === 0) return r.stdout.trim() || null;
  } catch {}
  return null;
}

// ─── ServerContext: injectable dependencies for routeTool ──────────────────

export interface ServerContext {
  dbDeps: DbDeps;
  project: string;
  snippetStore: SnippetsStore;
  credStore: CredentialsStore;
}

// ─── routeTool: pure dispatch function, testable in-process ───────────────

export async function routeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ServerContext
): Promise<unknown> {
  const { dbDeps, project, snippetStore, credStore } = ctx;

  switch (name) {
    case "db_query":
      return await db_query(args as Parameters<typeof db_query>[0], dbDeps);
    case "db_list":
      return await db_list(args as Parameters<typeof db_list>[0], dbDeps);
    case "db_describe":
      return await db_describe(args as Parameters<typeof db_describe>[0], dbDeps);
    case "db_explain":
      return await db_explain(args as Parameters<typeof db_explain>[0], dbDeps);
    case "db_connection_info":
      return await db_connection_info(args as Parameters<typeof db_connection_info>[0], dbDeps);
    case "db_engines":
      return await db_engines(args as Record<string, never>, dbDeps);

    case "db_snippet_save":
      return await db_snippet_save(args as Parameters<typeof db_snippet_save>[0], {
        project,
        snippetStore,
        queryRunner: (a: unknown, _d: unknown) =>
          db_query(a as Parameters<typeof db_query>[0], dbDeps),
        queryDeps: dbDeps,
      });
    case "db_snippet_run":
      return await db_snippet_run(args as Parameters<typeof db_snippet_run>[0], {
        project,
        snippetStore,
        queryRunner: (a: unknown, _d: unknown) =>
          db_query(a as Parameters<typeof db_query>[0], dbDeps),
        queryDeps: dbDeps,
      });
    case "db_snippet_get":
      return await db_snippet_get(args as Parameters<typeof db_snippet_get>[0], {
        project,
        snippetStore,
      });
    case "db_snippet_search":
      return await db_snippet_search(args as Parameters<typeof db_snippet_search>[0], {
        project,
        snippetStore,
      });
    case "db_snippet_list":
      return await db_snippet_list(args as Parameters<typeof db_snippet_list>[0], {
        project,
        snippetStore,
      });
    case "db_snippet_delete":
      return await db_snippet_delete(args as Parameters<typeof db_snippet_delete>[0], {
        project,
        snippetStore,
      });

    case "db_credentials_save":
      return await db_credentials_save(args as Parameters<typeof db_credentials_save>[0], {
        project,
        credStore,
      });
    case "db_credentials_clear":
      return await db_credentials_clear(args as Parameters<typeof db_credentials_clear>[0], {
        project,
        credStore,
      });

    case "db_describe_many":
      return await db_describe_many(args as Parameters<typeof db_describe_many>[0], dbDeps);
    case "db_suggest_query":
      return await db_suggest_query(args as Parameters<typeof db_suggest_query>[0], dbDeps);
    case "db_report_run":
      return await db_report_run(args as Parameters<typeof db_report_run>[0], {
        ...dbDeps,
        project,
        snippetStore,
        queryRunner: (a: unknown) =>
          db_query(a as Parameters<typeof db_query>[0], dbDeps),
      });

    default:
      return toolError(`Unknown tool: ${name}`);
  }
}

async function main(): Promise<void> {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  const cwd = process.cwd();
  const project = resolveProjectId({ cwd, gitRemote: detectGitRemote() });
  const keyring = makeKeyring(process.platform);
  const keyFilePath = path.join(dataDir, "master.key.json");
  const masterKey = await loadMasterKey({ keyring, keyFilePath });

  const db = openDb(path.join(dataDir, "db-registry.sqlite"));
  const credStore = new CredentialsStore(db, masterKey);
  const snippetStore = new SnippetsStore(db, masterKey);

  const dispatcher = createDispatcher({
    postgres: new PostgresDriver(),
    mysql: new MysqlDriver(),
    mongo: new MongoDriver(),
    redis: new RedisDriver(),
    sqlite: new SqliteDriver(),
  });

  const dbDeps: DbDeps = {
    getDriver: (engine: Engine) => dispatcher.getDriverFor(engine),
    resolveConfig: (engine: Engine, connectionName: string) =>
      resolveConnection({
        engine,
        connectionName,
        cwd,
        project,
        store: credStore,
      }),
  };

  const ctx: ServerContext = { dbDeps, project, snippetStore, credStore };

  const { INSTRUCTIONS } = await import("./instructions.js");
  const { ALL_TOOLS } = await import("./tool-descriptors.js");

  const server = new Server(
    { name: "db-registry", version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      const result = await routeTool(name, args as Record<string, unknown>, ctx);
      return wrapMcpResult(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  });

  process.on("SIGTERM", async () => {
    await closeAllConnections();
    db.close();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
