import type { JournalEvent } from './envelope.ts';
import { OBSERVATION_KINDS } from './observe.ts';

/**
 * Spec §11.3's four triggers for a consequence-bearing observation — the kind
 * of thing that should prompt an entry even though nobody experienced it as a
 * decision at the time. `constraint-match` is the only exact one of the
 * four: it needs the entry (or draft) the caller is about to write, checked
 * against `constraintsBearingOn` (constraints.ts) for a scope word that
 * matches. Only the caller has that subject, so it is declared here and left
 * UNPOPULATED in this task — no code path below ever produces it. Task 2
 * wires it once a subject is available to check against.
 *
 * The other three are heuristics, not proofs, and each says so at its own
 * rule below: `permission` is real but currently unreachable in practice,
 * `mutation` is pattern matching over a command string with known blind
 * spots, and `unfamiliar-api` claims less than its name suggests.
 */
export type ConsequenceRule = 'permission' | 'mutation' | 'unfamiliar-api' | 'constraint-match';

export interface Consequence {
  readonly observationId: string;
  readonly rule: ConsequenceRule;
  readonly detail: string;
}

/** Same rule the rest of this package reads a string field by (see
 *  `stringField` in decay.ts): non-blank-after-trim, or absent. A field that
 *  is present but not a string, or present and blank, is absent — never `''`. */
