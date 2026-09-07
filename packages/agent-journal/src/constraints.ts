import type { JournalEvent } from './envelope.ts';
import { project } from './retract.ts';

export interface Constraint {
  readonly id: string;
  readonly statement: string;
  readonly origin?: string;
  readonly scope?: string;
  readonly expiry?: string;
  readonly enforcement: 'advisory' | 'blocking';
}

function text(event: JournalEvent, field: string): string | undefined {
  const v = event.data[field];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Constraints live at projection, never at write time (spec 5.7) — the same
 * precedent as 7.5's contradictions. A constraint stops constraining when it
 * expires, when a later constraint supersedes it, or when it is invalidated.
 *
 * `expiry` is a date, so it is inclusive of its own day: "expires 2026-09-30"
 * is how people write an obligation, and treating it as midnight would retire
 * the constraint a day early.
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
    const statement = text(e, 'statement');
    if (!statement) continue;

    const expiry = text(e, 'expiry');
    if (expiry) {
      const end = Date.parse(`${expiry}T23:59:59.999Z`);
      if (Number.isNaN(end)) continue;
      if (nowMs > end) continue;
    }
    const enforcement = e.data.enforcement === 'blocking' ? 'blocking' : 'advisory';
    out.push({
      id: e.id, statement, enforcement,
      ...(text(e, 'origin') === undefined ? {} : { origin: text(e, 'origin')! }),
      ...(text(e, 'scope') === undefined ? {} : { scope: text(e, 'scope')! }),
      ...(expiry === undefined ? {} : { expiry }),
    });
  }
  return out;
}

/**
 * KEYWORD matching, not semantic. A constraint bears on an entry when its
 * `scope` appears as a whole word in the entry's own text. This is deliberately
 * crude and is named so nobody reads a quiet result as "no constraint applies":
 * it means "no constraint's scope word appeared", which is a much weaker claim.
 * Nothing blocks and nothing auto-resolves; the output is for a human to read.
 */
export function constraintsBearingOn(
  entry: JournalEvent,
  live: readonly Constraint[],
): Constraint[] {
  if (entry.kind === 'constraint') return [];
  const haystack = Object.values(entry.data)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();

  return live.filter((c) => {
    if (!c.scope) return false;
    const word = c.scope.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(haystack);
  });
}
