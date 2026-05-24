import { describe, it, expect } from "bun:test";
import {
  interpolate,
  interpolateNode,
  RequiredVarError,
} from "../../src/discovery/interpolate.js";

describe("interpolate — simple forms", () => {
  it("substitutes $VAR", () => {
    expect(interpolate("hello $NAME", { NAME: "world" })).toBe("hello world");
  });

  it("substitutes ${VAR}", () => {
    expect(interpolate("port=${PORT}", { PORT: "5432" })).toBe("port=5432");
  });

  it("returns empty string when bare $VAR is unset", () => {
    expect(interpolate("[$MISSING]", {})).toBe("[]");
  });

  it("returns empty string when ${VAR} is unset", () => {
    expect(interpolate("[${MISSING}]", {})).toBe("[]");
  });

  it("treats $$ as literal $", () => {
    expect(interpolate("price=$$5", {})).toBe("price=$5");
  });

  it("preserves a lone $ followed by a non-identifier", () => {
    expect(interpolate("$ and $-foo", {})).toBe("$ and $-foo");
  });

  it("leaves a malformed ${ ... missing brace untouched", () => {
    expect(interpolate("oops ${NO_CLOSE", { NO_CLOSE: "x" })).toBe("oops ${NO_CLOSE");
  });
});

describe("interpolate — default operators", () => {
  it(":- uses default when unset", () => {
    expect(interpolate("${VAR:-fallback}", {})).toBe("fallback");
  });

  it(":- uses default when set but empty", () => {
    expect(interpolate("${VAR:-fallback}", { VAR: "" })).toBe("fallback");
  });

  it(":- uses value when set and non-empty", () => {
    expect(interpolate("${VAR:-fallback}", { VAR: "real" })).toBe("real");
  });

  it("- uses default only when unset (preserves empty)", () => {
    expect(interpolate("${VAR-fallback}", {})).toBe("fallback");
    expect(interpolate("${VAR-fallback}", { VAR: "" })).toBe("");
    expect(interpolate("${VAR-fallback}", { VAR: "real" })).toBe("real");
  });
});

describe("interpolate — alternate operators", () => {
  it(":+ uses alternate only when set and non-empty", () => {
    expect(interpolate("${VAR:+alt}", { VAR: "x" })).toBe("alt");
    expect(interpolate("${VAR:+alt}", { VAR: "" })).toBe("");
    expect(interpolate("${VAR:+alt}", {})).toBe("");
  });

  it("+ uses alternate when set (even empty)", () => {
    expect(interpolate("${VAR+alt}", { VAR: "x" })).toBe("alt");
    expect(interpolate("${VAR+alt}", { VAR: "" })).toBe("alt");
    expect(interpolate("${VAR+alt}", {})).toBe("");
  });
});

describe("interpolate — required operators", () => {
  it(":? throws when unset", () => {
    expect(() => interpolate("${VAR:?missing}", {})).toThrow(RequiredVarError);
  });

  it(":? throws when empty", () => {
    expect(() => interpolate("${VAR:?missing}", { VAR: "" })).toThrow(RequiredVarError);
  });

  it(":? returns value when set and non-empty", () => {
    expect(interpolate("${VAR:?missing}", { VAR: "ok" })).toBe("ok");
  });

  it("? throws only when unset", () => {
    expect(() => interpolate("${VAR?missing}", {})).toThrow(RequiredVarError);
    expect(interpolate("${VAR?missing}", { VAR: "" })).toBe("");
    expect(interpolate("${VAR?missing}", { VAR: "ok" })).toBe("ok");
  });

  it("attaches the variable name to RequiredVarError", () => {
    try {
      interpolate("${DB_PASSWORD:?password required}", {});
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RequiredVarError);
      expect((e as RequiredVarError).name).toBe("RequiredVarError");
      expect((e as RequiredVarError).message).toContain("password required");
    }
  });
});

describe("interpolate — nested forms", () => {
  it("evaluates nested defaults", () => {
    expect(interpolate("${A:-${B:-fallback}}", {})).toBe("fallback");
    expect(interpolate("${A:-${B:-fallback}}", { B: "B-val" })).toBe("B-val");
    expect(interpolate("${A:-${B:-fallback}}", { A: "A-val", B: "B-val" })).toBe("A-val");
  });

  it("evaluates nested alternates", () => {
    expect(interpolate("${A:+${B:-z}}", { A: "x", B: "y" })).toBe("y");
    expect(interpolate("${A:+${B:-z}}", { A: "x" })).toBe("z");
  });

  it("interpolates within a larger string", () => {
    const out = interpolate(
      "postgres://${USER:-app}:${PASS:-secret}@${HOST}:${PORT:-5432}/db",
      { USER: "alice", HOST: "db.local" }
    );
    expect(out).toBe("postgres://alice:secret@db.local:5432/db");
  });
});

describe("interpolateNode — recursive walk", () => {
  it("substitutes strings inside nested objects and arrays", () => {
    const node = {
      services: {
        db: {
          image: "postgres:${PG_VERSION:-16}",
          environment: {
            POSTGRES_USER: "${DB_USER:-app}",
            POSTGRES_PASSWORD: "${DB_PASSWORD:-secret}",
          },
          ports: ["${PG_HOST_PORT:-5432}:5432"],
        },
      },
    };
    const out = interpolateNode(node, { DB_USER: "alice" }) as typeof node;
    expect(out.services.db.image).toBe("postgres:16");
    expect(out.services.db.environment.POSTGRES_USER).toBe("alice");
    expect(out.services.db.environment.POSTGRES_PASSWORD).toBe("secret");
    expect(out.services.db.ports[0]).toBe("5432:5432");
  });

  it("leaves non-string scalars unchanged", () => {
    const node = { num: 42, bool: true, nil: null, str: "${X:-y}" };
    const out = interpolateNode(node, {}) as typeof node;
    expect(out.num).toBe(42);
    expect(out.bool).toBe(true);
    expect(out.nil).toBeNull();
    expect(out.str).toBe("y");
  });
});
