/**
 * Docker Compose variable interpolation.
 *
 * Implements the Compose specification for variable substitution as documented at
 * https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/.
 *
 * Supported forms:
 *   $VAR             — direct substitution; empty string when unset
 *   ${VAR}           — braced substitution; empty string when unset
 *   ${VAR:-default} — use `default` when VAR is unset OR empty
 *   ${VAR-default}  — use `default` when VAR is unset (empty string preserved)
 *   ${VAR:+alt}     — use `alt` when VAR is set AND non-empty
 *   ${VAR+alt}      — use `alt` when VAR is set (even if empty)
 *   ${VAR:?err}     — throws RequiredVarError when VAR is unset OR empty
 *   ${VAR?err}      — throws RequiredVarError when VAR is unset
 *   $$              — literal "$"
 *
 * Defaults and alternates may themselves contain interpolations: ${A:-${B:-fallback}}.
 */

export class RequiredVarError extends Error {
  constructor(public readonly name: string, message: string) {
    super(message);
    this.name = "RequiredVarError";
  }
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

export function interpolate(input: string, env: Record<string, string>): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    // Escape: $$ → $
    if (input[i + 1] === "$") {
      out += "$";
      i += 2;
      continue;
    }
    // Braced: ${...}
    if (input[i + 1] === "{") {
      const close = findMatchingBrace(input, i + 1);
      if (close === -1) {
        // Malformed — emit literal and continue scanning past the '$'
        out += "$";
        i++;
        continue;
      }
      const inner = input.slice(i + 2, close);
      out += resolveBraced(inner, env);
      i = close + 1;
      continue;
    }
    // Bare: $IDENT
    const m = IDENT.exec(input.slice(i + 1));
    if (m) {
      const name = m[0];
      out += env[name] ?? "";
      i += 1 + name.length;
      continue;
    }
    // Lone '$' followed by something non-identifier — keep literal
    out += "$";
    i++;
  }
  return out;
}

function findMatchingBrace(input: string, openIdx: number): number {
  let depth = 1;
  for (let i = openIdx + 1; i < input.length; i++) {
    const c = input[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function resolveBraced(inner: string, env: Record<string, string>): string {
  const nameMatch = IDENT.exec(inner);
  if (!nameMatch) return "";
  const name = nameMatch[0];
  const rest = inner.slice(name.length);

  const raw = env[name];
  const isSet = raw !== undefined;
  const isEmpty = !isSet || raw === "";

  // No operator: simple lookup
  if (rest.length === 0) return raw ?? "";

  // Parse operator: ':-' ':+' ':?' '-' '+' '?'
  let op: ":-" | ":+" | ":?" | "-" | "+" | "?";
  let operandRaw: string;
  if (rest[0] === ":" && (rest[1] === "-" || rest[1] === "+" || rest[1] === "?")) {
    op = (rest[0] + rest[1]) as ":-" | ":+" | ":?";
    operandRaw = rest.slice(2);
  } else if (rest[0] === "-" || rest[0] === "+" || rest[0] === "?") {
    op = rest[0] as "-" | "+" | "?";
    operandRaw = rest.slice(1);
  } else {
    // Unknown operator — degrade gracefully to plain lookup
    return raw ?? "";
  }

  // Operand may itself contain interpolations (nested defaults)
  const operand = interpolate(operandRaw, env);

  switch (op) {
    case ":-": return isEmpty ? operand : raw!;
    case "-":  return isSet ? raw! : operand;
    case ":+": return isEmpty ? "" : operand;
    case "+":  return isSet ? operand : "";
    case ":?":
      if (isEmpty) throw new RequiredVarError(name, operand || `${name} is required`);
      return raw!;
    case "?":
      if (!isSet) throw new RequiredVarError(name, operand || `${name} is required`);
      return raw!;
  }
}

/**
 * Recursively walks a parsed YAML node, applying `interpolate` to every string value.
 * Non-string nodes are returned unchanged. Arrays and plain objects are mapped structurally.
 */
export function interpolateNode<T>(node: T, env: Record<string, string>): T {
  if (typeof node === "string") {
    return interpolate(node, env) as unknown as T;
  }
  if (Array.isArray(node)) {
    return node.map((item) => interpolateNode(item, env)) as unknown as T;
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = interpolateNode(v, env);
    }
    return out as unknown as T;
  }
  return node;
}
