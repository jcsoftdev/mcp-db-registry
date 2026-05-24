import { describe, it, expect } from "bun:test";
import { projectId } from "../../src/util/project.ts";
import path from "node:path";

describe("projectId", () => {
  it("returns cwd basename when no git remote is available", () => {
    const result = projectId({ cwd: "/home/user/my-project", gitRemote: null });
    expect(result).toBe("my-project");
  });

  it("returns normalized git remote URL when available", () => {
    const result = projectId({
      cwd: "/home/user/my-project",
      gitRemote: "git@github.com:jcsoftdev/db-registry.git",
    });
    expect(result).toBe("git@github.com:jcsoftdev/db-registry.git");
  });

  it("returns cwd basename for a different project without remote (triangulate)", () => {
    const result = projectId({ cwd: "/workspace/another-app", gitRemote: null });
    expect(result).toBe("another-app");
  });
});
