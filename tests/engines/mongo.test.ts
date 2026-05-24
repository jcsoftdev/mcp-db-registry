import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock the mongodb package before importing the driver.
// MongoClient has connect(), db(), close() methods.
// db() returns a db object with collection(), listCollections(), command() methods.

const mockFind = mock(() => ({
  toArray: mock(() => Promise.resolve([{ _id: "abc", name: "Alice" }])),
}));
const mockAggregate = mock(() => ({
  toArray: mock(() => Promise.resolve([{ _id: "x", total: 5 }])),
}));
const mockFindOne = mock(() => Promise.resolve({ _id: "abc", name: "Alice" }));
const mockInsertOne = mock(() => Promise.resolve({ insertedId: "new-id", acknowledged: true }));
const mockInsertMany = mock(() => Promise.resolve({ insertedCount: 2, acknowledged: true }));
const mockUpdateOne = mock(() => Promise.resolve({ matchedCount: 1, modifiedCount: 1 }));
const mockDeleteOne = mock(() => Promise.resolve({ deletedCount: 1 }));

const mockCollection = {
  find: mockFind,
  aggregate: mockAggregate,
  findOne: mockFindOne,
  insertOne: mockInsertOne,
  insertMany: mockInsertMany,
  updateOne: mockUpdateOne,
  deleteOne: mockDeleteOne,
};

const mockListCollections = mock(() => ({
  toArray: mock(() => Promise.resolve([{ name: "users" }, { name: "orders" }])),
}));

const mockCommand = mock(() => Promise.resolve({ ok: 1 }));
const mockIndexInformation = mock(() => Promise.resolve({ _id_: [["_id", 1]] }));

const mockDb = {
  collection: mock(() => mockCollection),
  listCollections: mockListCollections,
  command: mockCommand,
  indexInformation: mockIndexInformation,
};

const mockClose = mock(() => Promise.resolve());
const mockConnect = mock(() => Promise.resolve());
const mockDbFn = mock(() => mockDb);

const MockMongoClient = mock((_uri: string) => ({
  connect: mockConnect,
  db: mockDbFn,
  close: mockClose,
}));

mock.module("mongodb", () => ({ MongoClient: MockMongoClient }));

const { MongoDriver } = await import("../../src/engines/mongo.js");

const cfg = {
  engine: "mongo" as const,
  host: "localhost",
  port: 27017,
  user: "user",
  password: "secret",
  database: "testdb",
  source: {},
};

describe("MongoDriver — connect", () => {
  beforeEach(() => {
    MockMongoClient.mockReset();
    const clientInstance = { connect: mockConnect, db: mockDbFn, close: mockClose };
    MockMongoClient.mockImplementation(() => clientInstance);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
  });

  it("creates a MongoClient and calls connect(), returns a Connection", async () => {
    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);

    expect(MockMongoClient.mock.calls.length).toBe(1);
    const uri = MockMongoClient.mock.calls[0][0] as string;
    expect(uri).toContain("localhost");
    expect(uri).toContain("27017");
    expect(conn.engine).toBe("mongo");
    expect(mockConnect.mock.calls.length).toBe(1);
  });

  it("uses cfg.url directly when provided", async () => {
    const driver = new MongoDriver();
    await driver.connect({ ...cfg, url: "mongodb+srv://user:pass@cluster.net/mydb" });

    const uri = MockMongoClient.mock.calls[0][0] as string;
    expect(uri).toBe("mongodb+srv://user:pass@cluster.net/mydb");
  });
});

describe("MongoDriver — query (find)", () => {
  beforeEach(() => {
    mockFind.mockReset();
    mockFind.mockReturnValue({ toArray: mock(() => Promise.resolve([{ _id: "1", name: "Alice" }])) });
    MockMongoClient.mockReset();
    const clientInstance = { connect: mockConnect, db: mockDbFn, close: mockClose };
    MockMongoClient.mockImplementation(() => clientInstance);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
  });

  it("dispatches find op and returns docs result", async () => {
    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const body = JSON.stringify({ collection: "users", op: "find", body: { name: "Alice" } });
    const result = await driver.query(conn, body);

    expect(result.kind).toBe("docs");
    if (result.kind === "docs") {
      expect(result.docs[0]).toMatchObject({ name: "Alice" });
      expect(result.truncated).toBe(false);
    }
  });

  it("dispatches insertOne and returns rows result with insertedId", async () => {
    mockInsertOne.mockReset();
    mockInsertOne.mockResolvedValue({ insertedId: "new-id", acknowledged: true });

    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const body = JSON.stringify({ collection: "users", op: "insertOne", body: { name: "Bob" } });
    const result = await driver.query(conn, body);

    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect((result.rows[0] as Record<string, unknown>)["insertedId"]).toBe("new-id");
      expect(result.rowCount).toBe(1);
    }
  });

  it("truncates docs at 500 and sets truncated=true", async () => {
    const manyDocs = Array.from({ length: 600 }, (_, i) => ({ _id: i }));
    mockFind.mockReturnValue({ toArray: mock(() => Promise.resolve(manyDocs)) });

    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const body = JSON.stringify({ collection: "logs", op: "find", body: {} });
    const result = await driver.query(conn, body);

    expect(result.kind).toBe("docs");
    if (result.kind === "docs") {
      expect(result.docs.length).toBe(500);
      expect(result.truncated).toBe(true);
    }
  });

  it("dispatches aggregate and returns docs result", async () => {
    mockAggregate.mockReset();
    mockAggregate.mockReturnValue({ toArray: mock(() => Promise.resolve([{ _id: "x", total: 10 }])) });

    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const body = JSON.stringify({ collection: "orders", op: "aggregate", body: [{ $group: { _id: "$status" } }] });
    const result = await driver.query(conn, body);

    expect(result.kind).toBe("docs");
    if (result.kind === "docs") {
      expect(result.docs[0]).toMatchObject({ total: 10 });
    }
  });
});

