import type { Database } from "bun:sqlite";
import type { Engine } from "../types.js";
import { seal, open } from "./crypto.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface SaveOpts {
  project: string;
  engine: Engine;
  connectionName: string;
  dsn: string;
}

export interface GetOpts {
  project: string;
  engine: Engine;
  connectionName: string;
}

type CredRow = { ciphertext: Uint8Array; nonce: Uint8Array };

export class CredentialsStore {
  constructor(private db: Database, private key: Uint8Array) {}

  async save(opts: SaveOpts): Promise<void> {
    const { ciphertext, nonce } = seal(this.key, enc.encode(opts.dsn));
    const now = Date.now();

    this.db.query(`
      INSERT INTO credentials (project, connection_name, engine, ciphertext, nonce, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project, connection_name, engine)
      DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce, updated_at = excluded.updated_at
    `).run(opts.project, opts.connectionName, opts.engine, ciphertext, nonce, now, now);
  }

  async get(opts: GetOpts): Promise<string | null> {
    const row = this.db.query<CredRow, [string, string, string]>(
      "SELECT ciphertext, nonce FROM credentials WHERE project = ? AND connection_name = ? AND engine = ?"
    ).get(opts.project, opts.connectionName, opts.engine);

    if (!row) return null;

    const plaintext = open(this.key, { ciphertext: row.ciphertext, nonce: row.nonce });
    return dec.decode(plaintext);
  }

  async clear(opts: GetOpts): Promise<void> {
    this.db.query(
      "DELETE FROM credentials WHERE project = ? AND connection_name = ? AND engine = ?"
    ).run(opts.project, opts.connectionName, opts.engine);
  }
}
