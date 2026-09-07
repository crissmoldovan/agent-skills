import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeEvent, type JournalEvent } from './envelope.ts';
import { SegmentJournal } from './journal.ts';
import { parseSegment, mergeEvents } from './read.ts';
import { coverage, voidEvent } from './coverage.ts';

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const USAGE = [
  'usage:',
  '  journal record --kind <kind> --workspace <id> [--question q] [--chosen c] [--rationale r] [--id id] [--author human]',
  '  journal invalidate <entry-id> --reason <why> --workspace <id>',
  '  journal coverage --workspace <id>',
  '',
].join('\n');

function flags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(token.slice(2), next);
      i += 1;
    } else {
      out.set(token.slice(2), 'true');
    }
  }
  return out;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

function journalFor(root: string, workspace: string, session: string, agent: string): SegmentJournal {
  return new SegmentJournal({ root, workspace, machine: hostname(), session, agent, epoch: 'e1' });
}

async function readAll(root: string, workspace: string): Promise<JournalEvent[]> {
  const base = join(root, 'workspaces', workspace, 'segments');
  const batches: JournalEvent[][] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.jsonl')) batches.push(parseSegment(await readFile(full, 'utf8')).events);
    }
  }

  await walk(base);
  return mergeEvents(batches);
}

export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (!command) return { code: 2, stdout: '', stderr: USAGE };

  const opts = flags(rest);
  const root = env.AGENT_JOURNAL_ROOT ?? join(env.HOME ?? '.', '.agents', 'journal');
  const workspace = opts.get('workspace');
  if (!workspace) return { code: 2, stdout: '', stderr: `--workspace is required\n${USAGE}` };

  if (command === 'record') {
    const kind = opts.get('kind');
    if (!kind) return { code: 2, stdout: '', stderr: `--kind is required\n${USAGE}` };

    const session = env.AGENT_JOURNAL_SESSION ?? 'unknown';
    const agent = env.AGENT_JOURNAL_AGENT ?? 'primary';
    const id = opts.get('id') ?? randomUUID();

    // A human running this by hand is not an agent. Defaults to agent because
    // hooks are the common caller, but a refusal recorded against the wrong
    // author is the same misattribution voidEvent's `author` field exists to fix.
    const author = opts.get('author') === 'human' ? 'human' : 'agent';

    const data: Record<string, unknown> = {};
    for (const field of ['question', 'chosen', 'rationale', 'supersedes', 'invalidates']) {
      const v = opts.get(field);
      if (v !== undefined) data[field] = v;
    }

    const event = normalizeEvent({
      schemaVersion: 1, id, source: `cli/${hostname()}/${session}/${agent}`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session, agent, author, provenance: 'cli',
      harness: env.AGENT_JOURNAL_HARNESS ?? 'other', context: opts.get('context') ?? 'coding',
      kind, data,
    });

    const journal = journalFor(root, workspace, session, agent);
    const result = await journal.append(event);
    if (!result.written) {
      // Persist the refusal. Returning an error code alone means a refused write
      // never reaches `coverage()`'s `voids` count, so the silence this refusal
      // creates stays invisible — which is what voidEvent exists to prevent.
      await journal.append(voidEvent({
        id: randomUUID(), source: event.source, sourceEpoch: event.sourceEpoch,
        time: nowStamp(), workspace, session, agent,
        harness: env.AGENT_JOURNAL_HARNESS ?? 'other',
        reason: `redaction ${result.verdict}`, provenance: 'cli', author,
        ...(result.reason === undefined ? {} : { detail: result.reason }),
      }));
      return {
        code: 1,
        stdout: '',
        stderr: `refused: redaction ${result.verdict} — ${result.reason ?? 'no detail'}\n`,
      };
    }
    return { code: 0, stdout: `recorded ${id}\n`, stderr: '' };
  }

  if (command === 'invalidate') {
    const target = rest[0];
    const reason = opts.get('reason');
    if (!target || target.startsWith('--')) {
      return { code: 2, stdout: '', stderr: `an entry id is required\n${USAGE}` };
    }
    if (!reason) return { code: 2, stdout: '', stderr: `--reason is required\n${USAGE}` };

    // No session: a human retracting from a bare shell (spec 5.8).
    const event = normalizeEvent({
      schemaVersion: 1, id: randomUUID(), source: `cli/${hostname()}/-/-`, sourceEpoch: 'e1',
      time: nowStamp(), workspace, session: '-', agent: '-', author: 'human', provenance: 'cli',
      harness: 'other', context: 'coding', kind: 'decision',
      data: { invalidates: target, rationale: reason },
    });

    const result = await journalFor(root, workspace, '-', '-').append(event);
    if (!result.written) {
      return { code: 1, stdout: '', stderr: `refused: redaction ${result.verdict}\n` };
    }
    return { code: 0, stdout: `invalidated ${target}\n`, stderr: '' };
  }

  if (command === 'coverage') {
    // No retention pass has run here, so downgraded anchors are UNASSESSED.
    // Passing nothing yields `downgradedAnchors: null`, which renders as "not
    // assessed" rather than an empty array implying none were found.
    const report = coverage(await readAll(root, workspace));
    return { code: 0, stdout: `${JSON.stringify(report, null, 2)}\n`, stderr: '' };
  }

  return { code: 2, stdout: '', stderr: `unknown command: ${command}\n${USAGE}` };
}
