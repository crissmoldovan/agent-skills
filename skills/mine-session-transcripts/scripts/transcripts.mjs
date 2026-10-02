#!/usr/bin/env node
/**
 * WHAT A PERSON SAID IN AN AGENT SESSION, found in the harness's own transcripts without printing them.
 *
 *   node transcripts.mjs find       [selection]
 *   node transcripts.mjs messages   [selection] [--since ISO] [--until ISO]
 *   node transcripts.mjs locate     [selection] --phrase "<fixed phrase>" [--ignore-case]
 *   node transcripts.mjs show       --file <transcript> --line <n> [--terms-file <file>]
 *   node transcripts.mjs documented [selection] --corpus <dir> --control "<sentence>" [...]
 *
 *   selection: [--repo <path>] [--worktree <path>]... [--no-worktrees] [--history <dir>]
 *              [--include-headless] [--zone <IANA zone>]... [--json]
 *
 * A transcript is one JSON record per line, written by the harness as the session runs. It holds
 * everything: the person's words, the agent's, every tool result, the skill bodies and summaries
 * the harness injected, and whatever secret passed through a command's output. So nothing here
 * prints a transcript. `locate` prints where a message is (file, line, time, session, kind) and
 * never its words; `show` prints one person's message, and only after a scan for secrets.
 *
 * WHICH RECORDS ARE A PERSON'S. Three, and everything else is counted by kind and left out:
 *   - a typed turn: `type: "user"` marked `origin.kind: "human"`. Some harness versions mark no
 *     origin at all, so a user record with no origin, outside a subagent, that is not meta, not a
 *     summary, not a tool result and not harness markup is taken too, and counted as a fallback;
 *   - a queued message, typed while a turn was running: `type: "attachment"`,
 *     `attachment.type: "queued_command"`, `attachment.commandMode: "prompt"`. It never appears
 *     as a user record, so a count of user records alone misses every one of them;
 *   - a slash command's arguments: the command arrives as harness markup, and the text inside
 *     `<command-args>` is the person's.
 * The shapes, and the harness versions they were observed on, are in references/record-shapes.md.
 *
 * NEVER DEDUPLICATED BY TEXT. People repeat themselves ("status?", "continue"), and each is a
 * message. The only duplicate dropped is one record (one `uuid`) seen twice, and a subagent's copy
 * of a message its parent session already holds, which is the same message relayed.
 *
 * Exit codes: 0 ran; 1 bad arguments; 2 no transcripts for these paths, which is unknown and not
 * zero; 3 refused (a secret in the message asked for, or a control that failed).
 *
 * Dependency-free: Node 22 or newer, and git only for worktree discovery and a tracked-file corpus.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** Words per run in the documented-or-not check, and runs kept per message. */
export const RUN_WORDS = 8;
const RUNS_PER_MESSAGE = 60;
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Claude Code names a project's history directory after its path, with every character that is not
 * an ASCII letter or digit replaced by a hyphen. onboard-project's history scan encodes it the same
 * way, and the suite holds the two equal. The encoding is lossy: `/a/b-c` and `/a/b/c` share a
 * directory, which is why every transcript is confirmed by the `cwd` its own records carry.
 */
export function encodeProjectPath(projectPath) {
  return path.resolve(projectPath).replace(/[^A-Za-z0-9]/g, '-');
}

/** Text the harness delivers as a user turn that no person typed: preambles, check-ins, notices. */
export const HARNESS_TEXT = [
  'Base directory for this skill',
  'This session is being continued from a previous conversation',
  'Caveat: The messages below were generated',
  'Your task is to create a detailed summary of the conversation',
  'A session-scoped Stop hook is now active',
  'Stop hook feedback:',
  'Another Claude session sent a message',
  'Continue from where you left off.',
];

