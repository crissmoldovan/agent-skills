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
