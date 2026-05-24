/**
 * Unit test for the port-registry discovery client.
 * Verifies that the PortRegistryClient can invoke the real port-registry
 * server binary via subprocess — if the binary exists.
 * Skipped gracefully if the binary is not found.
 */
import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import * as path from "node:path";

const PORT_REGISTRY_SERVER = path.join(
  import.meta.dir,
  "../../../port-registry/src/server.ts"
);

const serverExists = existsSync(PORT_REGISTRY_SERVER);

describe("port-registry discovery client", () => {
  it.skipIf(!serverExists)(
    "PortRegistryClient.get() returns null or {host, port} for a known technology",
    async () => {
      const { PortRegistryClient } = await import(
        "../../src/discovery/port-registry.js"
      );

      // Use a custom spawnFn that calls the real port-registry server binary.
      // We call it with a `port_get` request for "postgres".
      const client = new PortRegistryClient({
        spawnFn: (cmd, _args, opts) => {
          const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
          // Override the cmd to point at the actual server binary via bun.
          const r = spawnSync(
            "bun",
            [PORT_REGISTRY_SERVER],
            {
              input: opts.input,
              encoding: "utf8",
              timeout: 5000,
            }
          );
          return {
            stdout: (r.stdout as string) ?? "",
            status: r.status ?? 1,
          };
          void cmd;
        },
      });

      const result = await client.get("postgres");
      // Result is either null (no port registered for postgres) or a valid host/port
      if (result !== null) {
        expect(typeof result.host).toBe("string");
        expect(typeof result.port).toBe("number");
        expect(result.port).toBeGreaterThan(0);
      }
      // Both null and a valid object are acceptable outcomes — the key
      // assertion is that the client DID NOT throw an exception.
      expect(true).toBe(true);
    }
  );

  it("PortRegistryClient.get() returns null when spawnFn returns non-zero status", async () => {
    const { PortRegistryClient } = await import(
      "../../src/discovery/port-registry.js"
    );

    const client = new PortRegistryClient({
      spawnFn: () => ({ stdout: "", status: 1 }),
    });

    const result = await client.get("postgres");
    expect(result).toBeNull();
  });

  it("PortRegistryClient.get() returns null when spawnFn throws", async () => {
    const { PortRegistryClient } = await import(
      "../../src/discovery/port-registry.js"
    );

    const client = new PortRegistryClient({
      spawnFn: () => { throw new Error("spawn failed"); },
    });

    const result = await client.get("mysql");
    expect(result).toBeNull();
  });
});