describe("MongoDriver — list", () => {
  beforeEach(() => {
    mockListCollections.mockReset();
    mockListCollections.mockReturnValue({ toArray: mock(() => Promise.resolve([{ name: "users" }, { name: "orders" }])) });
    MockMongoClient.mockReset();
    const clientInstance = { connect: mockConnect, db: mockDbFn, close: mockClose };
    MockMongoClient.mockImplementation(() => clientInstance);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
  });

  it("returns collection names", async () => {
    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const names = await driver.list(conn, "collections");

    expect(names).toEqual(["users", "orders"]);
  });
});

describe("MongoDriver — describe", () => {
  beforeEach(() => {
    mockFind.mockReset();
    mockFind.mockReturnValue({
      toArray: mock(() => Promise.resolve([{ _id: "abc", name: "Alice", age: 30 }])),
    });
    mockIndexInformation.mockReset();
    mockIndexInformation.mockResolvedValue({ _id_: [["_id", 1]], name_1: [["name", 1]] });
    MockMongoClient.mockReset();
    const clientInstance = { connect: mockConnect, db: mockDbFn, close: mockClose };
    MockMongoClient.mockImplementation(() => clientInstance);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
  });

  it("returns sample doc fields and index info as Row[]", async () => {
    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const rows = await driver.describe(conn, "users");

    expect(rows.length).toBeGreaterThan(0);
    const hasIndex = rows.some((r) => (r as Record<string, unknown>)["index"]);
    expect(hasIndex).toBe(true);
  });
});

describe("MongoDriver — explain", () => {
  beforeEach(() => {
    MockMongoClient.mockReset();
    const clientInstance = { connect: mockConnect, db: mockDbFn, close: mockClose };
    MockMongoClient.mockImplementation(() => clientInstance);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
  });

  it("returns explain plan as a docs result", async () => {
    const mockFindExplain = {
      find: mock(() => ({
        explain: mock(() => Promise.resolve({ queryPlanner: { winningPlan: { stage: "COLLSCAN" } } })),
      })),
      aggregate: mock(() => ({ explain: mock(() => Promise.resolve({ stages: [] })) })),
    };
    mockDb.collection.mockReturnValue(mockFindExplain as any);

    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const body = JSON.stringify({ collection: "users", op: "find", body: {} });
    const result = await driver.explain(conn, body);

    expect(result.kind).toBe("docs");
    mockDb.collection.mockReturnValue(mockCollection);
  });
});

describe("MongoDriver — ping", () => {
  beforeEach(() => {
    mockCommand.mockReset();
    MockMongoClient.mockReset();
    const clientInstance = { connect: mockConnect, db: mockDbFn, close: mockClose };
    MockMongoClient.mockImplementation(() => clientInstance);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
  });

  it("runs db.command({ ping: 1 }) and returns true", async () => {
    mockCommand.mockResolvedValue({ ok: 1 });

    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(true);
    expect(mockCommand.mock.calls[0][0]).toEqual({ ping: 1 });
  });

  it("returns false when command throws", async () => {
    mockCommand.mockRejectedValue(new Error("connection refused"));

    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    const alive = await driver.ping(conn);

    expect(alive).toBe(false);
  });
});

describe("MongoDriver — close", () => {
  it("calls client.close()", async () => {
    mockClose.mockReset();
    mockClose.mockResolvedValue(undefined);
    MockMongoClient.mockReset();
    const clientInstance = { connect: mockConnect, db: mockDbFn, close: mockClose };
    MockMongoClient.mockImplementation(() => clientInstance);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);

    const driver = new MongoDriver();
    const conn = await driver.connect(cfg);
    await driver.close(conn);

    expect(mockClose.mock.calls.length).toBe(1);
  });
});
