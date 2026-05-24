import { describe, it, expect } from "bun:test";
import { getDataDir } from "../../src/util/paths.ts";
import path from "node:path";
import os from "node:os";

describe("getDataDir", () => {
  it("returns XDG_DATA_HOME/db-registry when XDG_DATA_HOME is set", () => {
    const original = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = "/custom/data";
    try {
      const result = getDataDir();
      expect(result).toBe("/custom/data/db-registry");
    } finally {
      if (original === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = original;
    }
  });

  it("falls back to ~/.local/share/db-registry when XDG_DATA_HOME is unset", () => {
    const original = process.env.XDG_DATA_HOME;
    delete process.env.XDG_DATA_HOME;
    try {
      const result = getDataDir();
      expect(result).toBe(path.join(os.homedir(), ".local", "share", "db-registry"));
    } finally {
      if (original !== undefined) process.env.XDG_DATA_HOME = original;
    }
  });
});
