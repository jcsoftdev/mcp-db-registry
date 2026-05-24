import type { Connection, Engine, EngineDriver, ForeignKey } from "../types";

export async function getForeignKeysSafe(
  driver: EngineDriver,
  conn: Connection<Engine>,
  tables: string[],
): Promise<ForeignKey[]> {
  if (tables.length === 0) return [];

  let raw: ForeignKey[];
  try {
    raw = await driver.getForeignKeys(conn as Connection<typeof driver.engine>, tables);
  } catch {
    return [];
  }

  const tableSet = new Set(tables);
  return raw.filter(
    (fk) => tableSet.has(fk.from_table) && tableSet.has(fk.to_table),
  );
}