/** Shapes a secret has. A transcript can hold one in a command's output, a paste or a pasted URL. */
export const SECRET_PATTERNS = [
  ['a hex run of 32 or more characters', /[0-9a-fA-F]{32,}/],
  ['a JSON web token', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a provider API key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['a Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a credential assignment', /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/i],
  ['a URL with a password in it', /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
];

/** Every shape found in `text`, by name, plus whether a listed term is in it. Never the match. */
export function scanSecrets(text, terms = []) {
  const found = SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  const lower = text.toLowerCase();
  if (terms.some((term) => term && lower.includes(term.toLowerCase()))) found.push('a term from the terms file');
  return found;
}

/**
 * Letters and single spaces, lower case. The documented-or-not check applies it to BOTH sides: a
 * message flattened against a corpus that still has its punctuation finds almost nothing, and
 * reports almost everything as never written down.
 */
export function normalise(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim();
}

/** A message's runs: consecutive, non-overlapping eight-word slices of its normalised text. */
export function runsOf(text, { words = RUN_WORDS, cap = RUNS_PER_MESSAGE } = {}) {
  const list = normalise(text).split(' ').filter(Boolean);
  const runs = [];
  for (let start = 0; start + words <= list.length && runs.length < cap; start += words) {
    runs.push(list.slice(start, start + words).join(' '));
  }
  return runs;
}

/** The text blocks of a message's content, joined, and the kinds of anything else attached. */
function contentOf(content) {
  if (typeof content === 'string') return { text: content, attached: [] };
  if (!Array.isArray(content)) return { text: '', attached: [] };
  const text = content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n');
  const attached = [...new Set(content.filter((block) => block && block.type !== 'text').map((block) => String(block.type)))].sort();
  return { text, attached };
}

/** Harness markup, the interruption marker, a preamble, or a slash command whose arguments are words. */
function screenText(text) {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const args = trimmed.match(/<command-args>([\s\S]*?)<\/command-args>/);
    if (args && args[1].trim() !== '') {
      return { person: 'command-args', text: args[1].trim(), command: trimmed.match(/<command-name>([^<]*)<\/command-name>/)?.[1] ?? null };
    }
    return { kind: 'harness-markup' };
  }
  if (/^\[Request interrupted by user/.test(trimmed)) return { kind: 'interruption' };
  if (HARNESS_TEXT.some((marker) => trimmed.startsWith(marker))) return { kind: 'harness-text' };
  return { person: true, text };
}

/**
 * One record, classified. A person's message comes back as `{ person: <kind>, text, ... }`;
 * anything else as `{ kind }`, which the caller counts as an exclusion of that kind.
 */
export function classify(record, { subagent = false } = {}) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return { kind: 'unparsable' };
  if (record.type === 'attachment') {
    const attachment = record.attachment ?? {};
    if (attachment.type !== 'queued_command') return { kind: `attachment:${attachment.type ?? 'untyped'}` };
    // A coordinator's message to a subagent is queued too, with no mode and its own origin.
    if (attachment.commandMode !== 'prompt') return { kind: `queued:${attachment.commandMode ?? attachment.origin?.kind ?? 'unmarked'}` };
    const { text, attached } = contentOf(attachment.prompt);
    const screened = screenText(text);
    if (!screened.person) return { kind: `queued:${screened.kind}` };
    return { person: screened.person === true ? 'queued' : screened.person, text: screened.text, attached, command: screened.command ?? null };
  }
  if (record.type === 'queue-operation') return { kind: 'queue-bookkeeping' };
  if (record.type !== 'user') return { kind: `record:${record.type ?? 'untyped'}` };

  const content = record.message?.content;
  if (Array.isArray(content) && content.some((block) => block?.type === 'tool_result')) return { kind: 'tool-result' };
  if (record.isCompactSummary) return { kind: 'compact-summary' };
  const { text, attached } = contentOf(content);
  const origin = record.origin?.kind;
  if (origin !== undefined && origin !== 'human') return { kind: `origin:${origin}` };
  if (origin === undefined) {
    if (record.isMeta) return { kind: 'meta' };
    // In a subagent's transcript, an unmarked user turn is the prompt its parent or a script sent.
    if (subagent || record.isSidechain) return { kind: 'dispatch' };
    if (typeof record.entrypoint === 'string' && record.entrypoint.startsWith('sdk')) {
      const screened = screenText(text);
      return screened.person ? { kind: 'headless', text: screened.text, attached } : { kind: screened.kind };
    }
  }
  const screened = screenText(text);
  if (!screened.person) return { kind: screened.kind };
  return {
    person: screened.person === true ? 'typed' : screened.person,
    text: screened.text,
    attached,
    command: screened.command ?? null,
    // Command arguments are known by their markup; only a plain unmarked turn rests on the fallback.
    fallback: origin === undefined && screened.person === true,
  };
}

const hashOf = (text) => createHash('sha256').update(normalise(text)).digest('hex');

/**
 * Streams one transcript, a record at a time, with its 1-based line number and the raw line. Never
 * reads it whole: these files run to hundreds of megabytes. A line that does not parse comes back
 * with `record: undefined`, to be counted, not to stop the read.
 */
async function* recordsOf(file) {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let number = 0;
  try {
    for await (const line of lines) {
      number += 1;
      if (line.trim() === '') continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        record = undefined;
      }
      yield { number, record, line };
    }
  } finally {
    // A caller that stops early (belongs, show) must not leave the file open.
    lines.close();
    input.destroy();
  }
}

