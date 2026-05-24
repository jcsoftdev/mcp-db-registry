import { MongoClient } from "mongodb";
import type { Connection, EngineDriver, ForeignKey, QueryResult, ResolvedConfig, Row } from "../types.js";

const DOC_LIMIT = 500;

interface MongoNative {
  client: InstanceType<typeof MongoClient>;
  database: string;
}

interface MongoOpBody {
  collection: string;
  op: string;
  body?: unknown;
}

export class MongoDriver implements EngineDriver<"mongo"> {
  readonly engine = "mongo" as const;

  async connect(cfg: ResolvedConfig): Promise<Connection<"mongo">> {
    let uri: string;
    if (cfg.url) {
      uri = cfg.url;
    } else {
      const auth = cfg.user && cfg.password ? `${cfg.user}:${cfg.password}@` : "";
      uri = `mongodb://${auth}${cfg.host}:${cfg.port}`;
    }
    const client = new MongoClient(uri);
    await client.connect();
    return { engine: "mongo", native: { client, database: cfg.database ?? "admin" } };
  }

  async close(conn: Connection<"mongo">): Promise<void> {
    const { client } = conn.native as MongoNative;
    await client.close();
  }

  async ping(conn: Connection<"mongo">): Promise<boolean> {
    try {
      const { client, database } = conn.native as MongoNative;
      await client.db(database).command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async query(conn: Connection<"mongo">, body: string, _params?: unknown[]): Promise<QueryResult> {
    const { client, database } = conn.native as MongoNative;
    const op = JSON.parse(body) as MongoOpBody;
    const coll = client.db(database).collection(op.collection);

    switch (op.op) {
      case "find": {
        const docs = await coll.find(op.body as Record<string, unknown> ?? {}).toArray() as Row[];
        const truncated = docs.length > DOC_LIMIT;
        return { kind: "docs", docs: truncated ? docs.slice(0, DOC_LIMIT) : docs, truncated };
      }
      case "findOne": {
        const doc = await coll.findOne(op.body as Record<string, unknown> ?? {});
        return { kind: "docs", docs: doc ? [doc as Row] : [], truncated: false };
      }
      case "aggregate": {
        const docs = await coll.aggregate(op.body as unknown[] ?? []).toArray() as Row[];
        const truncated = docs.length > DOC_LIMIT;
        return { kind: "docs", docs: truncated ? docs.slice(0, DOC_LIMIT) : docs, truncated };
      }
      case "insertOne": {
        const r = await coll.insertOne(op.body as Record<string, unknown>);
        return { kind: "rows", rows: [{ insertedId: r.insertedId, acknowledged: r.acknowledged }], truncated: false, rowCount: 1 };
      }
      case "insertMany": {
        const r = await (coll as any).insertMany(op.body as Record<string, unknown>[]);
        return { kind: "rows", rows: [{ insertedCount: r.insertedCount, acknowledged: r.acknowledged }], truncated: false, rowCount: r.insertedCount };
      }
      case "updateOne": {
        const upd = op.body as { filter: Record<string, unknown>; update: Record<string, unknown> };
        const r = await coll.updateOne(upd.filter, upd.update);
        return { kind: "rows", rows: [{ matchedCount: r.matchedCount, modifiedCount: r.modifiedCount }], truncated: false, rowCount: r.modifiedCount };
      }
      case "updateMany": {
        const upd = op.body as { filter: Record<string, unknown>; update: Record<string, unknown> };
        const r = await (coll as any).updateMany(upd.filter, upd.update);
        return { kind: "rows", rows: [{ matchedCount: r.matchedCount, modifiedCount: r.modifiedCount }], truncated: false, rowCount: r.modifiedCount };
      }
      case "deleteOne": {
        const r = await coll.deleteOne(op.body as Record<string, unknown>);
        return { kind: "rows", rows: [{ deletedCount: r.deletedCount }], truncated: false, rowCount: r.deletedCount };
      }
      case "deleteMany": {
        const r = await (coll as any).deleteMany(op.body as Record<string, unknown>);
        return { kind: "rows", rows: [{ deletedCount: r.deletedCount }], truncated: false, rowCount: r.deletedCount };
      }
      default:
        return { kind: "void" };
    }
  }

  async list(conn: Connection<"mongo">, _kind: "tables" | "collections" | "keys" | "indexes"): Promise<string[]> {
    const { client, database } = conn.native as MongoNative;
    const db = client.db(database);
    const colls = await db.listCollections().toArray();
    return colls.map((c: { name: string }) => c.name);
  }

  async describe(conn: Connection<"mongo">, target: string): Promise<Row[]> {
    const { client, database } = conn.native as MongoNative;
    const db = client.db(database);
    const coll = db.collection(target);

    const docs = await coll.find({}).toArray();
    const sample = docs[0] ?? {};
    const fields: Row[] = Object.keys(sample).map((k) => ({ field: k, type: typeof (sample as Record<string, unknown>)[k] }));

    const indexInfo = await db.indexInformation(target);
    const indexes: Row[] = Object.entries(indexInfo).map(([name, keys]) => ({
      index: name,
      keys,
    }));

    return [...fields, ...indexes];
  }

  async getForeignKeys(_conn: Connection<"mongo">, _tables: string[]): Promise<ForeignKey[]> {
    return [];
  }

  async explain(conn: Connection<"mongo">, body: string): Promise<QueryResult> {
    const { client, database } = conn.native as MongoNative;
    const op = JSON.parse(body) as MongoOpBody;
    const coll = client.db(database).collection(op.collection);

    let plan: unknown;
    if (op.op === "aggregate") {
      plan = await coll.aggregate(op.body as unknown[] ?? []).explain();
    } else {
      plan = await coll.find(op.body as Record<string, unknown> ?? {}).explain();
    }
    return { kind: "docs", docs: [plan as Row], truncated: false };
  }
}
