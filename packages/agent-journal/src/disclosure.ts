/** Spec 13.3, ordered most closed to most open. */
export const DISCLOSURE_CLASSES = ['private', 'team', 'published'] as const;
export type Disclosure = (typeof DISCLOSURE_CLASSES)[number];

const RANK: Readonly<Record<Disclosure, number>> = { private: 0, team: 1, published: 2 };

/**
 * Unrecognised parses to `private`, which inverts this package's usual rule that
 * an unknown value is refused and an absent one stays absent. Disclosure is a
 * containment boundary, and the two mistakes do not cost the same: withholding
 * an entry from a digest is an omission somebody notices; publishing a `person`
 * influence or a `rejected[]` naming someone's work is not recoverable.
 *
 * This is the same instinct as 4.3's capabilities preserving `unknown` rather
 * than assuming availability — both choose the answer that cannot cause
 * irreversible harm. They land on opposite literals because the harm is on
 * opposite sides.
 */
export function normalizeDisclosure(v: unknown): Disclosure {
  return v === 'team' || v === 'published' ? v : 'private';
}

/**
 * True when an entry may be read by somebody cleared to `level`. Typed
 * structurally rather than as `JournalEvent` so this module has no dependency
 * — even type-only — back on envelope.ts, which already depends on this one
 * for `normalizeDisclosure`/`Disclosure`. A prior two-way type dependency
 * between envelope.ts and entry.ts was rejected in review for coupling the
 * package's foundational modules; this keeps the edge one-directional.
 */
export function readableAt(entry: { readonly disclosure: Disclosure }, level: Disclosure): boolean {
  return RANK[entry.disclosure] >= RANK[level];
}
