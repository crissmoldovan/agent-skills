/** Spec 4.4's observation kinds, in the order the spec lists them. */
export const OBSERVATION_KINDS = [
  'session_start', 'session_end', 'turn_end', 'tool_call', 'tool_result', 'tool_failure',
  'permission', 'subagent_start', 'subagent_stop', 'compact', 'heartbeat', 'environment',
  'path_claim', 'void',
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** What each kind carries. `environment` and `path_claim` are populated by their
 *  own capture paths; `void` is written by the failure path and never by a caller. */
export const OBSERVATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  session_start: ['harness', 'cwd', 'branch'],
  session_end: ['reason'],
  turn_end: ['turn'],
  tool_call: ['tool', 'input', 'callId'],
  tool_result: ['tool', 'callId', 'summary'],
  tool_failure: ['tool', 'callId', 'error'],
  permission: ['tool', 'decision'],
  subagent_start: ['agentId', 'purpose'],
  subagent_stop: ['agentId', 'status'],
  compact: ['reason'],
  heartbeat: [],
  environment: ['interpreter', 'version', 'platform', 'packageManager', 'flags'],
  path_claim: ['checkout', 'worktree', 'branch', 'ttlSeconds'],
  void: [],
};

/**
 * An unrecognised kind gets no fields rather than a guess. `?? []` alone is
 * not enough: `OBSERVATION_FIELDS[kind]` reaches the prototype chain for keys
 * like 'constructor', 'toString' or '__proto__', returning a function or
 * Object.prototype itself rather than undefined — a value `??` never catches.
 * Same ownership check `entry.ts`'s `fieldsFor` uses, for the same reason.
 */
export function fieldsForObservation(kind: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(OBSERVATION_FIELDS, kind)
    ? OBSERVATION_FIELDS[kind]!
    : [];
}

/**
 * Build an observation's `data`. Absent stays absent, and a blank value counts as
 * absent — the same rule entries follow, for the same reason: `''` claims
 * assessed-and-empty where nothing was assessed.
 */
export function normalizeObservationData(
  kind: string,
  given: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsForObservation(kind)) {
    const values = given.get(field);
    if (!values || values.length === 0) continue;
    const last = values[values.length - 1]!;
    if (!last.trim()) continue;
    out[field] = last.trim();
  }
  return out;
}
