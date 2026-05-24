const MUT_OP_PREFIXES = new Set([
  "$set", "$unset", "$push", "$pull", "$pop", "$addToSet",
  "$inc", "$mul", "$rename", "$currentDate", "$bit", "$min", "$max",
]);

const WRITE_METHODS = new Set([
  "insertOne", "insertMany",
  "updateOne", "updateMany",
  "deleteOne", "deleteMany",
  "replaceOne", "bulkWrite",
  "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace",
  "drop", "dropIndex", "createIndex", "createCollection",
]);

export interface MongoOp {
  method: string;
  args?: unknown;
}

export function isReadOnlyMongoOp(op: MongoOp): boolean {
  if (WRITE_METHODS.has(op.method)) return false;
  return !containsMutationOperator(op.args);
}

function containsMutationOperator(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) {
    // Array pipeline (e.g. aggregation stages) — scan each element
    // but $match/$group/$project etc are read-only aggregation ops.
    // Only true mutation operators ($set, $unset etc.) make it write.
    return v.some(containsMutationOperator);
  }
  for (const k of Object.keys(v as Record<string, unknown>)) {
    if (MUT_OP_PREFIXES.has(k)) return true;
    if (containsMutationOperator((v as Record<string, unknown>)[k])) return true;
  }
  return false;
}