function stringField(event: JournalEvent, field: string): string | undefined {
  const v = event.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

interface MutationPattern {
  readonly pattern: RegExp;
  readonly detail: string;
}

/**
 * Command-string patterns recognised as a config / secret / env-var / deploy
 * mutation — §11.3's second trigger. This is pattern matching over a shell
 * command string, not semantic understanding of what a tool call actually
 * did: `wrangler secret put` names its own effect in its own subcommand; a
 * bare `curl -X POST https://api/flags` does not — an explicit HTTP method
 * flag plus an arbitrary URL gives no way to tell a feature-flags API from an
 * unrelated path that merely contains the word "flags", so generic
 * HTTP-verb-based matching is deliberately absent here (see the Task 1
 * report for the false-positive reasoning; also true of `wget`/`http`).
 *
 * Extend this table, not the matcher, when a new CLI needs coverage,
 * following the same shape every existing row does: name a specific
 * mutating subcommand (`put`, `set`, `delete`, …), never a bare tool name —
 * so a paired read-only sibling (`... list`, `... get`, `... describe`,
 * `... status`) is never caught by accident, and the fields a reader needs
 * to judge each row's precision are visible right here without reading the
 * matcher.
 *
 * Two things this table deliberately does NOT handle itself, because they are
 * cross-cutting and belong in the matcher: a preview flag turning a mutating
 * verb into a no-op (`PREVIEW_FLAGS`), and a pattern appearing inside quoted
 * text rather than as the command being run (`withoutQuotedText`). Both are
 * applied to every row, so a new row inherits them without having to remember.
 */
export const MUTATION_PATTERNS: readonly MutationPattern[] = [
  // Cloudflare Workers/Pages secrets.
  { pattern: /\bwrangler\s+(?:pages\s+)?secret\s+(?:put|delete|bulk)\b/i,
    detail: 'wrangler secret put/delete/bulk changes a deployed Worker or Pages secret' },
  // Cloudflare KV — a live namespace's key/value data, put or delete only.
  { pattern: /\bwrangler\s+kv[:\s]+key\s+(?:put|delete)\b/i,
    detail: 'wrangler kv key put/delete changes a live KV namespace' },
  // GitHub Actions variables and secrets.
  { pattern: /\bgh\s+variable\s+(?:set|delete)\b/i,
    detail: 'gh variable set/delete changes a repository or environment variable' },
  { pattern: /\bgh\s+secret\s+(?:set|delete)\b/i,
    detail: 'gh secret set/delete changes a repository or environment secret' },
  // Kubernetes — the object-mutating `set` subcommands, and explicit
  // secret/configmap deletion. Bare `kubectl apply`/`delete`/`create` are
  // deliberately absent: they operate on arbitrary manifests, many of them
  // local test resources, and would fire on ordinary development work.
  { pattern: /\bkubectl\s+set\s+(?:env|image|resources|serviceaccount|selector)\b/i,
    detail: 'kubectl set changes a live object’s env, image, or resources' },
  { pattern: /\bkubectl\s+delete\s+(?:secret|configmap)\b/i,
    detail: 'kubectl delete secret/configmap removes a live cluster secret or config' },
  // AWS SSM Parameter Store and Secrets Manager.
  { pattern: /\baws\s+ssm\s+(?:put-parameter|delete-parameter)\b/i,
    detail: 'aws ssm put-parameter/delete-parameter changes a stored parameter' },
  { pattern: /\baws\s+secretsmanager\s+(?:put-secret-value|update-secret|create-secret|delete-secret)\b/i,
    detail: 'aws secretsmanager changes or removes a stored secret' },
  // Azure Key Vault, Google Secret Manager.
  { pattern: /\baz\s+keyvault\s+secret\s+(?:set|delete|purge)\b/i,
    detail: 'az keyvault secret set/delete/purge changes a stored secret' },
  { pattern: /\bgcloud\s+secrets\s+(?:create|delete)\b/i,
    detail: 'gcloud secrets create/delete changes a stored secret' },
  { pattern: /\bgcloud\s+secrets\s+versions\s+(?:add|destroy|disable)\b/i,
    detail: 'gcloud secrets versions add/destroy/disable changes a secret version' },
  // Platform config/env stores.
  { pattern: /\bheroku\s+config:(?:set|unset)\b/i,
    detail: 'heroku config:set/unset changes a deployed app’s environment' },
  { pattern: /\bvercel\s+env\s+(?:add|rm|remove)\b/i,
    detail: 'vercel env add/rm changes a deployed project’s environment' },
  { pattern: /\bfly(?:ctl)?\s+secrets\s+(?:set|unset|import)\b/i,
    detail: 'fly secrets set/unset/import changes a deployed app’s secrets' },
  { pattern: /\bdoppler\s+secrets\s+(?:set|delete)\b/i,
    detail: 'doppler secrets set/delete changes a stored secret' },
  // Registry auth tokens, and Docker Swarm secrets.
  { pattern: /\b(?:npm|pnpm)\s+config\s+set\b/i,
    detail: 'npm/pnpm config set changes registry configuration, including auth tokens' },
  { pattern: /\bdocker\s+secret\s+(?:create|rm|remove)\b/i,
    detail: 'docker secret create/rm changes a live swarm secret' },
  // Infrastructure changes. `terraform apply`/`destroy` are distinct verbs
  // from the read-only `terraform plan`, unlike the flag-gated tools above.
  { pattern: /\bterraform\s+(?:apply|destroy)\b/i,
    detail: 'terraform apply/destroy changes provisioned infrastructure' },
];

/**
 * Flags that turn a mutating verb into a preview. A command carrying one of
 * these changes nothing, so matching it is a pure false positive — a floor that
 * fires on `kubectl set env … --dry-run=client` is one somebody turns off,
 * after which nothing is captured at all.
 *
 * Tested PER COMMAND, never against the whole line. Testing the raw string was
 * worse than the bug it fixed: `gh secret set TOKEN --body x; terraform plan
 * --dry-run` was suppressed entirely, hiding a secret write that really ran
 * because an unrelated preview appeared later in the line. Chaining a preview
 * with a real change is ordinary shell usage, and a mutation nobody announced
 * is exactly what §11.3 exists to catch.
 */
const PREVIEW_FLAGS = /(?:^|\s)(?:--dry-run(?:[=\s]\S+)?|--diff|--plan|--what-if|--no-execute)(?=\s|$)/i;

/**
 * Commands whose ARGUMENTS are text rather than commands. Anything one of
 * these heads is skipped outright: `grep -rn "gh variable set" .` is a search,
 * `echo "wrangler secret put X" >> notes.md` is a write to a file, and a
 * heredoc fed to `cat` is a document. All three fired before.
 *
 * Keyed on the command's HEAD, which is what actually decides whether the rest
 * is data. An earlier attempt stripped every quoted span instead, and that
 * deleted live mutations: `wrangler secret "put" API_KEY` runs identically to
 * the unquoted form in bash, but stripping `"put"` made it invisible.
 */
const TEXT_HEADED = new Set([
  'grep', 'rg', 'ag', 'ack', 'echo', 'printf', 'cat', 'less', 'more', 'head',
  'tail', 'man', 'history', 'sed', 'awk', 'diff', 'comm', 'sort', 'uniq', 'wc',
]);

/** Two-word heads where the second word decides. `git commit -m "…"` carries a
 *  message, not a command; `git log --grep "…"` carries a search. */
const TEXT_HEADED_PAIRS = new Set(['git commit', 'git log', 'git tag', 'git stash']);

/** Split a shell line into the commands it runs. Deliberately naive — it does
 *  not parse the shell — but the separators it knows (`;`, `&&`, `||`, `|`,
 *  newline) are the ones that put two real commands on one line, which is the
 *  case that matters here. Separators inside quotes are left alone. */
function splitCommands(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === '\n' || ch === ';' || ch === '|'
        || (ch === '&' && input[i + 1] === '&')) {
      if (ch === '&') i += 1;
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim()).filter(Boolean);
}

