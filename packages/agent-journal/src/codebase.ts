import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { canonicalize } from './paths.ts';

/**
 * The ref convention this module defines: a bare `path/to/file.ts` checks
 * existence; `path/to/file.ts:symbolName` additionally requires the
 * symbol's name to appear in the file's text -- a grep, not a parse. That
 * catches a deleted or renamed symbol; it does NOT catch one that kept its
 * name and changed meaning. Nothing here claims otherwise.
 */



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
