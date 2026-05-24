import { describe, it, expect } from "bun:test";
import { maskDsn, maskPassword } from "../../src/util/mask.ts";

describe("maskDsn", () => {
  it("replaces password in postgres DSN with ***", () => {
    const result = maskDsn("postgres://user:supersecret@host:5432/db");
    expect(result).toBe("postgres://user:***@host:5432/db");
    expect(result).not.toContain("supersecret");
  });

  it("replaces password in mysql DSN", () => {
    const result = maskDsn("mysql://admin:mypass123@localhost:3306/shop");
    expect(result).toBe("mysql://admin:***@localhost:3306/shop");
    expect(result).not.toContain("mypass123");
  });

  it("leaves DSN without credentials unchanged", () => {
    const result = maskDsn("postgres://localhost:5432/db");
    expect(result).toBe("postgres://localhost:5432/db");
  });

  it("handles mongodb+srv scheme", () => {
    const result = maskDsn("mongodb+srv://user:atlas-pass@cluster.mongodb.net/db");
    expect(result).toBe("mongodb+srv://user:***@cluster.mongodb.net/db");
    expect(result).not.toContain("atlas-pass");
  });
});

describe("maskPassword", () => {
  it("replaces the password value in a plain string with ***", () => {
    const result = maskPassword("password=supersecret and host=localhost");
    expect(result).not.toContain("supersecret");
    expect(result).toContain("***");
  });

  it("returns strings with no password keywords unchanged", () => {
    const result = maskPassword("host=localhost port=5432 dbname=mydb");
    expect(result).toBe("host=localhost port=5432 dbname=mydb");
  });
});