/**
 * Whether a transcript belongs to the paths: some record's `cwd` lies inside one of them.
 *
 * Not only the first. A session changes directory as it works, and one that enters a worktree part
 * of the way through is filed under the worktree's directory while its opening records still name
 * the checkout it started in. So the read stops at the first `cwd` inside, and otherwise runs to the
 * end, unless the opening `cwd` is outside and the directory is named for exactly that path: then the
 * directory is the other path's own, as a sibling repository's is, and it is left at once.
 */
async function belongs(file, { inside, directoryName }) {
  let first = null;
  for await (const { record } of recordsOf(file)) {
    if (typeof record?.cwd !== 'string') continue;
    if (inside(record.cwd)) return { belongs: true };
    if (first === null) {
      first = record.cwd;
      if (encodeProjectPath(first) === directoryName) return { belongs: false, sawCwd: true };
    }
  }
  return { belongs: false, sawCwd: first !== null };
}

function safeRealpath(target) {
  try {
    return realpathSync.native(target);
  } catch {
    return null;
  }
}

function within(child, parent) {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
}

/** The worktrees git knows for a repository, or none when git or the repository is absent. */
function gitWorktrees(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
  } catch {
    return [];
  }
}

/** Every `*.jsonl` that is a subagent's transcript under one session's folder. */
function subagentFiles(sessionFolder) {
  const found = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // A workflow's journal.jsonl sits beside its agents' transcripts and is not one.
      else if (entry.isFile() && /^agent-.*\.jsonl$/.test(entry.name)) found.push(full);
    }
  };
  walk(path.join(sessionFolder, 'subagents'));
  return found.sort();
}

/**
 * The transcripts for a repository and its worktrees, each confirmed by the `cwd` its own records
 * carry.
 *
 * A directory is a candidate when its name is the encoding of the repository or of a worktree, or
 * starts with one followed by a hyphen: a session started in a subdirectory, or in one of the
 * harness's own worktrees under `.claude/worktrees/`, gets a directory of its own, and the harness
 * keeps it after the worktree is removed. A sibling repository whose name only starts the same way
 * is a candidate too, and its records are what leave it out.
 *
 * A path with no history directory is listed as `missing`: unknown, never zero.
 */
export async function findTranscripts({ repo = process.cwd(), worktrees = [], history = path.join(homedir(), '.claude', 'projects'), noWorktrees = false } = {}) {
  const repoPath = path.resolve(repo);
  const targets = [{ path: repoPath, role: 'repository' }];
  for (const worktree of [...(noWorktrees ? [] : gitWorktrees(repoPath)), ...worktrees]) {
    const resolved = path.resolve(worktree);
    if (!targets.some((target) => target.path === resolved)) targets.push({ path: resolved, role: 'worktree' });
  }
  // Each target in every form a record may carry it: as given, and with symlinks resolved.
  const roots = [];
  for (const target of targets) {
    target.forms = [...new Set([target.path, safeRealpath(target.path)].filter(Boolean))];
    for (const form of target.forms) roots.push({ root: form, role: target.role });
  }
  roots.sort((a, b) => b.root.length - a.root.length);

  let names = [];
  try {
    names = readdirSync(history, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    names = [];
  }
  const exact = new Set(roots.map(({ root }) => encodeProjectPath(root)));
  const candidates = names.filter((name) => exact.has(name) || [...exact].some((prefix) => name.startsWith(`${prefix}-`)));

  const repoEncoded = encodeProjectPath(repoPath);
  const harnessWorktrees = (root) => path.join(root, '.claude', 'worktrees');
  const inside = (cwd) => {
    const match = roots.find(({ root }) => within(cwd, root));
    if (!match) return false;
    return !(noWorktrees && match.role === 'repository' && within(cwd, harnessWorktrees(match.root)));
  };
  // A directory's role comes from its name: the records of one session can name several paths.
  const roleOf = (name) => {
    if (name === repoEncoded) return 'repository';
    if (name.startsWith(`${repoEncoded}--claude-worktrees-`)) return 'worktree';
    if (targets.some((target) => target.role === 'worktree' && target.forms.some((form) => name === encodeProjectPath(form) || name.startsWith(`${encodeProjectPath(form)}-`)))) return 'worktree';
    return 'subdirectory';
  };

  const directories = [];
  const leftOut = [];
  for (const name of candidates) {
    const role = roleOf(name);
    if (noWorktrees && role === 'worktree') continue;
    const dir = path.join(history, name);
    const sessions = [];
    const subagents = [];
    const away = { 'its records name only paths outside the repository and its worktrees': 0, 'its records carry no cwd': 0 };
    let bytes = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(dir, entry.name);
      const verdict = await belongs(file, { inside, directoryName: name });
      if (!verdict.belongs) {
        away[verdict.sawCwd ? 'its records name only paths outside the repository and its worktrees' : 'its records carry no cwd'] += 1;
        continue;
      }
      sessions.push(file);
      bytes += statSync(file).size;
      const children = subagentFiles(path.join(dir, entry.name.slice(0, -'.jsonl'.length)));
      for (const child of children) bytes += statSync(child).size;
      subagents.push(...children.map((child) => ({ file: child, parent: file })));
    }
    for (const [reason, files] of Object.entries(away)) if (files) leftOut.push({ name, files, reason });
    if (sessions.length === 0) continue;
    directories.push({ name, dir, role, sessions: sessions.sort(), subagents, bytes });
  }
  const missing = targets
    .filter((target) => !target.forms.some((form) => names.includes(encodeProjectPath(form))))
    .map((target) => ({ path: target.path, role: target.role }));
  const nearMisses = directories.length === 0
    ? names.filter((name) => name.startsWith(encodeProjectPath(repoPath).slice(0, 40))).slice(0, 5)
    : [];
  return { history, repo: repoPath, targets: targets.map(({ path: p, role }) => ({ path: p, role })), directories, missing, leftOut, nearMisses };
}

