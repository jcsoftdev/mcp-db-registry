import type { Engine } from "../types.js";
import { toolError } from "../util/errors.js";
import { makeWriteGuard, checkWriteAllowed } from "../safety/write-detect.js";

type StoreShape = {
  save(opts: {
    project: string;
    engine: Engine;
    name: string;
    body: string;
    description?: string;
    tags?: string[];
    category?: string;
    paramsSchema?: string;
  }): Promise<void>;
  get(key: { project: string; engine: Engine; name: string }): Promise<{
    name: string;
    engine: Engine;
    body: string;
    bodyKind: string;
    description: string | null;
    tags: string | null;
    category: string | null;
    usesCount: number;
    lastUsedAt: number | null;
  } | null>;
  list(opts: { project: string; engine?: Engine; category?: string }): Promise<{
    name: string;
    engine: Engine;
    description: string | null;
    tags: string | null;
    category: string | null;
    usesCount: number;
    lastUsedAt: number | null;
  }[]>;
  delete(key: { project: string; engine: Engine; name: string }): Promise<void>;
  search(opts: { query: string }): Promise<{
    name: string;
    engine: Engine;
    description: string | null;
    tags: string | null;
    category: string | null;
    score: number;
  }[]>;
  incrementUsage(key: { project: string; engine: Engine; name: string }): Promise<void>;
};

type QueryRunner = (args: unknown, deps: unknown) => Promise<unknown>;

export interface SnippetDeps {
  project: string;
  snippetStore: StoreShape;
  queryRunner?: QueryRunner;
  queryDeps?: unknown;
}

export async function db_snippet_save(
  args: {
    engine: Engine;
    name: string;
    body: string;
    description?: string;
    tags?: string[];
    category?: string;
    paramsSchema?: string;
  },
  deps: SnippetDeps
): Promise<unknown> {
  try {
    await deps.snippetStore.save({
      project: deps.project,
      engine: args.engine,
      name: args.name,
      body: args.body,
      description: args.description,
      tags: args.tags,
      category: args.category,
      paramsSchema: args.paramsSchema,
    });
    return { saved: true };
  } catch (err) {
    return toolError(`Snippet save failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function db_snippet_get(
  args: { name: string; engine?: Engine },
  deps: SnippetDeps
): Promise<unknown> {
  const engine = args.engine ?? ("postgres" as Engine);
  try {
    const snippet = await deps.snippetStore.get({
      project: deps.project,
      engine,
      name: args.name,
    });
    if (!snippet) {
      return toolError(`Snippet not found: ${args.name}`);
    }
    return {
      name: snippet.name,
      engine: snippet.engine,
      description: snippet.description,
      tags: snippet.tags ? snippet.tags.split(",").filter(Boolean) : [],
      body: snippet.body,
      bodyKind: snippet.bodyKind,
      usesCount: snippet.usesCount,
      lastUsedAt: snippet.lastUsedAt,
    };
  } catch (err) {
    return toolError(`Snippet get failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function db_snippet_run(
  args: { name: string; engine?: Engine; params?: unknown },
  deps: SnippetDeps
): Promise<unknown> {
  const engine = args.engine ?? ("postgres" as Engine);
  let snippet: Awaited<ReturnType<StoreShape["get"]>>;
  try {
    snippet = await deps.snippetStore.get({
      project: deps.project,
      engine,
      name: args.name,
    });
  } catch (err) {
    return toolError(`Snippet run failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!snippet) {
    return toolError(`Snippet not found: ${args.name}`);
  }

  try {
    const guard = makeWriteGuard(engine);
    checkWriteAllowed(guard, snippet.body, { allowWrite: false });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }

  const runner = deps.queryRunner;
  if (!runner) {
    return toolError("No query runner provided");
  }

  let result: unknown;
  try {
    result = await runner(
      { engine, body: snippet.body, params: args.params },
      deps.queryDeps
    );
  } catch (err) {
    return toolError(`Snippet execution failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await deps.snippetStore.incrementUsage({
    project: deps.project,
    engine,
    name: args.name,
  });

  return result;
}

export async function db_snippet_search(
  args: { query: string; engine?: Engine; tags?: string[] },
  deps: SnippetDeps
): Promise<unknown> {
  try {
    const results = await deps.snippetStore.search({ query: args.query });
    const filtered = args.engine ? results.filter((r) => r.engine === args.engine) : results;
    return {
      results: filtered.map((r) => ({
        name: r.name,
        engine: r.engine,
        description: r.description,
        tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
        score: r.score,
      })),
    };
  } catch (err) {
    return toolError(`Snippet search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function db_snippet_list(
  args: { engine?: Engine; tags?: string[]; sort?: string; category?: string },
  deps: SnippetDeps
): Promise<unknown> {
  try {
    const items = await deps.snippetStore.list({
      project: deps.project,
      engine: args.engine,
      category: args.category,
    });
    return {
      snippets: items.map((s) => ({
        name: s.name,
        engine: s.engine,
        description: s.description,
        tags: s.tags ? s.tags.split(",").filter(Boolean) : [],
        category: s.category ?? null,
        usesCount: s.usesCount,
        lastUsedAt: s.lastUsedAt,
      })),
    };
  } catch (err) {
    return toolError(`Snippet list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function db_snippet_delete(
  args: { name: string; engine?: Engine },
  deps: SnippetDeps
): Promise<unknown> {
  const engine = args.engine ?? ("postgres" as Engine);
  try {
    await deps.snippetStore.delete({
      project: deps.project,
      engine,
      name: args.name,
    });
    return { deleted: true };
  } catch (err) {
    return toolError(`Snippet delete failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
