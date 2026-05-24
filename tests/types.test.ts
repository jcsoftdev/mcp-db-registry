import { describe, it, expect } from "bun:test";
import type {
  Engine,
  QueryResult,
  ResolvedConfig,
  ConfigSource,
  Row,
  EngineDriver,
  Connection,
  WriteGuard,
  KeyringProvider,
  Credential,
  Snippet,
} from "../src/types.ts";
import { dbQueryInputSchema, snippetSaveInputSchema } from "../src/types.ts";

describe("Engine union exhaustiveness", () => {
  it("accepts all five valid engine values", () => {
    const engines: Engine[] = ["postgres", "mysql", "mongo", "redis", "sqlite"];
    expect(engines).toHaveLength(5);
    expect(engines).toContain("postgres");
    expect(engines).toContain("mysql");
    expect(engines).toContain("mongo");
    expect(engines).toContain("redis");
    expect(engines).toContain("sqlite");
  });

  it("dbQueryInputSchema has all five engines in enum", () => {
    const enumValues = dbQueryInputSchema.properties.engine.enum;
    expect(enumValues).toHaveLength(5);
    expect(enumValues).toContain("postgres");
    expect(enumValues).toContain("mysql");
    expect(enumValues).toContain("mongo");
    expect(enumValues).toContain("redis");
    expect(enumValues).toContain("sqlite");
  });

  it("dbQueryInputSchema requires engine and body", () => {
    expect(dbQueryInputSchema.required).toContain("engine");
    expect(dbQueryInputSchema.required).toContain("body");
  });

  it("snippetSaveInputSchema requires engine, name, and body", () => {
    expect(snippetSaveInputSchema.required).toContain("engine");
    expect(snippetSaveInputSchema.required).toContain("name");
    expect(snippetSaveInputSchema.required).toContain("body");
  });
});

describe("QueryResult discriminated union", () => {
  it("rows variant carries rows array, truncated flag, and rowCount", () => {
    const result: QueryResult = {
      kind: "rows",
      rows: [{ id: 1, name: "Alice" }],
      truncated: false,
      rowCount: 1,
    };
    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows).toHaveLength(1);
      expect(result.truncated).toBe(false);
      expect(result.rowCount).toBe(1);
    }
  });

  it("docs variant carries docs array and truncated flag", () => {
    const result: QueryResult = {
      kind: "docs",
      docs: [{ _id: "abc", name: "test" }],
      truncated: true,
    };
    expect(result.kind).toBe("docs");
    if (result.kind === "docs") {
      expect(result.docs).toHaveLength(1);
      expect(result.truncated).toBe(true);
    }
  });

  it("reply variant carries reply value", () => {
    const result: QueryResult = { kind: "reply", reply: "PONG" };
    expect(result.kind).toBe("reply");
    if (result.kind === "reply") {
      expect(result.reply).toBe("PONG");
    }
  });

  it("void variant carries no data fields", () => {
    const result: QueryResult = { kind: "void" };
    expect(result.kind).toBe("void");
  });
});
