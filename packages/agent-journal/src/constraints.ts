import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';

export interface Constraint {
  readonly id: string;
  readonly statement: string;
  readonly origin?: string;
  readonly scope?: string;
  readonly expiry?: string;
  readonly enforcement: 'advisory' | 'blocking';
  /**
   * Set when `expiry` is present but unusable — unparseable, or not a
   * string at all. Absent when `expiry` is absent, empty, or fine. Never
   * `false`.
   */
  readonly malformedExpiry?: true;
}

function text(event: JournalEvent, field: string): string | undefined {
  const v = event.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Constraints live at projection, never at write time (spec 5.7) — the same
 * precedent as 7.5's contradictions. A constraint stops constraining when it
 * expires, when a later constraint supersedes it, or when it is invalidated.
 *
 * `expiry` accepts two forms. A bare `YYYY-MM-DD` is inclusive of its own
 * day: "expires 2026-09-30" is how people write an obligation, and treating
 * it as midnight would retire the constraint a day early, so a bare date is
 * read as ending at `T23:59:59.999Z`. Anything else that `Date.parse` accepts
 * on its own — a full RFC3339/ISO timestamp, say — is used exactly as given;
 * it is never concatenated onto, because concatenating a suffix onto a string
 * that already carries its own time component produces a string nothing can
 * parse and silently drops a still-live obligation, which is the direction
 * this function must never fail in.
 *
 * When `expiry` is present but cannot be read as a date — a string that
 * parses under neither form above, or a value that is not a string at
 * all (a number, a boolean, an array) — the constraint stays LIVE and is
 * marked `malformedExpiry: true` instead of being dropped. A standing
 * obligation whose expiry cannot be read might still apply, and this
 * design's ethos is that silence must be legible: an obligation that
 * genuinely lapsed keeps appearing until its expiry is fixed — noisy, but
 * recoverable, which silently dropping a live one is not. An `expiry` key
 * that is absent, or a string that is empty or whitespace-only, is treated
 * as "no expiry stated" and is never marked — only a key that is present
 * and unusable is.
 */
export function liveConstraints(events: readonly JournalEvent[], now: string): Constraint[] {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`now must be a parseable timestamp, got ${JSON.stringify(now)}`);
  }
  const { superseded, invalidated } = project(events);

  const out: Constraint[] = [];
  for (const e of events) {
    if (e.kind !== 'constraint') continue;
    if (superseded.has(e.id) || invalidated.has(e.id)) continue;
    // The CLI's `record --kind constraint` now refuses to write a constraint
    // with no (or blank) `--statement`, so this skip can no longer be reached
    // through that path. It stays for a foreign record — one written by a
    // hook adapter or another producer that bypassed the CLI's own check —
    // where a constraint with no stated obligation must not silently render
    // as a live one.
    const statement = text(e, 'statement');
    if (!statement) continue;

    // Presence is checked on the raw value, before text() narrows a
    // non-string away to undefined — a number, boolean or array in this
    // field is present and unusable, not absent, and must be marked the
    // same as a string that fails to parse. An empty or whitespace-only
    // string is present but is treated as "no expiry stated", unmarked,
    // matching absent — only text()'s own trim decides that case.
    const rawExpiry = e.data.expiry;
    const expiryPresent = rawExpiry !== undefined;
    const expiry = text(e, 'expiry');
    let malformedExpiry = false;
    if (expiryPresent && typeof rawExpiry !== 'string') {
      malformedExpiry = true;
    } else if (expiry) {
      const end = BARE_DATE.test(expiry) ? Date.parse(`${expiry}T23:59:59.999Z`) : Date.parse(expiry);
      if (Number.isNaN(end)) {
        malformedExpiry = true;
      } else if (nowMs > end) {
        continue;
      }
    }
    const origin = text(e, 'origin');
    const scope = text(e, 'scope');
    const enforcement = e.data.enforcement === 'blocking' ? 'blocking' : 'advisory';
    out.push({
      id: e.id, statement, enforcement,
      ...(origin === undefined ? {} : { origin }),
      ...(scope === undefined ? {} : { scope }),
      ...(expiry === undefined ? {} : { expiry }),
      ...(malformedExpiry ? { malformedExpiry: true as const } : {}),
    });
  }
  return out;
}

/**
 * The keyword-match half of `constraintsBearingOn` — the part that has no
 * intrinsic reason to require a `JournalEvent`, only the strings an event
 * (or anything else) happens to carry. Extracted so a caller who has a bare
 * subject string but no event can match one directly, without constructing
 * a synthetic `JournalEvent` to satisfy a parameter that would then be lying
 * about what it holds.
 *
 * `strings` are joined and lowercased here, once, so every caller shares the
 * exact matching behaviour `constraintsBearingOn` always had — a second,
 * drifted copy of the regex-escaping and whole-word logic is exactly the
 * kind of fork that quietly stops agreeing with itself.
 *
 * KEYWORD matching, not semantic. A constraint bears on something when its
 * `scope` appears as a whole word in the given text. This is deliberately
 * crude and is named so nobody reads a quiet result as "no constraint applies":
 * it means "no constraint's scope word appeared", which is a much weaker claim.
 * Nothing blocks and nothing auto-resolves; the output is for a human to read.
 */
export function constraintsMatching(
  strings: readonly string[],
  live: readonly Constraint[],
): Constraint[] {
  const haystack = strings.join(' ').toLowerCase();
  return live.filter((c) => {
    if (!c.scope) return false;
    const word = c.scope.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(haystack);
  });
}

/**
 * Flattens an entry's OWN field values into the string list `constraintsMatching`
 * checks. Kept separate from that function so the "what strings come from an
 * event" question and the "does a string match a live constraint" question
 * stay two questions — the second one is what a bare `--subject` needs
 * answered without ever having the first.
 */
export function constraintsBearingOn(
  entry: JournalEvent,
  live: readonly Constraint[],
): Constraint[] {
  if (entry.kind === 'constraint') return [];
  const strings = Object.values(entry.data)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === 'string');
  return constraintsMatching(strings, live);
}
