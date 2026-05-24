import { describe, it, expect, mock } from "bun:test";
import { PortRegistryClient } from "../../src/discovery/port-registry.js";

// We inject a spawn stub rather than calling the real subprocess.
// The client accepts an optional `spawnFn` for DI.

const makeSpawn = (stdout: string, exitCode = 0) =>
  (_cmd: string, _args: string[]) => ({ stdout, status: exitCode });

describe("PortRegistryClient — port_get", () => {
  it("sends a JSON-RPC tools/call for port_get with the engine as technology", async () => {
    // The spawn stub captures what was sent, returns a valid JSON-RPC result
    let capturedInput = "";
    const spawnStub = (_cmd: string, _args: string[], opts: { input: string }) => {
      capturedInput = opts.input;
      const result = {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: JSON.stringify({ port: 5433 }) }],
        },
      };
      return { stdout: JSON.stringify(result), status: 0 };
    };

    const client = new PortRegistryClient({ spawnFn: spawnStub as never });
    await client.get("postgres");

    const parsed = JSON.parse(capturedInput);
    expect(parsed.method).toBe("tools/call");
    expect(parsed.params.name).toBe("port_get");
    expect(parsed.params.arguments.technology).toBe("postgres");
  });

  it("returns { host, port } when MCP responds with a port number", async () => {
    const result = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify({ port: 3307 }) }] },
    };
    const spawnStub = () => ({ stdout: JSON.stringify(result), status: 0 });

    const client = new PortRegistryClient({ spawnFn: spawnStub as never });
    const cfg = await client.get("mysql");

    expect(cfg?.port).toBe(3307);
    expect(cfg?.host).toBe("localhost");
  });

  it("returns null when spawn exits non-zero (MCP unavailable)", async () => {
    const spawnStub = () => ({ stdout: "", status: 1 });
    const client = new PortRegistryClient({ spawnFn: spawnStub as never });
    const cfg = await client.get("redis");
    expect(cfg).toBeNull();
  });

  it("returns null when stdout is not valid JSON", async () => {
    const spawnStub = () => ({ stdout: "not json", status: 0 });
    const client = new PortRegistryClient({ spawnFn: spawnStub as never });
    const cfg = await client.get("mongo");
    expect(cfg).toBeNull();
  });

  it("returns null when result content has no port field", async () => {
    const result = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify({ name: "redis" }) }] },
    };
    const spawnStub = () => ({ stdout: JSON.stringify(result), status: 0 });
    const client = new PortRegistryClient({ spawnFn: spawnStub as never });
    const cfg = await client.get("redis");
    expect(cfg).toBeNull();
  });

  it("uses DB_REGISTRY_PORT_MCP_NAME env var as the MCP name", async () => {
    let capturedCmd = "";
    const spawnStub = (cmd: string) => {
      capturedCmd = cmd;
      return { stdout: "", status: 1 };
    };
    const orig = process.env["DB_REGISTRY_PORT_MCP_NAME"];
    process.env["DB_REGISTRY_PORT_MCP_NAME"] = "my-ports";
    const client = new PortRegistryClient({ spawnFn: spawnStub as never });
    await client.get("postgres");
    process.env["DB_REGISTRY_PORT_MCP_NAME"] = orig;
    // The cmd should reflect the custom name
    expect(capturedCmd).toContain("my-ports");
  });
});
