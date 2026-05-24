import { describe, it, expect, beforeEach } from "bun:test";
import { resolveConnection, clearDiscoveryCache } from "../../src/discovery/resolve.js";
import type { Engine } from "../../src/types.js";

// ── Stub interfaces ───────────────────────────────────────────────────────────

interface StubStore {
  get(opts: { project: string; engine: Engine; connectionName: string }): Promise<string | null>;
}

interface StubPortRegistry {
  get(engine: Engine): Promise<{ host: string; port: number } | null>;
}

const nullStore: StubStore = {
  get: async () => null,
};

const nullPortRegistry: StubPortRegistry = {
  get: async () => null,
};

// ── Precedence: env wins over compose ─────────────────────────────────────────

describe("resolveConnection — precedence", () => {
  beforeEach(() => clearDiscoveryCache());

  it("returns stored credential first when present", async () => {
    const store: StubStore = {
      get: async () => "postgres://stored:pw@db:5432/app",
    };
    const cfg = await resolveConnection({
      engine: "postgres",
      connectionName: "main",
      cwd: "/tmp/no-such-project",
      store,
      portRegistry: nullPortRegistry,
    });
    expect(cfg.source?.host).toBe("stored");
  });

  it("falls to env when no stored credential", async () => {
    const envContent = "POSTGRES_URL=postgres://envuser:pw@envhost:5432/envdb\n";
    const cfg = await resolveConnection({
      engine: "postgres",
      connectionName: "main",
      cwd: "/tmp/no-such-project",
      store: nullStore,
      portRegistry: nullPortRegistry,
      envContent,
    });
    expect(cfg.source?.host).toBe("env");
    expect(cfg.url).toBe("postgres://envuser:pw@envhost:5432/envdb");
  });

  it("falls to compose when no env config", async () => {
    const composeContent = `
services:
  db:
    image: postgres:16
    ports:
      - "5433:5432"
`;
    const cfg = await resolveConnection({
      engine: "postgres",
      connectionName: "main",
      cwd: "/tmp/no-such-project",
      store: nullStore,
      portRegistry: nullPortRegistry,
      composeContent,
    });
    expect(cfg.source?.host).toBe("compose");
    expect(cfg.port).toBe(5433);
  });

  it("falls to port-registry when env and compose miss", async () => {
    const portRegistry: StubPortRegistry = {
      get: async (engine) => engine === "redis" ? { host: "localhost", port: 6380 } : null,
    };
    const cfg = await resolveConnection({
      engine: "redis",
      connectionName: "main",
      cwd: "/tmp/no-such-project",
      store: nullStore,
      portRegistry,
    });
    expect(cfg.source?.host).toBe("port-mcp");
    expect(cfg.port).toBe(6380);
  });

  it("falls to defaults when all sources miss", async () => {
    const cfg = await resolveConnection({
      engine: "mysql",
      connectionName: "main",
      cwd: "/tmp/no-such-project",
      store: nullStore,
      portRegistry: nullPortRegistry,
    });
    expect(cfg.source?.host).toBe("default");
    expect(cfg.host).toBe("localhost");
    expect(cfg.port).toBe(3306);
  });
});

// ── Cache: second call skips re-read ─────────────────────────────────────────

describe("resolveConnection — cache", () => {
  beforeEach(() => clearDiscoveryCache());

  it("caches the resolved config and returns same value on second call", async () => {
    let callCount = 0;
    const portRegistry: StubPortRegistry = {
      get: async () => { callCount++; return { host: "localhost", port: 6380 }; },
    };

    const opts = {
      engine: "redis" as Engine,
      connectionName: "main",
      cwd: "/cache-test",
      store: nullStore,
      portRegistry,
    };

    const first = await resolveConnection(opts);
    const second = await resolveConnection(opts);

    expect(first.port).toBe(second.port);
    // Port registry called only once — cache hit on second
    expect(callCount).toBe(1);
  });
});

// ── source field populated ───────────────────────────────────────────────────

describe("resolveConnection — source field", () => {
  beforeEach(() => clearDiscoveryCache());

  it("sets source.host = 'default' for defaults fallback", async () => {
    const cfg = await resolveConnection({
      engine: "mongo",
      connectionName: "main",
      cwd: "/tmp/no-such-project",
      store: nullStore,
      portRegistry: nullPortRegistry,
    });
    expect(cfg.source?.host).toBe("default");
  });

  it("sets source.host = 'env' when env provides config", async () => {
    const cfg = await resolveConnection({
      engine: "redis",
      connectionName: "main",
      cwd: "/tmp/no-such-project",
      store: nullStore,
      portRegistry: nullPortRegistry,
      envContent: "REDIS_HOST=myhost\nREDIS_PORT=6381\n",
    });
    expect(cfg.source?.host).toBe("env");
    expect(cfg.host).toBe("myhost");
    expect(cfg.port).toBe(6381);
  });
});