/** A timestamp in UTC and in each zone asked for. */
export function formatTimes(timestamp, zones = []) {
  if (!timestamp) return 'no time';
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return `unreadable time ${JSON.stringify(timestamp)}`;
  const parts = [instant.toISOString().replace('.000Z', 'Z')];
  for (const zone of zones) {
    const text = new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset',
    }).format(instant);
    parts.push(`${text} (${zone})`);
  }
  return parts.join(' | ');
}

/**
 * Every person's message in the transcripts found, and every other record counted by kind.
 * `visit(message)` sees each message with its file, line, time, session and kind; `visitOther`
 * sees every other record's kind and raw line, for a caller that counts where else a phrase occurs.
 */
export async function readMessages(found, { since = null, until = null, includeHeadless = false, visit = () => {}, visitOther = null } = {}) {
  const totals = { messages: {}, fallback: 0, exclusions: {}, unparsable: 0, files: 0, subagentFiles: 0, outsideWindow: 0, first: null, last: null };
  const exclude = (kind) => { totals.exclusions[kind] = (totals.exclusions[kind] ?? 0) + 1; };
  const seenUuids = new Set();
  const sinceMs = since ? Date.parse(since) : null;
  const untilMs = until ? Date.parse(until) : null;

  const take = (message) => {
    const at = Date.parse(message.timestamp ?? '');
    if ((sinceMs !== null && !(at >= sinceMs)) || (untilMs !== null && !(at <= untilMs))) {
      totals.outsideWindow += 1;
      return;
    }
    totals.messages[message.kind] = (totals.messages[message.kind] ?? 0) + 1;
    if (message.fallback) totals.fallback += 1;
    if (message.timestamp && (!totals.first || message.timestamp < totals.first)) totals.first = message.timestamp;
    if (message.timestamp && (!totals.last || message.timestamp > totals.last)) totals.last = message.timestamp;
    visit(message);
  };

  const readOne = async (file, { subagent, parentHashes }) => {
    const hashes = new Set();
    for await (const { number, record, line } of recordsOf(file)) {
      if (record === undefined) {
        totals.unparsable += 1;
        continue;
      }
      const result = classify(record, { subagent });
      let kind = result.person;
      if (!kind && result.kind === 'headless' && includeHeadless) kind = 'headless';
      if (!kind) {
        exclude(result.kind);
        if (visitOther) visitOther(result.kind, line);
        continue;
      }
      if (record.uuid && seenUuids.has(record.uuid)) {
        exclude('duplicate-record');
        if (visitOther) visitOther('duplicate-record', line);
        continue;
      }
      if (record.uuid) seenUuids.add(record.uuid);
      const hash = hashOf(result.text);
      if (subagent && parentHashes.has(hash)) {
        exclude('relayed-copy');
        if (visitOther) visitOther('relayed-copy', line);
        continue;
      }
      hashes.add(hash);
      take({
        file,
        line: number,
        timestamp: record.timestamp ?? null,
        session: record.sessionId ?? path.basename(file, '.jsonl'),
        kind,
        where: subagent ? 'subagent' : 'session',
        fallback: Boolean(result.fallback),
        attached: result.attached ?? [],
        command: result.command ?? null,
        text: result.text,
        hash,
      });
    }
    return hashes;
  };

  for (const directory of found.directories) {
    const parents = new Map();
    for (const session of directory.sessions) {
      totals.files += 1;
      parents.set(session, await readOne(session, { subagent: false, parentHashes: new Set() }));
    }
    for (const { file, parent } of directory.subagents) {
      totals.subagentFiles += 1;
      await readOne(file, { subagent: true, parentHashes: parents.get(parent) ?? new Set() });
    }
  }
  return totals;
}

