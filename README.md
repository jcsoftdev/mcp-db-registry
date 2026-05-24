# db-registry

Global multi-engine database MCP server for LLM coding agents. One server, five engines, generic tools with `engine` param. Auto-discovers connections, encrypts credentials at rest, and indexes reusable query snippets.

## Engines

- `postgres`
- `mysql`
- `mongo`
- `redis`
- `sqlite`

---

## Install

### 1. Install dependencies

```bash
bun install
```

### 2. Run the installer

```bash
bun installer/index.ts
```

The installer auto-detects installed clients (Claude Code, Claude Desktop, Cursor, Windsurf, Cline, Continue, Zed, Pi) and writes the MCP server entry to each config file.

**Non-interactive mode** (CI / scripted):

```bash
bun installer/index.ts --yes
bun installer/index.ts --yes --clients claude-code,cursor
```

---

## Configuration per engine

### Environment variables (auto-discovered from cwd `.env`)

| Engine   | Variable(s)                                          |
|----------|------------------------------------------------------|
| postgres | `POSTGRES_URL` / `PGHOST` + `PGPORT` + `PGUSER` + `PGPASSWORD` + `PGDATABASE` |
| mysql    | `MYSQL_HOST` / `MYSQL_URL` / `DATABASE_URL`          |
| mongo    | `MONGO_URL` / `MONGODB_URI`                          |
| redis    | `REDIS_URL` / `REDIS_HOST`                           |
| sqlite   | `SQLITE_PATH` / `DATABASE_URL` (`.sqlite` extension) |

### docker-compose.yml (auto-discovered from cwd)

If a `docker-compose.yml` is present, services are matched by name to an engine. Standard service names (`postgres`, `mysql`, `mongo`, `redis`) are detected automatically. Custom service names are matched by image prefix.

### Saved credentials (via `db_credentials_save`)

```json
{ "engine": "postgres", "dsn": "postgres://user:pass@host:5432/dbname", "name": "main" }
```

Credentials are encrypted with XChaCha20-Poly1305. The master key lives in macOS Keychain (via `security` CLI) or in a passphrase-wrapped file at `$XDG_DATA_HOME/db-registry/master.key.json`.

---

## Tool reference

All tools accept an `engine` parameter: `"postgres" | "mysql" | "mongo" | "redis" | "sqlite"`.

### `db_query`

Execute a query or command.

```json
{
  "engine": "postgres",
  "body": "SELECT id, name FROM users WHERE active = true LIMIT 10",
  "connection": "main",
  "limit": 100
}
```

Returns `{ rows, _truncated, _total_rows }` for SQL/SQLite, `{ docs, _truncated }` for Mongo, `{ reply }` for Redis. When `_truncated` is `true`, `_total_rows` contains the full result count before truncation.

### `db_list`

List tables, collections, or keys.

```json
{ "engine": "postgres", "kind": "tables" }
```

### `db_describe`

Describe the schema of a table/collection.

```json
{ "engine": "sqlite", "target": "users" }
```

### `db_explain`

Get the query execution plan.

```json
{ "engine": "postgres", "body": "SELECT * FROM orders WHERE status = 'pending'" }
```

### `db_connection_info`

Return resolved connection config (password never included).

```json
{ "engine": "postgres", "connection": "main" }
```

### `db_engines`

List all engines with availability and discovery source.

```json
{}
```

Returns `{ engines: [{ name, available, discovered_via }] }` — `name` is the engine identifier, `discovered_via` is one of `env`, `compose`, `port-registry`, `default`, or `none`.

### `db_credentials_save`

Save an encrypted credential for an engine.

```json
{ "engine": "postgres", "dsn": "postgres://user:pass@localhost:5432/mydb", "name": "main" }
```

### `db_credentials_clear`

Remove a saved credential.

```json
{ "engine": "postgres", "name": "main" }
```

### `db_describe_many`

Describe multiple tables in a single call. Returns schemas keyed by table name; tables not found are reported in `missing[]`. For mongo, a `warnings[]` field is included indicating that introspection falls back to sampling.

```json
{
  "engine": "postgres",
  "tables": ["users", "orders", "products"],
  "connection": "main"
}
```

Returns `{ schemas: { tableName: ColumnInfo[] }, missing: [tableName] }` — key insertion order in `schemas` matches the input `tables` array order.

### `db_suggest_query`

