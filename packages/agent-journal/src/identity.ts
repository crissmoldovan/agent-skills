import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
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

/** Canonicalises through symlinks where the path exists, so two spellings of one
 *  directory never open two journals. macOS `/tmp` vs `/private/tmp` is the common case. */
function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function readExplicitId(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, '.agent-journal', 'id'), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Absent is a normal answer. Anything else — a permissions failure, a
    // directory where a file belongs — must NOT become a silently different
    // workspace. The spec requires identity be declared and recorded; falling
    // through would record `method: 'git'` for an id nobody declared.
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

export function resolveWorkspace(cwd: string, options: ResolveOptions = {}): WorkspaceIdentity {
  const explicit = cwd ? readExplicitId(cwd) : null;
  if (explicit) return { id: explicit, method: 'explicit', detail: join(cwd, '.agent-journal/id') };

  const common = options.gitCommonDir;
  if (common) {
    const normalized = canonical(common);
    return { id: `git-${hash(normalized)}`, method: 'git', detail: normalized };
  }

  if (options.hostContainer) {
    return { id: `host-${hash(options.hostContainer)}`, method: 'host', detail: options.hostContainer };
  }

  if (options.declared) {
    return { id: options.declared, method: 'declared', detail: 'declared by agent' };
  }

  if (cwd) {
    const normalized = canonical(cwd);
    return { id: `cwd-${hash(normalized)}`, method: 'cwd', detail: normalized };
  }

  // Random, not time-seeded: two sessions starting in the same millisecond are
  // unrelated and must not collide onto one journal.
  return {
    id: `ephemeral-${randomUUID()}`,
    method: 'ephemeral',
    detail: 'no durable identity available',
  };
}
