#!/usr/bin/env node
/**
 * Scan what a branch adds for terms on a private denylist, before anything is pushed.
 *
 * `verify-skills` catches what has a shape: a likely secret, a home-directory path. What leaks
 * from real work has no shape. A client's name, a colleague's handle, an internal host, an
 * account id, a mailbox, a time zone: each is an ordinary word, and only a list of the actual
 * words can find them. That list cannot live here, because it would publish exactly what it
 * protects, so each contributor keeps their own outside every repository and passes it in.
 *
 * What is read is what the branch would publish:
 * - every added line of every changed file, fixtures included, since `<base>`'s merge base;
 * - every changed file's name;
 * - every commit message in `<merge base>..HEAD`;
 * - the branch name;
 * - with `--worktree`, uncommitted changes and untracked files as well. The commits, the index
 *   and the working tree are each read on their own, so an edit not yet staged or committed
 *   cannot hide what a commit or the index holds. An untracked repository nested inside this one
 *   would be added as a link to one of its commits, so only its name is read, and the run says so.
 * A line already on the base, or removed, is not read: it is not this branch's to fix.
 * A binary file is searched as bytes, which finds a name in image metadata but not one drawn
 * in the pixels, so every binary file is listed for a person to look at.
 *
 * The list is one term per line; blank lines and lines starting with `#` are ignored. A term
 * matches case-insensitively where it stands as a word: not inside a longer run of letters, or
 * a longer run of digits. An underscore, a hyphen, a camelCase hump and a change between letters
 * and digits each count as a break, so `name_export`, `nameClient` and `name01` match `name`,
 * and `names` does not. An edge of a term that is punctuation (`~/dir/`, `tool++`) matches
 * wherever it is written. Whitespace inside a term matches any run of whitespace. Any other
 * spelling is another term, to be listed as well: a hyphenated or joined form, an abbreviation,
 * or capitals run on into the next word (`NAMECorp` is one word).
 *
 * Terms are never printed. A hit names where it is and which line of the list it matched,
 * and any term inside a printed path is masked, so the output can be pasted where others
 * read it. `--show-matches` prints the matched text, for a local terminal only.
 *
 * Exit 0: nothing matched. Exit 1: hits. Exit 2: could not scan — no denylist, a denylist
 * inside this repository (any of its worktrees included) or with no terms, a base that does not
 * resolve, or git failing.
 * Dependency-free; needs git on PATH.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import process from 'node:process';

const USAGE = `Usage: node scripts/scan-denylist.mjs --denylist <file> [--base <ref>] [--branch <name>] [--worktree] [--show-matches]

  --denylist <file>  your private list, one term per line, kept outside every repository
  --base <ref>       what the branch will be compared with (default: origin/main)
  --branch <name>    the branch name to scan when HEAD is detached, as on CI
  --worktree         also read uncommitted changes and untracked files
  --show-matches     print the matched text (local terminal only; terms are otherwise never printed)`;

const MAX_BUFFER = 1024 * 1024 * 1024;
// Git's own test for a binary file: a NUL byte in the first 8000 bytes.
const BINARY_PROBE = 8000;
const WORD = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;

class Refusal extends Error {}

// Everything printed goes through this, refusals included: once the list is loaded, it masks
// every term, unless --show-matches asked for them.
let present = (text) => text;

function parseArgs(argv) {
  const options = { base: 'origin/main', worktree: false, showMatches: false };
  const valued = { '--denylist': 'denylist', '--base': 'base', '--branch': 'branch' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (flag === '--worktree') options.worktree = true;
    else if (flag === '--show-matches') options.showMatches = true;
    else if (flag in valued) {
      const value = inline ?? argv[++index];
      if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) throw new Refusal(`${flag} needs a value`);
      options[valued[flag]] = value;
    } else throw new Refusal(`unknown option: ${arg}`);
  }
  if (!options.denylist) throw new Refusal('--denylist <file> is required: the private list of terms that must never appear here');
  return options;
}

function git(cwd, args, { buffer = false, allowFailure = false } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: MAX_BUFFER });
  if (result.error) throw new Refusal(`git could not run: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Refusal(`git ${args[0]} failed: ${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

function isWithin(candidate, container) {
  const path = relative(container, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(term, line) {
  const pattern = (text) => text.split(/\s+/).map(escapeRegExp).join('\\s+');
  const chars = Array.from(term);
  return {
    line,
    text: new RegExp(pattern(term), 'giu'),
    // A binary file is read as Latin-1, one character per byte, so the term is searched for as
    // the bytes UTF-8 gives it; for an ASCII term that is the term itself.
    bytes: new RegExp(pattern(Buffer.from(term, 'utf8').toString('latin1')), 'gi'),
    leftWord: WORD.test(chars[0]),
    rightWord: WORD.test(chars[chars.length - 1]),
  };
}

/**
 * Every directory a file could be committed from: this worktree, every other worktree of the same
 * repository (a list left untracked in the main checkout can be committed there), and the shared
 * git directory.
 */
