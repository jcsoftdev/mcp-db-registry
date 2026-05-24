import { describe, it, expect } from "bun:test";
import { toolError } from "../../src/util/errors.ts";

describe("toolError", () => {
  it("returns isError true with the given message", () => {
    const result = toolError("Something went wrong");
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("Something went wrong");
  });

  it("returns isError true for a different message (triangulate)", () => {
    const result = toolError("Connection refused: postgres @ localhost:5432");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Connection refused: postgres @ localhost:5432");
  });

  it("returns empty message as-is", () => {
    const result = toolError("");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("");
  });
});