Build a FK-aware SQL skeleton that joins the requested tables. Does **not** execute the query. Disconnected tables (no FK path) are reported in `warnings[]` — no silent cartesian products.

```json
{
  "engine": "postgres",
  "intent": "list recent orders with customer details",
  "tables": ["orders", "users"],
  "connection": "main"
}
```

Returns `{ sql, tables, join_path: [{ from, from_col, to, to_col }], warnings }`. The generated SQL includes a `-- intent: <text>` comment and a `LIMIT 100` guard.

### `db_report_run`

Run multiple saved snippets sequentially and merge their results. Per-snippet write-guard is enforced before each execution. Merged result is capped at 1000 rows.

```json
{
  "engine": "postgres",
  "snippet_names": ["active-users", "recent-orders"],
  "merge": "object"
}
```

**Merge modes:**
- `object` (default) — result keyed by snippet name: `{ "active-users": [...rows], "recent-orders": [...rows] }`
- `union` — all rows unioned into a flat array; missing columns filled with `null`; `_source` column added
- `join` — inner-join across snippets on an explicit key; requires `join_on: [{ snippet_name, column }]`

```json
{
  "engine": "sqlite",
  "snippet_names": ["users-list", "orders-summary"],
  "merge": "join",
  "join_on": [
    { "snippet_name": "users-list", "column": "user_id" },
    { "snippet_name": "orders-summary", "column": "user_id" }
  ]
}
```

Returns `{ mode, result|rows, errors, _truncated, _total_rows }`.

### `db_snippet_save`

Save a reusable query snippet (body encrypted at rest). The optional `category` field groups snippets for filtering and is indexed for full-text search.

```json
{
  "engine": "postgres",
  "name": "active-users",
  "body": "SELECT id, email FROM users WHERE active = true",
  "description": "List all active users",
  "tags": ["users", "reporting"],
  "category": "analytics"
}
```

### `db_snippet_run`

Run a saved snippet by name. Increments usage counter.

```json
{ "name": "active-users", "engine": "postgres" }
```

### `db_snippet_get`

Retrieve a snippet with its decrypted body and metadata.

```json
{ "name": "active-users", "engine": "postgres" }
```

### `db_snippet_search`

Full-text search snippets by name, description, or tags.

```json
{ "query": "active users reporting" }
```

### `db_snippet_list`

List snippets (no bodies). Optionally filter by engine or `category` (exact match).

```json
{ "engine": "postgres", "category": "analytics" }
```

### `db_snippet_delete`

Delete a saved snippet.

```json
{ "name": "active-users", "engine": "postgres" }
```

---

## Snippet workflow

```
1. Save a snippet once:
   db_snippet_save { engine, name, body, description?, tags?, category? }

2. Later, run it by name — no need to retype the SQL:
   db_snippet_run { name, engine }

3. Find snippets by keyword (name, description, tags, or category):
   db_snippet_search { query: "active users" }

4. List snippets filtered by category:
   db_snippet_list { engine, category: "analytics" }

5. Inspect the body:
   db_snippet_get { name, engine }
```

Snippet bodies are encrypted with the same master key as credentials. FTS5 indexes `name`, `description`, `tags`, and `category` fields for fast full-text search. The `usesCount` field increments atomically on each `db_snippet_run` call.

---

## Composing complex reports

Use the three report tools together to build multi-table, multi-query reports without writing ad-hoc SQL each time.

**Typical agent workflow:**

```
1. Discover schema:
   db_describe_many { engine: "postgres", tables: ["orders", "users", "products"] }

2. Generate a JOIN skeleton from FK relationships:
   db_suggest_query { engine: "postgres", intent: "revenue by customer last 30 days",
                      tables: ["orders", "users"] }
   → returns SQL with JOIN + "-- intent:" comment; copy-paste or refine manually

3. Save the finalized queries as categorized snippets:
   db_snippet_save { engine: "postgres", name: "revenue-by-customer",
                     body: "<sql>", category: "revenue-reports" }
   db_snippet_save { engine: "postgres", name: "top-products",
                     body: "<sql>", category: "revenue-reports" }

4. Run both snippets together and merge results:
   db_report_run { engine: "postgres",
                   snippet_names: ["revenue-by-customer", "top-products"],
                   merge: "object" }
   → { "revenue-by-customer": [...rows], "top-products": [...rows] }

5. Or union them into a single flat table for tabular display:
   db_report_run { engine: "postgres",
                   snippet_names: ["revenue-by-customer", "top-products"],
                   merge: "union" }
   → unified rows with _source column identifying the origin snippet
```