/** The words a reader needs to judge any count: what was read, what was not, and the window. */
export function coverageLines(found, totals) {
  const lines = [];
  const roles = {};
  for (const directory of found.directories) roles[directory.role] = (roles[directory.role] ?? 0) + 1;
  const sessions = found.directories.reduce((sum, d) => sum + d.sessions.length, 0);
  const subagents = found.directories.reduce((sum, d) => sum + d.subagents.length, 0);
  lines.push(`history: ${found.history}`);
  const listed = (items, render) => `${items.slice(0, 5).map(render).join(', ')}${items.length > 5 ? `, and ${items.length - 5} more (--json lists them all)` : ''}`;
  const worktreeTargets = found.targets.filter((target) => target.role === 'worktree');
  lines.push(`paths: ${found.repo}, and ${worktreeTargets.length} worktree${worktreeTargets.length === 1 ? '' : 's'} of it${worktreeTargets.length ? ` (${listed(worktreeTargets, (target) => target.path)})` : ''}`);
  lines.push(`read whole: ${sessions} session transcripts in ${found.directories.length} director${found.directories.length === 1 ? 'y' : 'ies'} (${Object.entries(roles).map(([role, n]) => `${n} ${role}`).join(', ') || 'none'}), and ${subagents} subagent transcripts beside them`);
  for (const item of found.leftOut) lines.push(`left out: ${item.files} transcript${item.files === 1 ? '' : 's'} in ${item.name} (${item.reason})`);
  if (found.missing.length) lines.push(`no history for ${found.missing.length} of these paths, so unknown, not zero: ${listed(found.missing, (item) => item.path)}`);
  if (totals) {
    lines.push(`unparsable lines: ${totals.unparsable}`);
    if (totals.outsideWindow) lines.push(`messages outside the window: ${totals.outsideWindow}`);
    lines.push(`window of the messages taken: ${totals.first ?? 'none'} to ${totals.last ?? 'none'}`);
  }
  lines.push('not read: history this machine no longer keeps, history on other machines, and any harness other than the one these records came from');
  return lines;
}

function parseArgs(argv) {
  const options = { worktree: [], zone: [], control: [], exclude: [], relayName: [] };
  const repeatable = new Set(['worktree', 'zone', 'control', 'exclude', 'relay-name']);
  const flags = new Set(['json', 'ignore-case', 'include-headless', 'no-worktrees', 'all', 'help']);
  const valued = new Set(['repo', 'history', 'since', 'until', 'phrase', 'file', 'line', 'terms-file', 'corpus', 'max-file-bytes', 'out']);
  const [command, ...rest] = argv;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(token)}`);
    const name = token.slice(2);
    if (!flags.has(name) && !valued.has(name) && !repeatable.has(name)) throw new Error(`unknown option ${token}`);
    if (flags.has(name)) {
      options[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    index += 1;
    const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (repeatable.has(name)) options[key].push(value);
    else options[key] = value;
  }
  return { command, options };
}

const USAGE = `usage:
  transcripts.mjs find       [selection]
  transcripts.mjs messages   [selection] [--since ISO] [--until ISO]
  transcripts.mjs locate     [selection] --phrase "<fixed phrase>" [--ignore-case]
  transcripts.mjs show       --file <transcript> --line <n> [--terms-file <file>] [--zone <zone>]
  transcripts.mjs documented [selection] --corpus <dir> --control "<sentence of 8+ words>"...
                             [--exclude <path prefix>]... [--max-file-bytes <n>] [--relay-name <name>]...
                             [--all] [--out <file>]
