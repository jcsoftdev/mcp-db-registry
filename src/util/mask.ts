const DSN_PASSWORD_RE = /(:\/\/[^:@/]+:)([^@]+)(@)/g;

export function maskDsn(dsn: string): string {
  return dsn.replace(DSN_PASSWORD_RE, "$1***$3");
}

const KV_PASSWORD_RE = /\b(password|passwd|pwd)\s*=\s*\S+/gi;

export function maskPassword(str: string): string {
  return str.replace(KV_PASSWORD_RE, "$1=***");
}
