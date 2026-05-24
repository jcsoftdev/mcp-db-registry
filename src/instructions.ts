export const INSTRUCTIONS =
  "db-registry: multi-engine DB tools (postgres, mysql, mongo, redis, sqlite). " +
  "Supports auto-discovery of connections from .env, docker-compose, and port-registry. " +
  "Call db_connection_info(engine) BEFORE any query if config unclear. " +
  "Use db_snippet_run(name) for repeated queries — saves tokens. " +
  "Read-only by default; writes need DB_REGISTRY_ALLOW_WRITE=1. " +
  "db_engines lists what's available in current project.";