selection: [--repo <path>] [--worktree <path>]... [--no-worktrees] [--history <dir>] [--include-headless]
           [--zone <IANA zone>]... [--json]`;

function validateZones(zones) {
  for (const zone of zones) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      throw new Error(`--zone ${JSON.stringify(zone)} is not a time zone this Node knows`);
    }
  }
}

async function selection(options) {
  return findTranscripts({
    repo: options.repo ?? process.cwd(),
    worktrees: options.worktree,
    history: options.history ?? path.join(homedir(), '.claude', 'projects'),
    noWorktrees: options.noWorktrees,
  });
}

function sorted(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function where(found, message) {
  return `${path.relative(found.history, message.file)}:${message.line}`;
}

async function commandFind(options, out) {
  const found = await selection(options);
  if (options.json) {
    out(JSON.stringify({ ...found, directories: found.directories.map((d) => ({ ...d, subagents: d.subagents.map((s) => s.file) })) }, null, 1));
  } else {
    for (const directory of found.directories) {
      out(`${directory.name}  (${directory.role})`);
      out(`  ${directory.sessions.length} session transcripts, ${directory.subagents.length} subagent transcripts, ${(directory.bytes / 1048576).toFixed(1)} MB`);
    }
    if (found.nearMisses.length) out(`no directory matched; names that start the same way: ${found.nearMisses.join(', ')}`);
    for (const line of coverageLines(found, null)) out(line);
  }
  return found.directories.length === 0 ? 2 : 0;
}

async function commandMessages(options, out) {
  const found = await selection(options);
  if (found.directories.length === 0) {
    for (const line of coverageLines(found, null)) out(line);
    return 2;
  }
  const totals = await readMessages(found, { since: options.since, until: options.until, includeHeadless: options.includeHeadless });
  if (options.json) {
    out(JSON.stringify({ totals, coverage: coverageLines(found, totals) }, null, 1));
    return 0;
  }
  const total = Object.values(totals.messages).reduce((sum, n) => sum + n, 0);
  out(`a person's messages: ${total}`);
  for (const [kind, n] of sorted(totals.messages)) out(`  ${String(n).padStart(6)}  ${kind}`);
  out(`  of which taken by the fallback (no origin marked): ${totals.fallback}`);
  out('left out, by kind:');
  for (const [kind, n] of sorted(totals.exclusions)) out(`  ${String(n).padStart(6)}  ${kind}`);
  for (const line of coverageLines(found, totals)) out(line);
  return 0;
}

async function commandLocate(options, out) {
  if (!options.phrase) throw new Error('locate needs --phrase "<a fixed phrase from the message>"');
  const phrase = options.ignoreCase ? options.phrase.toLowerCase() : options.phrase;
  const has = (text) => (options.ignoreCase ? text.toLowerCase() : text).includes(phrase);
  const found = await selection(options);
  if (found.directories.length === 0) {
    for (const line of coverageLines(found, null)) out(line);
    return 2;
  }
  const hits = [];
  // Where else the phrase occurs, by kind: a summary or a tool result repeats words, and a reader
  // told only that no person's message holds the phrase should know whether it is there at all.
  const elsewhere = {};
  const totals = await readMessages(found, {
    since: options.since,
    until: options.until,
    includeHeadless: options.includeHeadless,
    visit: (message) => { if (has(message.text)) hits.push(message); },
    visitOther: (kind, line) => { if (has(line)) elsewhere[kind] = (elsewhere[kind] ?? 0) + 1; },
  });
  if (options.json) {
    out(JSON.stringify({
      hits: hits.map(({ text, hash, ...rest }) => ({ ...rest, chars: text.length })),
      elsewhere,
      coverage: coverageLines(found, totals),
    }, null, 1));
    return 0;
  }
  out(`${hits.length} message${hits.length === 1 ? '' : 's'} from a person contain the phrase`);
  for (const message of hits) {
    out(`  ${where(found, message)}  ${formatTimes(message.timestamp, options.zone)}  session ${message.session}  ${message.kind}${message.where === 'subagent' ? ' (in a subagent)' : ''}`);
  }
  const other = sorted(elsewhere);
  if (other.length) out(`the phrase also occurs in records that are not a person's: ${other.map(([kind, n]) => `${n} ${kind}`).join(', ')}`);
  for (const line of coverageLines(found, totals)) out(line);
  return 0;
}

