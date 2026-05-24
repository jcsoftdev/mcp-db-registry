export const ALL_TOOLS = [
  {
    name: "db_query",
    description: "Execute a query or command against a database engine.",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "body"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        body: { type: "string", description: "SQL, JSON mongo op, or redis command." },
        connection: { type: "string", description: "Saved connection name (default: main)." },
        params: { type: "array", items: {}, description: "Parameter bindings." },
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
      },
    },
  },
  {
    name: "db_list",
    description: "List tables, collections, or keys for a database engine.",
    inputSchema: {
      type: "object" as const,
      required: ["engine"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        kind: { type: "string", description: "tables | collections | keys | indexes" },
      },
    },
  },
  {
    name: "db_describe",
    description: "Describe the schema of a table, collection, or key.",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "target"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        target: { type: "string", description: "Table/collection/key name." },
      },
    },
  },
  {
    name: "db_explain",
    description: "Get the query execution plan for a SQL or mongo query.",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "body"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        body: { type: "string" },
      },
    },
  },
  {
    name: "db_connection_info",
    description: "Return resolved connection config for an engine. Password is never included.",
    inputSchema: {
      type: "object" as const,
      required: ["engine"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        connection: { type: "string", description: "Connection name (default: main)." },
      },
    },
  },
  {
    name: "db_engines",
    description: "List all supported engines with availability and discovery source.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "db_snippet_save",
    description: "Save a reusable query snippet (encrypted body).",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "name", "body"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        name: { type: "string" },
        body: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        category: { type: "string", maxLength: 80, description: "Optional grouping label (free-text). Indexed in FTS5." },
        paramsSchema: { type: "object" },
      },
    },
  },
  {
    name: "db_snippet_run",
    description: "Run a saved snippet by name. Increments usage counter.",
    inputSchema: {
      type: "object" as const,
      required: ["name"],
      properties: {
        name: { type: "string" },
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        params: { type: "array", items: {} },
      },
    },
  },
  {
    name: "db_snippet_get",
    description: "Retrieve a snippet with its decrypted body and metadata.",
    inputSchema: {
      type: "object" as const,
      required: ["name"],
      properties: {
        name: { type: "string" },
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
      },
    },
  },
  {
    name: "db_snippet_search",
    description: "Full-text search snippets by name, description, or tags.",
    inputSchema: {
      type: "object" as const,
      required: ["query"],
      properties: {
        query: { type: "string" },
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "db_snippet_list",
    description: "List snippets (no bodies). Optionally filter by engine or category.",
    inputSchema: {
      type: "object" as const,
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        sort: { type: "string" },
        category: { type: "string", description: "Filter list to snippets with this category (exact match)." },
      },
    },
  },
  {
    name: "db_snippet_delete",
    description: "Delete a saved snippet.",
    inputSchema: {
      type: "object" as const,
      required: ["name"],
      properties: {
        name: { type: "string" },
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
      },
    },
  },
  {
    name: "db_credentials_save",
    description: "Save an encrypted connection credential for an engine.",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "dsn"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        dsn: { type: "string", description: "DSN or connection URL." },
        name: { type: "string", description: "Connection name (default: main)." },
      },
    },
  },
  {
    name: "db_credentials_clear",
    description: "Remove a saved credential for an engine.",
    inputSchema: {
      type: "object" as const,
      required: ["engine"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        name: { type: "string", description: "Connection name (default: main)." },
      },
    },
  },
  {
    name: "db_describe_many",
    description: "Describe many tables in one call. Returns schemas in input order; absent tables go to errors[].",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "tables"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        tables: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
        connection: { type: "string", description: "Connection name (default: main)." },
      },
    },
  },
  {
    name: "db_suggest_query",
    description: "Build a FK-aware SQL skeleton joining requested tables. Does NOT execute. Warnings flag disconnected tables (no silent cartesian).",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "intent", "tables"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        intent: { type: "string", description: "Human-readable purpose; embedded as comment in generated SQL." },
        tables: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        connection: { type: "string", description: "Connection name (default: main)." },
      },
    },
  },
  {
    name: "db_report_run",
    description: "Run multiple saved snippets and merge results. Per-snippet write-guard enforced. merge: object|union|join.",
    inputSchema: {
      type: "object" as const,
      required: ["engine", "snippet_names"],
      properties: {
        engine: { type: "string", enum: ["postgres", "mysql", "mongo", "redis", "sqlite"] },
        snippet_names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
        merge: { type: "string", enum: ["object", "union", "join"], default: "object" },
        join_on: {
          type: "array",
          items: {
            type: "object",
            required: ["snippet_name", "column"],
            properties: {
              snippet_name: { type: "string" },
              column: { type: "string" },
            },
          },
          description: "Required when merge='join'. One entry per snippet specifying the join key column.",
        },
        connection: { type: "string", description: "Connection name (default: main)." },
        cap: { type: "integer", minimum: 1, maximum: 1000, default: 1000, description: "Merged-row cap." },
      },
    },
  },
];
