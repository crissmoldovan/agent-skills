import { readFile, lstat, realpath, readlink } from 'node:fs/promises';
import { dirname, basename, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * The ref convention this module defines: a bare `path/to/file.ts` checks
 * existence; `path/to/file.ts:symbolName` additionally requires the
 * symbol's name to appear in the file's text -- a grep, not a parse. That
 * catches a deleted or renamed symbol; it does NOT catch one that kept its
 * name and changed meaning. Nothing here claims otherwise.
 */

/**
 * Resolve the PARENT directory chain of `dirPath` as canonically as the
 * filesystem allows: walk up to the longest existing ancestor, `realpath()`
 * that, and lexically rejoin whatever does not exist yet. Mirrors `cli.ts`'s
 * `realParentDir` -- this module needs the same symlink-proof containment
 * check `digest --out` needed, for the same reason: a ref an entry cites can
 * point anywhere by a typo or a foreign writer's hand, and resolving it
 * before vetting it would let a journal read anywhere on the machine.
 */
async function realParentDir(dirPath: string): Promise<string> {
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
 * Resolve `p` as canonically as the filesystem allows -- including a live or
 * dangling symlink at the FINAL path component, followed to wherever it
 * actually points (recursively, since the target may itself be another
 * symlink or a not-yet-existing path) rather than treated as "doesn't exist
 * yet". Mirrors `cli.ts`'s `canonicalize`. A containment check run against
 * anything less than this (a lexical join, or `realpath` on an intermediate
 * segment alone) can be defeated by a symlink sitting at exactly this
 * position.
 */
async function canonicalize(p: string, depth = 0): Promise<string> {
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
    return candidate; // genuinely does not exist at all, at any level
  }

  if (!stat.isSymbolicLink()) return candidate;

  const target = await readlink(candidate);
  const resolvedTarget = isAbsolute(target) ? target : join(dirname(candidate), target);
  return canonicalize(resolvedTarget, depth + 1);
}

/**
 * `undefined` covers "does not exist", "is not a file" (a directory, a
 * socket, ...), and any other read failure alike -- the caller reports all
 * three as `false`. Only a containment failure gets different treatment,
 * and that is decided by the CALLER, before this is ever invoked: this
 * function is never called with a path that has not already been vetted.
 */
async function readVettedFile(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) return undefined;
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function splitRef(ref: string): { readonly path: string; readonly symbol: string | undefined } {
  const idx = ref.indexOf(':');
  return idx === -1
    ? { path: ref, symbol: undefined }
    : { path: ref.slice(0, idx), symbol: ref.slice(idx + 1) };
}

/**
 * Resolves each `codebase` influence ref against `repoRoot`, filesystem
 * truth pre-computed so `decay.ts`'s `computeDecay` can stay synchronous and
 * pure (Task 1 built that checker; this builds the map it consumes). Every
 * ref is resolved, containment-checked, and only THEN read -- in that order,
 * for the same reason `digest --out` in `cli.ts` checks containment before
 * it writes: an entry can legitimately cite `../../etc/passwd` by a typo or
 * a foreign writer's hand, and reading before vetting would let a journal
 * read anywhere on the machine.
 *
 * A ref that escapes `repoRoot` -- directly, via `..`, or via a symlink
 * anywhere along its path, INCLUDING its own final component -- is refused:
 * it is OMITTED from the returned map, never set to `false`. `false` reads
 * as "the file is gone"; a refused ref may well name a file that exists,
 * just somewhere this journal must not look, which is a different fact.
 * `decay.ts`'s `checkCodebase` already treats a ref absent from the map as
 * `not-checkable`, which is the honest status for a refusal.
 *
 * Every file named by a vetted ref is read at most once per call, even when
 * several refs (a bare path and one or more `path:symbol` refs) name it.
 */
export async function resolveCodebaseRefs(
  refs: readonly string[],
  repoRoot: string,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const repoRootReal = await canonicalize(repoRoot);
  const fileCache = new Map<string, string | undefined>();

  for (const ref of refs) {
    const { path, symbol } = splitRef(ref);
    const joined = isAbsolute(path) ? path : join(repoRoot, path);

    let candidateReal: string;
    try {
      candidateReal = await canonicalize(joined);
    } catch {
      continue; // cannot be vetted (e.g. a symlink cycle) -- refuse, never guess
    }

    // Exact match (the ref names `repoRoot` itself) and "strictly inside"
    // are kept as two separate conditions, never a single
    // `startsWith(repoRootReal)` missing the separator -- that would also
    // match a sibling that merely shares the prefix, e.g. a repo at
    // `/work/app` matching a ref that resolved to `/work/app-backup/x`.
    const inside = candidateReal === repoRootReal || candidateReal.startsWith(repoRootReal + sep);
    if (!inside) continue; // refusal: omitted, not `false` -- see doc above

    let text: string | undefined;
    if (fileCache.has(candidateReal)) {
      text = fileCache.get(candidateReal);
    } else {
      text = await readVettedFile(candidateReal);
      fileCache.set(candidateReal, text);
    }

    result.set(
      ref,
      symbol === undefined ? text !== undefined : text !== undefined && text.includes(symbol),
    );
  }

  return result;
}