/** Everything after an unquoted `#`. A comment is not a command, and
 *  `ls # reminder: wrangler secret put X later` reported a mutation. */
function withoutComment(command: string): string {
  let quote: string | undefined;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote) { if (ch === quote) quote = undefined; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(command[i - 1]!))) return command.slice(0, i);
  }
  return command;
}

/** Heredoc bodies, which are documents rather than commands. */
function withoutHeredocBodies(input: string): string {
  return input
    .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, ' ')
    .replace(/<<-?\s*(['"]?)[A-Za-z_][A-Za-z0-9_]*\1[\s\S]*/, ' ');
}

/** The head of a command, lower-cased, ignoring leading env assignments
 *  (`FOO=bar cmd …`) and a `sudo` prefix. */
function commandHead(command: string): { head: string; pair: string } {
  const words = command.split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const first = (words[0] === 'sudo' ? words[1] : words[0]) ?? '';
  const second = (words[0] === 'sudo' ? words[2] : words[1]) ?? '';
  const head = first.replace(/^.*\//, '').toLowerCase();
  return { head, pair: `${head} ${second.toLowerCase()}`.trim() };
}

/**
 * Drop quote CHARACTERS while keeping their contents. Only reached for a
 * command whose head is not text-headed, so the contents are part of the
 * command rather than data — and `wrangler secret "put" API_KEY` must still
 * match, since bash runs it identically to the unquoted form.
 */
function unquote(command: string): string {
  return command.replace(/['"]/g, '');
}

function matchMutation(input: string): string | undefined {
  for (const raw of splitCommands(withoutHeredocBodies(input))) {
    const command = withoutComment(raw);
    if (!command.trim()) continue;
    if (PREVIEW_FLAGS.test(command)) continue;
    const { head, pair } = commandHead(command);
    if (TEXT_HEADED.has(head) || TEXT_HEADED_PAIRS.has(pair)) continue;
    const runnable = unquote(command);
    for (const { pattern, detail } of MUTATION_PATTERNS) {
      if (pattern.test(runnable)) return detail;
    }
  }
  return undefined;
}

/** The first `http(s)://` URL's hostname, or undefined if none appears.
 *  Uses the platform URL parser rather than a hand-rolled host regex, so
 *  userinfo, port, and casing are all handled the way a browser or fetch()
 *  would handle them, not approximated. */
const URL_LITERAL = /https?:\/\/[^\s'"<>]+/;

function hostNamedIn(input: string): string | undefined {
  const found = URL_LITERAL.exec(input);
  if (!found) return undefined;
  try {
    return new URL(found[0]).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

const OBSERVATION_KIND_SET = new Set<string>(OBSERVATION_KINDS);

/**
 * §11.3's first trigger. `permission` is a real observation kind
 * (`observe.ts`'s `OBSERVATION_FIELDS.permission = ['tool', 'decision']`) and
 * this rule is implemented correctly against it — but as of this writing no
 * adapter emits one: `adapters/NOTES.md` records Claude Code's
 * `PermissionRequest` hook as attempted twice and never observed to fire.
 * The rule matches nothing in practice today. It stays implemented, not
 * stubbed, because the day an adapter does emit one this must already work,
 * and because "implemented but currently unreachable" is a true statement
 * this code can make and a missing rule cannot.
 *
 * Every decision value is treated the same — `granted` is exactly as
 * consequence-bearing as `denied`: both are a boundary the agent crossed (or
 * was stopped at) that nobody chose in the ordinary sense of a decision.
 */
function tryPermission(event: JournalEvent): Consequence | undefined {
  if (event.kind !== 'permission') return undefined;
  const decision = stringField(event, 'decision');
  if (decision === undefined) return undefined;
  const tool = stringField(event, 'tool');
  return {
    observationId: event.id,
    rule: 'permission',
    detail: tool ? `permission ${decision} for ${tool}` : `permission ${decision}`,
  };
}

/** §11.3's second trigger — see `MUTATION_PATTERNS` for what is and isn't
 *  recognised, and why. Reads only `tool_call`'s own `input` field (never a
 *  broader scan of `event.data`), which is also what keeps this rule from
 *  ever matching an entry: an entry's fields are named differently, and a
 *  `decision` merely *mentioning* a mutating command in its `chosen` text has
 *  no `input` field for this rule to read. */
function tryMutation(event: JournalEvent): Consequence | undefined {
  if (event.kind !== 'tool_call') return undefined;
  const input = stringField(event, 'input');
  if (input === undefined) return undefined;
  const detail = matchMutation(input);
  if (detail === undefined) return undefined;
  return { observationId: event.id, rule: 'mutation', detail };
}

/**
 * §11.3's third trigger. "Unfamiliar" means *absent from this journal* —
 * `seen` tracks every host this call has walked past so far, not every host
 * that has ever existed, and the detail string says exactly that rather than
 * implying the call is new to the world. Mutates `seen` as a side effect on
 * every `tool_call` that names a host, whether or not it is itself unfamiliar
 * — a mutation seen here still makes the host familiar for the next call,
 * and that bookkeeping must happen even when this particular observation
 * ends up reported under a different rule (see `consequencesIn`'s dedupe).
 */
function tryUnfamiliarApi(event: JournalEvent, seen: Set<string>): Consequence | undefined {
  if (event.kind !== 'tool_call') return undefined;
  const input = stringField(event, 'input');
  if (input === undefined) return undefined;
  const host = hostNamedIn(input);
  if (host === undefined) return undefined;
  const isUnfamiliar = !seen.has(host);
  seen.add(host);
  if (!isUnfamiliar) return undefined;
  return {
    observationId: event.id,
    rule: 'unfamiliar-api',
    detail: `first appearance of host ${host} in this journal`,
  };
}

function firstDefined<T>(candidates: readonly (T | undefined)[]): T | undefined {
  for (const c of candidates) {
    if (c !== undefined) return c;
  }
  return undefined;
}

/**
 * Which of §11.3's observation-derived triggers (all but `constraint-match`,
 * see that rule's own comment) apply to `events`, oldest first. `since`, if
 * given, narrows the *returned* set to what happened strictly after that
 * point — exclusive, so replaying the same cutoff twice never double-reports
 * the boundary event — but familiarity for `unfamiliar-api` is still tracked
 * across the *entire* input, because "unfamiliar" means absent from the
 * whole journal, not absent from whatever slice `since` selected; a host
 * used the day before a cutoff must not read as new again after it.
 *
 * One `Consequence` per observation, never more: an observation that
 * matches several rules (a mutating call to a host never seen before, say)
 * is one thing that happened, reported under its highest-priority rule
 * (`permission` before `mutation` before `unfamiliar-api` — mutually
 * exclusive by kind today, since only a `permission` event carries the
 * `decision` field and only a `tool_call` carries `input`, but the priority
 * is fixed here rather than left to insertion order in case a future rule
 * changes that). Entries (`decision`, `finding`, …) are a different family
 * from observations and never reach the matchers above: only a
 * `kind` this package's own `OBSERVATION_KINDS` (observe.ts) lists is
 * considered at all.
 */
export function consequencesIn(
  events: readonly JournalEvent[],
  options: { readonly since?: string } = {},
): Consequence[] {
  let sinceMs: number | undefined;
  if (options.since !== undefined) {
    sinceMs = Date.parse(options.since);
    if (Number.isNaN(sinceMs)) {
      throw new TypeError(`since must be a parseable timestamp, got ${JSON.stringify(options.since)}`);
    }
  }

  const chronological = [...events].sort((a, b) => {
    const byTime = Date.parse(a.time) - Date.parse(b.time);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });

  const seenHosts = new Set<string>();
  const out: Consequence[] = [];

  for (const event of chronological) {
    if (!OBSERVATION_KIND_SET.has(event.kind)) continue;

    // All three run unconditionally: tryUnfamiliarApi's seenHosts bookkeeping
    // must happen even when tryPermission or tryMutation already matched.
    const candidates = [tryPermission(event), tryMutation(event), tryUnfamiliarApi(event, seenHosts)];
    const chosen = firstDefined(candidates);
    if (chosen === undefined) continue;

    if (sinceMs !== undefined && !(Date.parse(event.time) > sinceMs)) continue;
    out.push(chosen);
  }

  return out;
}
