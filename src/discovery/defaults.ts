import type { Engine, ResolvedConfig } from "../types.js";

type DefaultConfig = Pick<ResolvedConfig, "engine" | "host" | "port"> &
  Partial<Pick<ResolvedConfig, "user" | "database">>;

const DEFAULTS: Record<Engine, DefaultConfig> = {
  postgres: { engine: "postgres", host: "localhost", port: 5432, user: "postgres", database: "postgres" },
  mysql:    { engine: "mysql",    host: "localhost", port: 3306, user: "root" },
  mongo:    { engine: "mongo",    host: "localhost", port: 27017 },
  redis:    { engine: "redis",    host: "localhost", port: 6379 },
  sqlite:   { engine: "sqlite",   host: "localhost", port: 0 },
};

export function defaultsFor(engine: Engine): DefaultConfig {
  return DEFAULTS[engine];
}
