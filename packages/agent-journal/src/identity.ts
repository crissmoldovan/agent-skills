import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ResolutionMethod = 'explicit' | 'git' | 'cwd' | 'host' | 'declared' | 'ephemeral';

export interface WorkspaceIdentity {
  readonly id: string;
  readonly method: ResolutionMethod;
  /** What the method keyed on, so the choice can be inspected later. */
  readonly detail: string;
}

export interface ResolveOptions {
  /**
   * Output of `git rev-parse --git-common-dir`, absolute.
   * A worktree and its main checkout share this, which is what collapses them
   * into one workspace. Pass null when there is no repository.
   */
  readonly gitCommonDir?: string | null;
  /** Host container id (ChatGPT Project, Claude Project, Cowork space). */
  readonly hostContainer?: string | null;
  /** An id the agent asked for and recorded. */
  readonly declared?: string | null;
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function readExplicitId(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, '.agent-journal', 'id'), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function resolveWorkspace(cwd: string, options: ResolveOptions = {}): WorkspaceIdentity {
  const explicit = cwd ? readExplicitId(cwd) : null;
  if (explicit) return { id: explicit, method: 'explicit', detail: join(cwd, '.agent-journal/id') };

  const common = options.gitCommonDir;
  if (common) {
    const normalized = resolve(common);
    return { id: `git-${hash(normalized)}`, method: 'git', detail: normalized };
  }

  if (options.hostContainer) {
    return { id: `host-${hash(options.hostContainer)}`, method: 'host', detail: options.hostContainer };
  }

  if (options.declared) {
    return { id: options.declared, method: 'declared', detail: 'declared by agent' };
  }

  if (cwd) {
    const normalized = resolve(cwd);
    return { id: `cwd-${hash(normalized)}`, method: 'cwd', detail: normalized };
  }

  return {
    id: `ephemeral-${hash(String(Date.now()))}`,
    method: 'ephemeral',
    detail: 'no durable identity available',
  };
}
