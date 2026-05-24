import path from "node:path";

export interface ProjectIdOpts {
  cwd: string;
  gitRemote: string | null;
}

export function projectId(opts: ProjectIdOpts): string {
  if (opts.gitRemote) return opts.gitRemote;
  return path.basename(opts.cwd);
}
