import { describe, it, expect } from "bun:test";
import { isReadOnlyMongoOp } from "../../src/safety/mongo.js";

describe("isReadOnlyMongoOp — read methods pass", () => {
  it("find is read-only", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { status: "active" } })).toBe(true);
  });

  it("findOne is read-only", () => {
    expect(isReadOnlyMongoOp({ method: "findOne", args: {} })).toBe(true);
  });

  it("aggregate is read-only", () => {
    expect(isReadOnlyMongoOp({ method: "aggregate", args: [{ $match: {} }] })).toBe(true);
  });

  it("countDocuments is read-only", () => {
    expect(isReadOnlyMongoOp({ method: "countDocuments", args: {} })).toBe(true);
  });

  it("distinct is read-only", () => {
    expect(isReadOnlyMongoOp({ method: "distinct", args: {} })).toBe(true);
  });
});

describe("isReadOnlyMongoOp — write methods blocked", () => {
  it("insertOne is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "insertOne", args: { name: "x" } })).toBe(false);
  });

  it("insertMany is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "insertMany", args: [{ name: "x" }] })).toBe(false);
  });

  it("updateOne is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "updateOne", args: {} })).toBe(false);
  });

  it("updateMany is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "updateMany", args: {} })).toBe(false);
  });

  it("deleteOne is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "deleteOne", args: {} })).toBe(false);
  });

  it("deleteMany is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "deleteMany", args: {} })).toBe(false);
  });

  it("replaceOne is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "replaceOne", args: {} })).toBe(false);
  });

  it("drop is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "drop", args: {} })).toBe(false);
  });

  it("createIndex is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "createIndex", args: {} })).toBe(false);
  });

  it("findOneAndUpdate is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "findOneAndUpdate", args: {} })).toBe(false);
  });

  it("findOneAndDelete is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "findOneAndDelete", args: {} })).toBe(false);
  });

  it("bulkWrite is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "bulkWrite", args: {} })).toBe(false);
  });
});

describe("isReadOnlyMongoOp — mutation operators in args blocked", () => {
  it("$set in args is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { $set: { status: "active" } } })).toBe(false);
  });

  it("$unset in args is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { $unset: { field: "" } } })).toBe(false);
  });

  it("$push in args is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { $push: { items: "x" } } })).toBe(false);
  });

  it("$pull in args is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { $pull: { items: "x" } } })).toBe(false);
  });

  it("$inc in args is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { $inc: { count: 1 } } })).toBe(false);
  });

  it("$addToSet in args is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { $addToSet: { tags: "x" } } })).toBe(false);
  });

  it("$rename in args is blocked", () => {
    expect(isReadOnlyMongoOp({ method: "find", args: { $rename: { old: "new" } } })).toBe(false);
  });

  it("nested $set inside object is blocked", () => {
    expect(isReadOnlyMongoOp({
      method: "find",
      args: { filter: { id: 1 }, update: { $set: { name: "new" } } },
    })).toBe(false);
  });

  it("$match (aggregation read op) in args is read-only", () => {
    expect(isReadOnlyMongoOp({
      method: "aggregate",
      args: [{ $match: { status: "active" } }, { $group: { _id: "$type" } }],
    })).toBe(true);
  });
});
