export const INSTRUCTIONS =
  "db-registry: multi-engine DB tools (postgres, mysql, mongo, redis, sqlite). " +
  "Auto-discovers connections from .env, docker-compose, port-registry. " +
  "db_describe_many for batch schema, db_suggest_query for FK-aware SQL skeletons, " +
  "db_report_run for multi-snippet reports. db_snippet_run for repeated queries. " +
  "db_engines lists available engines. Read-only by default; writes need DB_REGISTRY_ALLOW_WRITE=1.";
