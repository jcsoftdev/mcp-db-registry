import { describe, it, expect, mock } from "bun:test";
import { getForeignKeysSafe } from "../../src/reports/fk-extractor";
import type { EngineDriver, Connection, ForeignKey } from "../../src/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDriver(fks: ForeignKey[] | Error): Partial<EngineDriver> {
  return {
    getForeignKeys: fks instanceof Error
      ? async () => { throw fks; }
      : async () => fks,
  };
}

const fakeConn = { engine: "sqlite", native: null } as Connection<"sqlite">;

// ─── tests ───────────────────────────────────────────────────────────────────

describe("getForeignKeysSafe", () => {
  it("wraps real call and returns FKs filtered to input tables", async () => {
    const fks: ForeignKey[] = [
      { from_table: "orders", from_col: "user_id", to_table: "users", to_col: "id" },
      { from_table: "orders", from_col: "product_id", to_table: "products", to_col: "id" },
    ];
    const driver = makeDriver(fks);
    const tables = ["orders", "users"];
    const result = await getForeignKeysSafe(driver as EngineDriver, fakeConn, tables);
    // products is not in input set — FK with to_table=products must be trimmed
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ from_table: "orders", to_table: "users" });
  });

  it("returns all FKs when all referenced tables are in input set", async () => {
    const fks: ForeignKey[] = [
      { from_table: "a", from_col: "b_id", to_table: "b", to_col: "id" },
    ];
    const driver = makeDriver(fks);
    const result = await getForeignKeysSafe(driver as EngineDriver, fakeConn, ["a", "b"]);
    expect(result).toHaveLength(1);
  });

  it("returns [] when driver throws", async () => {
    const driver = makeDriver(new Error("connection refused"));
    const result = await getForeignKeysSafe(driver as EngineDriver, fakeConn, ["orders"]);
    expect(result).toEqual([]);
  });

  it("filters out FK where to_table is not in input set", async () => {
    const fks: ForeignKey[] = [
      { from_table: "line_items", from_col: "order_id", to_table: "orders", to_col: "id" },
      { from_table: "line_items", from_col: "product_id", to_table: "products", to_col: "id" },
    ];
    const driver = makeDriver(fks);
    // products not in input — should be filtered
    const result = await getForeignKeysSafe(driver as EngineDriver, fakeConn, ["line_items", "orders"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.to_table).toBe("orders");
  });

  it("filters out FK where from_table is not in input set", async () => {
    const fks: ForeignKey[] = [
      { from_table: "external", from_col: "id", to_table: "orders", to_col: "id" },
    ];
    const driver = makeDriver(fks);
    const result = await getForeignKeysSafe(driver as EngineDriver, fakeConn, ["orders"]);
    // external is not in input → trimmed
    expect(result).toEqual([]);
  });

  it("returns [] for empty tables input", async () => {
    const fks: ForeignKey[] = [
      { from_table: "orders", from_col: "user_id", to_table: "users", to_col: "id" },
    ];
    const driver = makeDriver(fks);
    const result = await getForeignKeysSafe(driver as EngineDriver, fakeConn, []);
    expect(result).toEqual([]);
  });
});
