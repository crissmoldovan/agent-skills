import { ANCHOR_CLASSES, type AnchorClass } from './envelope.ts';

export const INFLUENCE_TYPES = [
  'url', 'document', 'journal', 'ticket', 'conversation',
  'tool_result', 'codebase', 'person', 'model_knowledge',
] as const;
export type InfluenceType = (typeof INFLUENCE_TYPES)[number];

export const INFLUENCE_ROLES = ['decisive', 'supporting', 'considered', 'contradicted'] as const;
export type InfluenceRole = (typeof INFLUENCE_ROLES)[number];

export interface Anchor {
  readonly type: AnchorClass;
  readonly ref: string;
}

export interface Influence {
  readonly type: InfluenceType;
  readonly role: InfluenceRole;
  /** Absent only for `model_knowledge`, which asserts that nothing was consulted. */
  readonly ref?: string;
}

const ANCHOR_SET = new Set<string>(ANCHOR_CLASSES);
const TYPE_SET = new Set<string>(INFLUENCE_TYPES);
const ROLE_SET = new Set<string>(INFLUENCE_ROLES);

/**
 * `<class>:<ref>` — split on the FIRST colon only. A ref is routinely
 * `src/x.ts:41` or a URL, so splitting on every colon would truncate the thing
 * the anchor exists to point at.
 */
export function parseAnchor(spec: string): Anchor {
  const cut = spec.indexOf(':');
  if (cut <= 0) throw new TypeError(`an anchor needs <class>:<ref>, got ${JSON.stringify(spec)}`);
  const type = spec.slice(0, cut);
  const ref = spec.slice(cut + 1).trim();
  if (!ANCHOR_SET.has(type)) {
    throw new TypeError(`unknown anchor class ${JSON.stringify(type)}; one of ${ANCHOR_CLASSES.join(', ')}`);
  }
  if (!ref) throw new TypeError(`anchor ${type} has no ref`);
  return { type: type as AnchorClass, ref };
}

/**
 * `<type>:<role>[:<ref>]` — role comes second so the variable-length ref is
 * last and may contain colons.
 */
export function parseInfluence(spec: string): Influence {
  const first = spec.indexOf(':');
  if (first <= 0) throw new TypeError(`an influence needs <type>:<role>[:<ref>], got ${JSON.stringify(spec)}`);
  const type = spec.slice(0, first);
  const rest = spec.slice(first + 1);
  const second = rest.indexOf(':');
  const role = second === -1 ? rest : rest.slice(0, second);
  const ref = second === -1 ? '' : rest.slice(second + 1).trim();

  if (!TYPE_SET.has(type)) {
    throw new TypeError(`unknown influence type ${JSON.stringify(type)}; one of ${INFLUENCE_TYPES.join(', ')}`);
  }
  if (!ROLE_SET.has(role)) {
    throw new TypeError(`unknown influence role ${JSON.stringify(role)}; one of ${INFLUENCE_ROLES.join(', ')}`);
  }
  if (type === 'model_knowledge') {
    return ref ? { type, role: role as InfluenceRole, ref } : { type, role: role as InfluenceRole };
  }
  if (!ref) throw new TypeError(`influence ${type} has no ref; only model_knowledge may omit one`);
  return { type: type as InfluenceType, role: role as InfluenceRole, ref };
}

/** Spec 5.6 and 5.7, verbatim. A kind carries its own fields and no other's. */
export const KIND_FIELDS: Readonly<Record<string, readonly string[]>> = {
  decision: ['question', 'chosen', 'rejected', 'rationale', 'reversibility', 'blastRadius', 'confidence'],
  finding: ['claim', 'evidence', 'premise', 'scope'],
  assumption: ['assumed', 'ifWrong', 'checked'],
  blocker: ['blocked', 'on', 'owner', 'clearedBy'],
  progress: ['did', 'next', 'externalRef'],
  constraint: ['statement', 'origin', 'scope', 'expiry', 'enforcement'],
};

/** Stored as arrays. A second `--rejected` used to discard the first. */
export const LIST_FIELDS: ReadonlySet<string> = new Set(['rejected', 'evidence', 'premise']);

/**
 * Keyed by kind, then field. `scope` exists on both `finding` and `constraint`
 * and means different things: 5.6 constrains a finding's reach to three values
 * so a machine-local fact cannot propagate as a universal one, while 5.7's
 * constraint scope is the subject an obligation covers and is free text. One
 * table keyed by field name alone would reject every real constraint.
 */
export const ENUM_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  decision: { reversibility: ['trivial', 'moderate', 'hard', 'one-way'] },
  assumption: { checked: ['yes', 'no'] },
  constraint: { enforcement: ['advisory', 'blocking'] },
  finding: { scope: ['machine', 'workspace', 'general'] },
};

/**
 * An unrecognised kind gets no fields rather than a guess. `?? []` alone is
 * not enough: `KIND_FIELDS[kind]` reaches the prototype chain for keys like
 * 'constructor', 'toString' or '__proto__', returning a function or
 * Object.prototype itself rather than undefined — a value `??` never catches
 * and that breaks the `readonly string[]` this function promises to return.
 * Same ownership check as the CLI's own known/unknown gate, so the two agree
 * on which kinds are "known".
 */
export function fieldsFor(kind: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(KIND_FIELDS, kind) ? KIND_FIELDS[kind]! : [];
}

/**
 * Build an entry's `data` from the values a caller supplied per field. Absent
 * stays absent: a field nobody set must not appear as '' or [], both of which
 * read as "assessed, nothing there".
 */
export function normalizeEntryData(
  kind: string,
  given: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsFor(kind)) {
    const raw = given.get(field);
    if (!raw || raw.length === 0) continue;
    // Empty or whitespace-only is "not supplied", not a value: `--rationale ""`
    // must not write `"rationale":""`, the assessed-and-empty claim this design
    // forbids. Filtered before the enum check too, so `--checked ""` reads as
    // absent rather than a bogus enum-membership failure.
    const values = raw.filter((v) => v.trim() !== '');
    if (values.length === 0) continue;
    const allowed = ENUM_FIELDS[kind]?.[field];
    if (allowed) {
      for (const v of values) {
        if (!allowed.includes(v)) {
          throw new TypeError(`--${field} must be one of ${allowed.join(', ')}, got ${JSON.stringify(v)}`);
        }
      }
    }
    out[field] = LIST_FIELDS.has(field) ? [...values] : values[values.length - 1];
  }
  return out;
}