async function commandShow(options, out) {
  if (!options.file || !options.line) throw new Error('show needs --file <transcript> and --line <n>');
  const wantedLine = Number(options.line);
  if (!Number.isInteger(wantedLine) || wantedLine < 1) throw new Error('--line must be a line number from 1');
  const terms = options.termsFile
    ? readFileSync(options.termsFile, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    : [];
  const subagent = /[\\/]subagents[\\/]/.test(options.file);
  for await (const { number, record } of recordsOf(options.file)) {
    if (number < wantedLine) continue;
    if (number > wantedLine) break;
    if (record === undefined) {
      out(`line ${wantedLine} does not parse as a record; nothing shown`);
      return 3;
    }
    const result = classify(record, { subagent });
    const kind = result.person ?? (result.kind === 'headless' ? 'headless' : null);
    if (!kind) {
      out(`line ${wantedLine} is a ${result.kind} record, not a person's message; nothing shown`);
      return 3;
    }
    const hits = scanSecrets(result.text, terms);
    if (hits.length) {
      out(`line ${wantedLine} holds ${hits.join(', ')}; nothing shown. Open the file yourself if you must read it.`);
      return 3;
    }
    out(`${options.file}:${wantedLine}  ${formatTimes(record.timestamp, options.zone)}  session ${record.sessionId ?? '?'}  ${kind}${result.attached?.length ? `  (also attached: ${result.attached.join(', ')})` : ''}`);
    out('');
    out(result.text);
    return 0;
  }
  out(`no record at line ${wantedLine}`);
  return 1;
}

/** Tracked files when the corpus is a git checkout, every file under it otherwise. */
function corpusFiles(corpus) {
  try {
    const out = execFileSync('git', ['-C', corpus, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = out.split('\0').filter(Boolean);
    if (files.length) return { from: 'git ls-files', files: files.map((file) => path.join(corpus, file)) };
  } catch {
    // not a checkout: walk it
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(corpus);
  return { from: 'every file under it', files: files.sort() };
}

async function commandDocumented(options, out) {
  if (!options.corpus) throw new Error('documented needs --corpus <dir>');
  if (options.control.length === 0) {
    throw new Error('documented needs at least one --control: a sentence of eight or more words copied from a file the corpus holds');
  }
  const corpus = path.resolve(options.corpus);
  const maxBytes = options.maxFileBytes ? Number(options.maxFileBytes) : DEFAULT_MAX_FILE_BYTES;
  const found = await selection(options);
  if (found.directories.length === 0) {
    for (const line of coverageLines(found, null)) out(line);
    return 2;
  }

  const messages = [];
  const totals = await readMessages(found, {
    since: options.since,
    until: options.until,
    includeHeadless: options.includeHeadless,
    visit: (message) => messages.push(message),
  });

  // The controls go through the same function as the messages. A positive control that is not
  // found, or a negative one that is, means the matcher is broken, and no count from it is shown.
  const controls = options.control.map((sentence) => ({ sentence, runs: runsOf(sentence) }));
  for (const control of controls) {
    if (control.runs.length === 0) throw new Error(`--control ${JSON.stringify(control.sentence)} has fewer than ${RUN_WORDS} words once normalised`);
  }
  const alphabet = 'bcdfghjklmnpqrstvwxz';
  const nonsense = Array.from({ length: RUN_WORDS }, () => Array.from({ length: 9 }, () => alphabet[randomInt(alphabet.length)]).join('')).join(' ');

  const needed = new Set([nonsense]);
  for (const control of controls) for (const run of control.runs) needed.add(run);
  const judged = messages.map((message) => ({ message, runs: runsOf(message.text) }));
  for (const { runs } of judged) for (const run of runs) needed.add(run);

  // Only a window whose first word starts some wanted run can be one, so most are never joined.
  const firstWords = new Set([...needed].map((run) => run.slice(0, run.indexOf(' '))));
  const historyReal = safeRealpath(found.history) ?? found.history;
  const excluded = options.exclude.map((prefix) => path.resolve(corpus, prefix));
  const { from, files } = corpusFiles(corpus);
  const skipped = { binary: 0, 'over the size cap': 0, excluded: 0, 'inside the history directory': 0, unreadable: 0 };
  let used = 0;
  const present = new Set();
  for (const file of files) {
    if (excluded.some((prefix) => within(file, prefix))) { skipped.excluded += 1; continue; }
    if (within(safeRealpath(file) ?? file, historyReal)) { skipped['inside the history directory'] += 1; continue; }
    let buffer;
    try {
      if (statSync(file).size > maxBytes) { skipped['over the size cap'] += 1; continue; }
      buffer = readFileSync(file);
    } catch {
      skipped.unreadable += 1;
      continue;
    }
    if (buffer.subarray(0, 8192).includes(0)) { skipped.binary += 1; continue; }
    used += 1;
    const words = normalise(buffer.toString('utf8')).split(' ').filter(Boolean);
    for (let start = 0; start + RUN_WORDS <= words.length; start += 1) {
      if (!firstWords.has(words[start])) continue;
      const window = words.slice(start, start + RUN_WORDS).join(' ');
      if (needed.has(window)) present.add(window);
    }
  }

  const failed = controls.filter((control) => !control.runs.every((run) => present.has(run)));
  if (failed.length || present.has(nonsense)) {
    for (const control of failed) out(`control NOT FOUND: ${JSON.stringify(control.sentence)}`);
    if (present.has(nonsense)) out('the negative control was found, so the matcher finds anything');
    out('the matcher cannot be trusted on this corpus; no count is shown. Check the control is copied from a file the corpus holds.');
    return 3;
  }

  const names = options.relayName.map((name) => name.trim()).filter(Boolean);
  const speak = '(?:said|says|sent|wrote|asked|answered|replied|responded|forwarded|from|message)';
  const nameGroup = names.length ? `(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})` : null;
  const relayPattern = nameGroup ? new RegExp(`\\b${speak}\\W{0,30}${nameGroup}\\b|\\b${nameGroup}\\W{0,30}${speak}\\b`, 'i') : null;
  const namePattern = nameGroup ? new RegExp(`\\b${nameGroup}\\b`, 'i') : null;
  const relays = (text) => {
    if (!relayPattern) return null;
    if (relayPattern.test(text)) return true;
    const fenced = text.match(/```[\s\S]*?```/g) ?? [];
    return fenced.some((block) => namePattern.test(block));
  };

  const rows = judged.map(({ message, runs }) => {
    const hits = runs.filter((run) => present.has(run)).length;
    return {
      file: path.relative(found.history, message.file),
      line: message.line,
      timestamp: message.timestamp,
      session: message.session,
      kind: message.kind,
      chars: message.text.length,
      runs: runs.length,
      found: hits,
      pct: runs.length ? Math.floor((100 * hits) / runs.length) : null,
      relays: relays(message.text),
    };
  });
  const buckets = [
    ['mostly written down (60% or more)', (row) => row.pct !== null && row.pct >= 60],
    ['partly (20% to 59%)', (row) => row.pct !== null && row.pct >= 20 && row.pct < 60],
    ['not written down (under 20%)', (row) => row.pct !== null && row.pct < 20],
    [`too short to judge (under ${RUN_WORDS} words)`, (row) => row.pct === null],
  ];
  const register = {
    method: `normalised to letters and single spaces on both sides; ${RUN_WORDS}-word runs, at most ${RUNS_PER_MESSAGE} per message`,
    corpus: { from, used, skipped, maxFileBytes: maxBytes },
    controls: controls.length,
    relayNames: names.length,
    buckets: Object.fromEntries(buckets.map(([label, test]) => [label, rows.filter(test).length])),
    rows,
    coverage: coverageLines(found, totals),
  };
  if (options.out) {
    // A register holds positions and counts. Message text never reaches a file from here.
    writeFileSync(options.out, `${JSON.stringify(register, null, 1)}\n`);
  }
  if (options.json) {
    out(JSON.stringify(register, null, 1));
    return 0;
  }
  out(`controls: ${controls.length} found, and the negative control not found`);
  out(`corpus: ${used} files read (${from}); skipped ${sorted(skipped).filter(([, n]) => n).map(([why, n]) => `${n} ${why}`).join(', ') || 'none'}`);
  out(`messages judged: ${rows.length}`);
  for (const [label, test] of buckets) out(`  ${String(rows.filter(test).length).padStart(6)}  ${label}`);
  if (relayPattern) {
    const relayed = rows.filter((row) => row.relays);
    out(`messages relaying a named person's words: ${relayed.length} (${relayed.filter((row) => row.pct !== null && row.pct < 20).length} of them not written down)`);
  } else {
    out('relays: not checked, because no --relay-name was given');
  }
  const listed = options.all ? rows : rows.filter((row) => row.pct !== null && row.pct < 20);
  out(options.all ? 'every message:' : 'not written down:');
  for (const row of listed) {
    out(`  ${row.file}:${row.line}  ${formatTimes(row.timestamp, options.zone)}  ${row.kind}  ${row.chars} chars  ${row.pct === null ? 'too short' : `${row.pct}%`}${row.relays ? '  relays' : ''}`);
  }
  if (options.out) out(`register written to ${options.out} (positions and counts; no message text)`);
  for (const line of coverageLines(found, totals)) out(line);
  return 0;
}

export async function main(argv = process.argv.slice(2), out = (line) => process.stdout.write(`${line}\n`)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    validateZones(parsed.options.zone);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 1;
  }
  const { command, options } = parsed;
  if (!command || options.help) {
    out(USAGE);
    return command ? 0 : 1;
  }
  const commands = { find: commandFind, messages: commandMessages, locate: commandLocate, show: commandShow, documented: commandDocumented };
  if (!commands[command]) {
    process.stderr.write(`unknown command ${JSON.stringify(command)}\n${USAGE}\n`);
    return 1;
  }
  try {
    return await commands[command](options, out);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

/**
 * True when this file was run rather than imported. Both sides are resolved to real paths: the
 * Skills CLI installs a skill through a symlink, and an as-typed path never equals the resolved one.
 */
export function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
}

if (isEntrypoint(import.meta.url)) {
  process.exitCode = await main();
}
