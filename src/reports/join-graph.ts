import type { ForeignKey } from "../types";

export type JoinGraph = Map<string, ForeignKey[]>;

export function buildGraph(fks: ForeignKey[]): JoinGraph {
  const graph: JoinGraph = new Map();

  const add = (table: string, fk: ForeignKey) => {
    const existing = graph.get(table);
    if (existing) {
      existing.push(fk);
    } else {
      graph.set(table, [fk]);
    }
  };

  for (const fk of fks) {
    add(fk.from_table, fk);
    add(fk.to_table, fk);
  }

  return graph;
}

export interface JoinPathResult {
  path: ForeignKey[];
  disconnected: string[];
}

export function findJoinPath(tables: string[], graph: JoinGraph): JoinPathResult {
  if (tables.length === 0) return { path: [], disconnected: [] };

  const target = new Set(tables);
  const visited = new Set<string>();
  const path: ForeignKey[] = [];

  // BFS from tables[0], greedily extending the connected component
  const queue: string[] = [tables[0]];
  visited.add(tables[0]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = graph.get(current) ?? [];

    for (const fk of edges) {
      const neighbour = fk.from_table === current ? fk.to_table : fk.from_table;
      if (!visited.has(neighbour) && target.has(neighbour)) {
        visited.add(neighbour);
        path.push(fk);
        queue.push(neighbour);
      }
    }
  }

  const disconnected = tables.filter((t) => !visited.has(t));
  return { path, disconnected };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface AssembleSqlOpts {
  tables: string[];
  joinPath: ForeignKey[];
  limit?: number;
  intent?: string;
}

export function assembleSql({ tables, joinPath, limit = 100, intent }: AssembleSqlOpts): string {
  const [primary] = tables;

  if (!primary) return `SELECT * LIMIT ${limit}`;

  const selectCols = tables.map((t) => `${quoteIdent(t)}.*`).join(", ");
  let sql = `SELECT ${selectCols} FROM ${quoteIdent(primary)}`;

  for (const fk of joinPath) {
    sql += ` JOIN ${quoteIdent(fk.to_table)} ON ${quoteIdent(fk.from_table)}.${quoteIdent(fk.from_col)} = ${quoteIdent(fk.to_table)}.${quoteIdent(fk.to_col)}`;
  }

  if (intent !== undefined) {
    sql += `\n-- intent: ${intent}`;
  }

  sql += `\nLIMIT ${limit}`;

  return sql;
}
