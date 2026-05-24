export type Engine = "postgres" | "mysql" | "mongo" | "redis" | "sqlite";

export interface ResolvedConfig {
  engine: Engine;
  host: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
  source: Partial<Record<keyof ResolvedConfig, ConfigSource>>;
  url?: string;
}

export type ConfigSource = "stored" | "env" | "compose" | "port-mcp" | "default";

export type Row = Record<string, unknown>;

export type QueryResult =
  | { kind: "rows"; rows: Row[]; truncated: boolean; rowCount: number }
  | { kind: "docs"; docs: Row[]; truncated: boolean }
  | { kind: "reply"; reply: unknown }
  | { kind: "void" };

export interface EngineDriver<E extends Engine = Engine> {
  readonly engine: E;
  connect(cfg: ResolvedConfig): Promise<Connection<E>>;
  close(conn: Connection<E>): Promise<void>;
  ping(conn: Connection<E>): Promise<boolean>;
  query(conn: Connection<E>, body: string, params?: unknown[]): Promise<QueryResult>;
  list(conn: Connection<E>, kind: "tables" | "collections" | "keys" | "indexes"): Promise<string[]>;
  describe(conn: Connection<E>, target: string): Promise<Row[]>;
  explain(conn: Connection<E>, body: string): Promise<QueryResult>;
  getForeignKeys(conn: Connection<E>, tables: string[]): Promise<ForeignKey[]>;
}

export type Connection<E extends Engine> = { engine: E; native: unknown };

export interface WriteGuard {
  readonly engine: Engine;
  isReadOnly(body: unknown): boolean;
}

export interface KeyringProvider {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

export interface Credential {
  project: string;
  connectionName: string;
  engine: Engine;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  createdAt: number;
  updatedAt: number;
}

export interface Snippet {
  id: number;
  project: string;
  engine: Engine;
  name: string;
  description: string | null;
  tags: string | null;
  category?: string | null;
  paramsSchema: string | null;
  bodyKind: "sql" | "mongo-op" | "redis-cmd";
  body: Uint8Array;
  bodyNonce: Uint8Array;
  usesCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const dbQueryInputSchema = {
  type: "object",
  required: ["engine", "body"],
  properties: {
    engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] as const },
    connection: { type: "string", description: "Saved connection name; default 'main'." },
    body: { type: "string", description: "SQL string, JSON-encoded mongo op, or redis command line." },
    params: { type: "array", items: {}, description: "Parameter bindings for parameterized queries." },
    limit: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
  },
} as const;

export const snippetSaveInputSchema = {
  type: "object",
  required: ["engine", "name", "body"],
  properties: {
    engine: { enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] as const },
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", maxLength: 1000 },
    tags: { type: "array", items: { type: "string" } },
    paramsSchema: { type: "object", description: "Optional JSONSchema for the body's params." },
    body: { type: "string" },
    bodyKind: { enum: ["sql", "mongo-op", "redis-cmd"] as const },
    category: { type: "string", maxLength: 80, description: "Optional grouping label. Indexed in FTS5." },
  },
} as const;

export interface ForeignKey {
  from_table: string;
  from_col: string;
  to_table: string;
  to_col: string;
}

export interface JoinEdge {
  from: string;
  from_col: string;
  to: string;
  to_col: string;
}

export type ReportMergeMode = "object" | "union" | "join";

export type ColumnInfo = Record<string, unknown>;

export interface TableDescribe {
  table: string;
  columns: ColumnInfo[];
}

export interface DescribeManyResult {
  tables: TableDescribe[];
  missing: string[];
  errors: { table: string; message: string }[];
}

export interface SuggestQueryResult {
  sql: string;
  tables: string[];
  join_path: JoinEdge[];
  warnings: string[];
}

export interface SnippetRunOutcome {
  snippet_name: string;
  rows: Row[];
  kind: QueryResult["kind"];
  raw?: QueryResult;
  error?: string;
}

export interface SnippetRunError {
  snippet_name: string;
  message: string;
}

export interface JoinOnSpec {
  snippet_name: string;
  column: string;
}

export type ReportRunResult =
  | { mode: "object"; results: Record<string, unknown>; errors: SnippetRunError[] }
  | { mode: "union"; rows: Row[]; columns: string[]; _truncated: boolean; _total_rows: number; errors: SnippetRunError[] }
  | { mode: "join"; rows: Row[]; columns: string[]; _truncated: boolean; _total_rows: number; errors: SnippetRunError[] };
