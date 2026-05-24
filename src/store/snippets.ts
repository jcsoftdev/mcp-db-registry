import type { Database } from "bun:sqlite";
import type { Engine } from "../types.js";
import { seal, open } from "./crypto.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface SaveSnippetOpts {
  project: string;
  engine: Engine;
  name: string;
  body: string;
  bodyKind?: "sql" | "mongo-op" | "redis-cmd";
  description?: string;
  tags?: string[];
  paramsSchema?: string;
}

export interface SnippetKey {
  project: string;
  engine: Engine;
  name: string;
}

export interface SnippetMeta {
  name: string;
  engine: Engine;
  description: string | null;
  tags: string | null;
  usesCount: number;
  lastUsedAt: number | null;
}

export interface SnippetFull extends SnippetMeta {
  body: string;
  bodyKind: string;
}

export interface SearchResult {
  name: string;
  engine: Engine;
  description: string | null;
  tags: string | null;
  score: number;
}

type SnippetRow = {
  id: number;
  name: string;
  engine: string;
  description: string | null;
  tags: string | null;
  body_kind: string;
  body: Uint8Array;
  body_nonce: Uint8Array;
  uses_count: number;
  last_used_at: number | null;
};

export class SnippetsStore {
  constructor(private db: Database, private key: Uint8Array) {}

  async save(opts: SaveSnippetOpts): Promise<void> {
    const { ciphertext, nonce } = seal(this.key, enc.encode(opts.body));
    const now = Date.now();
    const tagsStr = opts.tags ? opts.tags.map((t) => t.toLowerCase()).join(",") : null;
    const bodyKind = opts.bodyKind ?? "sql";

    this.db.query(`
      INSERT INTO snippets
        (project, engine, name, description, tags, params_schema, body_kind, body, body_nonce, uses_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT (project, engine, name)
      DO UPDATE SET
        description = excluded.description,
        tags = excluded.tags,
        params_schema = excluded.params_schema,
        body_kind = excluded.body_kind,
        body = excluded.body,
        body_nonce = excluded.body_nonce,
        updated_at = excluded.updated_at
    `).run(
      opts.project, opts.engine, opts.name,
      opts.description ?? null, tagsStr, opts.paramsSchema ?? null,
      bodyKind, ciphertext, nonce, now, now
    );
  }

  async get(key: SnippetKey): Promise<SnippetFull | null> {
    const row = this.db.query<SnippetRow, [string, string, string]>(
      `SELECT id, name, engine, description, tags, body_kind, body, body_nonce, uses_count, last_used_at
       FROM snippets WHERE project = ? AND engine = ? AND name = ?`
    ).get(key.project, key.engine, key.name);

    if (!row) return null;
    return this.toFull(row);
  }

  async list(opts: { project: string; engine?: Engine }): Promise<SnippetMeta[]> {
    let rows: SnippetRow[];
    if (opts.engine) {
      rows = this.db.query<SnippetRow, [string, string]>(
        `SELECT id, name, engine, description, tags, body_kind, body, body_nonce, uses_count, last_used_at
         FROM snippets WHERE project = ? AND engine = ? ORDER BY name`
      ).all(opts.project, opts.engine);
    } else {
      rows = this.db.query<SnippetRow, [string]>(
        `SELECT id, name, engine, description, tags, body_kind, body, body_nonce, uses_count, last_used_at
         FROM snippets WHERE project = ? ORDER BY engine, name`
      ).all(opts.project);
    }

    return rows.map((r) => ({
      name: r.name,
      engine: r.engine as Engine,
      description: r.description,
      tags: r.tags,
      usesCount: r.uses_count,
      lastUsedAt: r.last_used_at,
    }));
  }

  async delete(key: SnippetKey): Promise<void> {
    this.db.query(
      "DELETE FROM snippets WHERE project = ? AND engine = ? AND name = ?"
    ).run(key.project, key.engine, key.name);
  }

  async search(opts: { query: string }): Promise<SearchResult[]> {
    const sanitized = opts.query.trim().split(/\s+/).map((t) => `"${t}"`).join(" ");

    type FtsRow = { rowid: number; name: string; engine: string; description: string | null; tags: string | null; rank: number };

    const rows = this.db.query<FtsRow, [string]>(
      `SELECT s.rowid, s.name, s.engine, s.description, s.tags, f.rank
       FROM snippets_fts f
       JOIN snippets s ON s.id = f.rowid
       WHERE snippets_fts MATCH ?
       ORDER BY f.rank`
    ).all(sanitized);

    return rows.map((r) => ({
      name: r.name,
      engine: r.engine as Engine,
      description: r.description,
      tags: r.tags,
      score: r.rank,
    }));
  }

  async incrementUsage(key: SnippetKey): Promise<void> {
    this.db.query(`
      UPDATE snippets
      SET uses_count = uses_count + 1, last_used_at = ?
      WHERE project = ? AND engine = ? AND name = ?
    `).run(Date.now(), key.project, key.engine, key.name);
  }

  private toFull(row: SnippetRow): SnippetFull {
    const plaintext = open(this.key, { ciphertext: row.body, nonce: row.body_nonce });
    return {
      name: row.name,
      engine: row.engine as Engine,
      description: row.description,
      tags: row.tags,
      bodyKind: row.body_kind,
      body: dec.decode(plaintext),
      usesCount: row.uses_count,
      lastUsedAt: row.last_used_at,
    };
  }
}
