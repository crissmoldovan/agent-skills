import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { lstat, readlink, realpath } from 'node:fs/promises';

/**
 * Resolve a path's REAL parent directory, tolerating a tail that does not exist
 * yet. Walks up until something resolvable is found, then rejoins the missing
 * components onto the real prefix.
 */
export async function realParentDir(dirPath: string): Promise<string> {
  let current = resolve(dirPath);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) return join(current, ...tail); // reached the fs root
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Canonicalize a path that may not exist yet, following a final-component
 * symlink to wherever it actually points — dangling or not.
 *
 * This is the resolution every containment guard in this package runs BEFORE
 * comparing a path against a root it must stay inside. A guard run against
 * anything less — a lexical join, or `realpath` on an intermediate segment
 * alone — is defeated by a symlink sitting at exactly the position that was
 * skipped.
 *
 * It lives here, in one place, because it is security-relevant and had two
 * copies: one in `cli.ts` guarding `digest --out`, one in `codebase.ts`
 * guarding decay's repo reads. They were already diverging in their comments,
 * which is how a pair of copies begins to diverge in behaviour.
 */
export async function canonicalize(p: string, depth = 0): Promise<string> {
  if (depth > 40) {
    // A real filesystem refuses a symlink chain this long with ELOOP; this
    // mirrors that instead of recursing forever around a symlink cycle.
    throw Object.assign(new Error(`too many levels of symbolic links: ${p}`), { code: 'ELOOP' });
  }
  const abs = resolve(p);
  const parentReal = await realParentDir(dirname(abs));
  const candidate = join(parentReal, basename(abs));

  let stat;
  try {
    stat = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Genuinely does not exist at all, at any level — nothing more to resolve.
    return candidate;
  }

  // Exists and is not itself a link: the parent is already canonical and this
  // component adds nothing symlinked on top of it.
  if (!stat.isSymbolicLink()) return candidate;

  const target = await readlink(candidate);
  const resolvedTarget = isAbsolute(target) ? target : join(dirname(candidate), target);
  return canonicalize(resolvedTarget, depth + 1);
}