**Key properties:**
- Write-guard is checked per-snippet before execution — safe to use in reports even when `DB_REGISTRY_ALLOW_WRITE` is unset.
- Merged result is capped at 1000 rows. `_truncated: true` and `_total_rows: N` are included when truncation occurs.
- `db_suggest_query` never emits cartesian products — disconnected tables are excluded and reported in `warnings[]`.

---

## Encryption & keyring

- **Master key**: 32-byte random key stored in macOS Keychain (`db-registry` service, `master-key` account) or wrapped with an age-style passphrase in `$XDG_DATA_HOME/db-registry/master.key.json`.
- **Encryption**: XChaCha20-Poly1305 via `@noble/ciphers`. Each credential and snippet body is independently sealed with a unique 24-byte random nonce.
- **Key derivation**: Argon2id (via `@noble/hashes`) for passphrase-based wrapping.

On macOS, key storage and retrieval is fully automatic via the macOS Keychain. On Linux, `secret-tool` is used. On Windows, a passphrase fallback is required.

---

## Read-only mode

By default, all write operations are blocked:

- SQL: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `REPLACE`, `MERGE` are rejected.
- Mongo: `insertOne/Many`, `updateOne/Many`, `deleteOne/Many`, `drop`, `$set/$push/$unset/…` are rejected.
- Redis: `SET`, `DEL`, `FLUSHALL`, `HSET`, `LPUSH`, and other write commands are rejected.

To enable writes:

```bash
DB_REGISTRY_ALLOW_WRITE=1
```

---

## Multi-client installer

The installer writes the MCP server entry to each detected client config:

| Client         | Config location                                              |
|----------------|--------------------------------------------------------------|
| Claude Code    | `~/.claude/claude_code_config.json`                          |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Cursor         | `~/.cursor/mcp.json`                                         |
| Windsurf       | `~/.windsurf/mcp.json`                                       |
| Cline          | VS Code extension settings                                   |
| Continue       | `~/.continue/config.yaml`                                    |
| Zed            | `~/.config/zed/settings.json`                                |
| Pi             | `~/.pi/mcp.json`                                             |

Each adapter performs an atomic write with a `.bak` backup before modifying the config file.

---

## Integration test runner

Integration tests require running database instances. Start them with Docker Compose:

```bash
# Start test databases on non-default ports
docker compose -f docker-compose.test.yml up -d

# Run integration tests
INTEGRATION=1 bun test

# Stop and remove containers + volumes
docker compose -f docker-compose.test.yml down -v
```

Port assignments (avoid collision with local instances):

| Engine   | Test port |
|----------|-----------|
| postgres | 5433      |
| mysql    | 3307      |
| mongo    | 27018     |
| redis    | 6380      |

---

## Troubleshooting

### `keyring empty and no passphrase provider; cannot unlock`

The master key is not in the system keychain, and no `passphraseFn` was provided. This happens when:
- Running on macOS but the Keychain entry was deleted.
- Running on Linux without `secret-tool` installed.

Fix: delete `$XDG_DATA_HOME/db-registry/master.key.json` and restart — a new key will be generated and saved to Keychain.

### `FTS5 not available in this SQLite build`

The bundled SQLite lacks the FTS5 extension. This should not happen with Bun (which ships with FTS5 enabled). If it does, upgrade Bun.

### `unable to open database file`

The data directory does not exist. Ensure `$XDG_DATA_HOME/db-registry/` is writable, or unset `XDG_DATA_HOME` to fall back to `~/.local/share/db-registry/`.

### Port-registry MCP not found

If `DB_REGISTRY_PORT_MCP_NAME` is set to a server name that doesn't exist, discovery falls back gracefully to env/compose/defaults. Check with `db_engines` to see what was discovered.

---

## Environment variable reference

| Variable                       | Default         | Description                                      |
|--------------------------------|-----------------|--------------------------------------------------|
| `DB_REGISTRY_ALLOW_WRITE`      | (unset)         | Set to `1` to enable write operations            |
| `DB_REGISTRY_PORT_MCP_NAME`    | `port-registry` | Name of the port-registry MCP server to query    |
| `XDG_DATA_HOME`                | `~/.local/share`| Override data directory base path                |

---

## Author

[jcsoftdev](https://github.com/jcsoftdev/mcp-db-registry)