function repositoryPlaces(top) {
  const places = [top];
  const common = git(top, ['rev-parse', '--git-common-dir'], { allowFailure: true })?.trim();
  if (common) places.push(resolve(top, common));
  for (const line of (git(top, ['worktree', 'list', '--porcelain'], { allowFailure: true }) ?? '').split('\n')) {
    if (line.startsWith('worktree ')) places.push(line.slice('worktree '.length));
  }
  return places.flatMap((place) => {
    try {
      return [realpathSync(place)];
    } catch {
      return []; // a worktree that was moved or deleted without being pruned
    }
  });
}

function loadDenylist(file, top) {
  const absolute = resolve(process.cwd(), file);
  let real;
  let source;
  try {
    real = realpathSync(absolute);
    source = readFileSync(real, 'utf8');
  } catch (error) {
    throw new Refusal(`cannot read the denylist at ${file}: ${error.code ?? error.message}`);
  }
  if (repositoryPlaces(top).some((place) => isWithin(real, place))) {
    throw new Refusal('the denylist is inside this repository or one of its worktrees; keep it outside every repository, so that it can never be committed');
  }
  const terms = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const term = raw.trim();
    if (term && !term.startsWith('#')) terms.push(compile(term, index + 1));
  });
  if (terms.length === 0) throw new Refusal('the denylist has no terms, and an empty list would pass everything');
  return terms;
}

function charBefore(text, index) {
  if (index <= 0) return undefined;
  const code = text.charCodeAt(index - 1);
  if (code >= 0xdc00 && code <= 0xdfff && index >= 2) return text.slice(index - 2, index);
  return text[index - 1];
}

function charAt(text, index) {
  return index < text.length ? String.fromCodePoint(text.codePointAt(index)) : undefined;
}

/**
 * Whether a word ends between two adjacent characters: at the edge of the text, beside anything
 * that is not a letter or a digit, where letters meet digits (`host01`, the numbered host a
 * name most often hides in), and at a camelCase hump.
 */
function isBreak(before, after) {
  if (before === undefined || after === undefined) return true;
  if (!WORD.test(before) || !WORD.test(after)) return true;
  if (LETTER.test(before) !== LETTER.test(after)) return true;
  return LOWER.test(before) && UPPER.test(after);
}

/** Every place `term` stands as a word in `text`. */
function* find(text, term, regex = term.text) {
  for (const match of text.matchAll(regex)) {
    const start = match.index;
    const end = start + match[0].length;
    if (term.leftWord && !isBreak(charBefore(text, start), charAt(text, start))) continue;
    if (term.rightWord && !isBreak(charBefore(text, end), charAt(text, end))) continue;
    yield { index: start, match: match[0] };
  }
}

function mask(text, terms) {
  let masked = text;
  for (const term of terms) {
    const spans = [...find(masked, term)].reverse();
    for (const { index, match } of spans) {
      masked = `${masked.slice(0, index)}‹denylist line ${term.line}›${masked.slice(index + match.length)}`;
    }
  }
  return masked;
}

/** A path as git prints it in a `+++` header: C-quoted when it holds a quote, a backslash or a control character. */
function unquote(path) {
  if (!path.startsWith('"')) return path;
  const bytes = [];
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, '\\': 92 };
  for (let index = 1; index < path.length - 1; index += 1) {
    const char = path[index];
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const next = path[index + 1];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(path.slice(index + 1, index + 4), 8));
      index += 3;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Added lines of a `-U0` diff, as { path, line, text }. */
