export type Author = 'agent' | 'human';
export type Provenance = 'hook' | 'cli' | 'http' | 'mcp' | 'transcript';
export type Capability = 'known' | 'unknown';

export const ANCHOR_CLASSES = [
  'commit', 'file', 'environment', 'visual', 'runtime', 'tool_use', 'message', 'url', 'external',
] as const;
export type AnchorClass = (typeof ANCHOR_CLASSES)[number];
export type Capabilities = Record<AnchorClass, Capability>;

export interface JournalEvent {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly source: string;
  readonly sourceEpoch: string;
  readonly sequence?: number;
  readonly time: string;
  readonly workspace: string;
  readonly session: string;
  readonly agent: string;
  readonly author: Author;
  readonly provenance: Provenance;
  readonly harness: string;
  readonly context: string;
  readonly capabilities: Capabilities;
  readonly kind: string;
  readonly subject?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

const AUTHORS = new Set<string>(['agent', 'human']);
const PROVENANCES = new Set<string>(['hook', 'cli', 'http', 'mcp', 'transcript']);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new TypeError(`${field} is required`);
  return v.trim();
}

function timestamp(v: unknown, field: string): string {
  const s = text(v, field);
  if (!RFC3339.test(s) || Number.isNaN(Date.parse(s))) {
    throw new TypeError(`${field} must be RFC3339 UTC`);
  }
  return s;
}

/** Omitted anchor classes resolve to `unknown`. Never infer an optimistic default. */
export function normalizeCapabilities(v: unknown): Capabilities {
  const given = isRecord(v) ? v : {};
  const out = {} as Record<AnchorClass, Capability>;
  for (const cls of ANCHOR_CLASSES) out[cls] = given[cls] === 'known' ? 'known' : 'unknown';
  return out;
}

export function normalizeEvent(value: unknown): JournalEvent {
  if (!isRecord(value)) throw new TypeError('event must be an object');
  if (value.schemaVersion !== 1) throw new TypeError('schemaVersion must be 1');

  const author = text(value.author, 'author');
  if (!AUTHORS.has(author)) throw new TypeError(`author must be agent or human, got ${author}`);

  const provenance = text(value.provenance, 'provenance');
  if (!PROVENANCES.has(provenance)) throw new TypeError(`provenance is not recognised: ${provenance}`);

  let sequence: number | undefined;
  if (value.sequence !== undefined) {
    if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
      throw new TypeError('sequence must be a non-negative integer');
    }
    sequence = value.sequence as number;
  }

  if (value.data !== undefined && !isRecord(value.data)) throw new TypeError('data must be an object');

  return {
    schemaVersion: 1,
    id: text(value.id, 'id'),
    source: text(value.source, 'source'),
    sourceEpoch: text(value.sourceEpoch, 'sourceEpoch'),
    ...(sequence === undefined ? {} : { sequence }),
    time: timestamp(value.time, 'time'),
    workspace: text(value.workspace, 'workspace'),
    session: text(value.session, 'session'),
    agent: text(value.agent, 'agent'),
    author: author as Author,
    provenance: provenance as Provenance,
    harness: text(value.harness, 'harness'),
    context: text(value.context, 'context'),
    capabilities: normalizeCapabilities(value.capabilities),
    kind: text(value.kind, 'kind'),
    ...(value.subject === undefined ? {} : { subject: text(value.subject, 'subject') }),
    data: isRecord(value.data) ? value.data : {},
  };
}

/**
 * Spec 4.3 says preserve `unknown` rather than inferring optimistic defaults.
 * An anchor is not optimism — it is the evidence itself, so the class it cites
 * becomes `known`. Without this an entry cites a commit while its own
 * capability table reports commits unavailable here, which is the table lying
 * by omission in the one direction the rule exists to prevent. Nothing is ever
 * downgraded: a declared `known` with no anchor stays `known`.
 */
export function capabilitiesWithAnchors(
  base: Capabilities,
  anchors: readonly { readonly type: AnchorClass; readonly ref?: string }[],
): Capabilities {
  const out = { ...base };
  for (const a of anchors) out[a.type] = 'known';
  return out;
}