function addedLines(diff) {
  const lines = [];
  let path = null;
  let inHunk = false;
  let next = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      path = null;
      inHunk = false;
    } else if (!inHunk && raw.startsWith('+++ ')) {
      // Git ends the name with a tab when it holds a space.
      const name = unquote(raw.slice(4).replace(/\t$/, ''));
      path = name === '/dev/null' ? null : name.replace(/^b\//, '');
    } else if (raw.startsWith('@@ ')) {
      inHunk = true;
      next = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
    } else if (inHunk && raw.startsWith('+') && path !== null) {
      lines.push({ path, line: next, text: raw.slice(1) });
      next += 1;
    }
  }
  return lines;
}

/** A working-tree file's bytes as git would store them: a symbolic link is its target's path. */
function workingBytes(top, path) {
  const full = join(top, path);
  try {
    return lstatSync(full).isSymbolicLink() ? Buffer.from(readlinkSync(full)) : readFileSync(full);
  } catch (error) {
    throw new Refusal(`cannot read ${path} in the working tree: ${error.code ?? error.message}`);
  }
}

function changedFiles(top, range, worktree) {
  const files = [];
  const numstat = git(top, ['diff', '--numstat', '-z', '--no-renames', '--diff-filter=d', '--no-ext-diff', '--no-textconv', ...range]);
  for (const record of numstat.split('\0')) {
    if (!record) continue;
    const [added, removed, ...rest] = record.split('\t');
    files.push({ path: rest.join('\t'), binary: added === '-' && removed === '-', tracked: true });
  }
  if (worktree) {
    for (const path of git(top, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) {
      if (!path) continue;
      // Git lists an untracked repository nested in this one as `dir/`. Adding it would add a link
      // to one of its commits, not its files, so its name is read and its contents are not.
      if (path.endsWith('/')) files.push({ path: path.slice(0, -1), nested: true, binary: false, tracked: false });
      else files.push({ path, binary: workingBytes(top, path).subarray(0, BINARY_PROBE).includes(0), tracked: false });
    }
  }
  return files;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel'], { allowFailure: true })?.trim();
  if (!top) throw new Refusal('run it inside the git repository whose branch you are about to push');
  const terms = loadDenylist(options.denylist, top);
  if (!options.showMatches) present = (text) => mask(text, terms);

  if (git(top, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { allowFailure: true }) === null) {
    throw new Refusal('HEAD has no commit yet');
  }
  const base = git(top, ['rev-parse', '--verify', '--quiet', `${options.base}^{commit}`], { allowFailure: true })?.trim();
  if (!base) throw new Refusal(`the base ${options.base} does not resolve to a commit here; fetch it (git fetch origin) or pass --base <ref>`);
  const mergeBase = git(top, ['merge-base', base, 'HEAD'], { allowFailure: true })?.trim();
  if (!mergeBase) throw new Refusal(`${options.base} and HEAD share no history`);

  const hits = [];
  const hit = (kind, where, term, match) => hits.push({ kind, where, line: term.line, match });
  const scanText = (text, onHit) => {
    for (const term of terms) for (const found of find(text, term)) onHit(term, found);
  };

  let branch = options.branch;
  if (branch === undefined) branch = git(top, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })?.trim() || null;
  if (branch) scanText(branch, (term, found) => hit('branch name', '', term, found.match));

  const log = git(top, ['log', '-z', '--no-show-signature', '--format=%H%n%B', `${mergeBase}..HEAD`]);
  const commits = log.split('\0').filter(Boolean).map((entry) => {
    const newline = entry.indexOf('\n');
    return { sha: newline < 0 ? entry : entry.slice(0, newline), message: newline < 0 ? '' : entry.slice(newline + 1) };
  });
  for (const { sha, message } of commits) {
    message.split('\n').forEach((text, index) => {
      scanText(text, (term, found) => hit('commit message', `${sha.slice(0, 12)} line ${index + 1}`, term, found.match));
    });
  }

  // What the commits add, and with `--worktree` what the index and the working tree add as well,
  // each read on its own: a push publishes HEAD and a commit the index, so an edit not yet staged
  // or committed cannot hide what a commit, or the index, already holds.
  const views = [{ range: [mergeBase, 'HEAD'], copy: (path) => `HEAD:${path}` }];
  if (options.worktree) {
    views.push({ range: ['--cached', mergeBase], copy: (path) => `:${path}` });
    views.push({ range: [mergeBase], copy: null });
  }
  const byPath = new Map();
  views.forEach((view, index) => {
    const withUntracked = options.worktree && index === views.length - 1;
    for (const entry of changedFiles(top, view.range, withUntracked)) {
      const known = byPath.get(entry.path);
      if (known) {
        known.binary ||= entry.binary;
        // A path HEAD holds that the index no longer tracks can be back in the working tree as an
        // untracked file: both copies are read.
        if (entry.tracked) known.views.push(view);
        else known.untracked = true;
      } else {
        byPath.set(entry.path, { ...entry, views: entry.tracked ? [view] : [] });
      }
    }
  });
  const files = [...byPath.values()];
  for (const { path } of files) scanText(path, (term, found) => hit('file name', path, term, found.match));

  // A line read in an earlier view is not read again from a later one.
  const lines = [];
  const read = new Set();
  for (const view of views) {
    const diff = git(top, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-filter=d', '-U0', '--src-prefix=a/', '--dst-prefix=b/', ...view.range]);
    const own = addedLines(diff).filter((entry) => !read.has(`${entry.path}\0${entry.text}`));
    lines.push(...own);
    for (const entry of own) read.add(`${entry.path}\0${entry.text}`);
  }
  for (const file of files.filter((entry) => (!entry.tracked || entry.untracked) && !entry.binary && !entry.nested)) {
    workingBytes(top, file.path).toString('utf8').split('\n').forEach((text, index, all) => {
      if (index < all.length - 1 || text !== '') lines.push({ path: file.path, line: index + 1, text });
    });
  }
  for (const { path, line, text } of lines) {
    scanText(text, (term, found) => hit('added line', `${path}:${line}:${found.index + 1}`, term, found.match));
  }

  const binaries = files.filter((entry) => entry.binary);
  const nested = files.filter((entry) => entry.nested);
  for (const { path, tracked, untracked, views: held } of binaries) {
    const copies = held.map((view) => (view.copy ? git(top, ['cat-file', 'blob', view.copy(path)], { buffer: true }) : workingBytes(top, path)));
    if (!tracked || untracked) copies.push(workingBytes(top, path));
    const found = new Set();
    for (const bytes of copies) {
      const latin1 = bytes.toString('latin1');
      for (const term of terms) {
        for (const match of find(latin1, term, term.bytes)) {
          const where = `${path} byte ${match.index}`;
          if (found.has(`${where}\0${term.line}`)) continue;
          found.add(`${where}\0${term.line}`);
          hit('binary file', where, term, match.match);
        }
      }
    }
  }

  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  const out = [];
  if (hits.length === 0) {
    out.push('scan-denylist: no denylist term in what this branch adds.');
  } else {
    out.push(`scan-denylist: ${plural(hits.length, 'hit')}.${options.showMatches ? '' : ' Terms are never printed; each hit names its line in the denylist.'}`);
    const kindWidth = Math.max(...hits.map((entry) => entry.kind.length));
    const whereWidth = Math.max(...hits.map((entry) => present(entry.where).length));
    for (const entry of hits) {
      const shown = options.showMatches ? `  ${JSON.stringify(entry.match)}` : '';
      out.push(`  ${entry.kind.padEnd(kindWidth)}  ${present(entry.where).padEnd(whereWidth)}  denylist line ${entry.line}${shown}`);
    }
  }
  out.push('');
  const what = options.worktree ? 'HEAD, the index and the working tree add' : 'this branch adds';
  const branchNote = branch ? 'and the branch name' : 'and the branch name was not scanned: HEAD is detached (pass --branch <name>)';
  out.push(
    `Scanned what ${what} to ${options.base} (merge base ${mergeBase.slice(0, 12)}) against ${plural(terms.length, 'denylist term')}: `
    + `${plural(commits.length, 'commit and its message', 'commits and their messages')}, `
    + `${plural(files.length, 'file')} (${files.length - binaries.length - nested.length} text, ${binaries.length} binary`
    + `${nested.length ? `, ${plural(nested.length, 'nested repository', 'nested repositories')}` : ''}) and their names, `
    + `${plural(lines.length, 'added line')}, ${branchNote}.`,
  );
  if (binaries.length) {
    out.push(`Binary files are searched as bytes; a term drawn in an image is not, so look at each one: ${binaries.map((entry) => entry.path).sort().join(', ')}.`);
  }
  if (nested.length) {
    out.push(`A nested repository would be added as a link to one of its commits, so only its name was read: ${nested.map((entry) => entry.path).sort().join(', ')}.`);
  }
  console.log(present(out.join('\n')));
  return hits.length ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`scan-denylist: ${present(error.message)}\n\n${USAGE}`);
  process.exitCode = 2;
}
