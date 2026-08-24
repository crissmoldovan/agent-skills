export type HermesDelegationState =
  | 'created'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'lost';

export type HermesLifecycleInputKind = 'created' | 'activity' | 'state_changed' | 'snapshot_reconciled';

export interface HermesLifecycleInput {
  readonly kind: HermesLifecycleInputKind;
  readonly childId: string;
  readonly sessionId: string;
  readonly state: HermesDelegationState;
  readonly observedAt: string;
  readonly currentTool?: string;
  readonly activity?: string;
  readonly parentId?: string;
  readonly model?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly duration?: string;
  readonly tokens?: string;
  readonly files?: string;
  readonly outputTail?: string;
}

export interface HermesDelegationProjection {
  readonly childId: string;
  readonly sessionId: string;
  readonly state: HermesDelegationState;
  readonly observedAt: string;
  readonly currentTool?: string;
  readonly activity?: string;
}

export interface HermesReconciliationIntent {
  readonly kind: 'correct_projection';
  readonly childId: string;
  readonly sessionId: string;
  readonly from: HermesDelegationState;
  readonly to: HermesDelegationState;
  readonly reason: 'authoritative_snapshot';
}

export interface HermesStaleDelegationIntent {
  readonly kind: 'mark_stale_unknown';
  readonly childId: string;
  readonly sessionId: string;
  readonly from: HermesDelegationState;
  readonly reason: 'complete_snapshot_missing';
}

export interface HermesReconciliationOptions {
  readonly missingGraceSnapshots?: number;
  readonly consecutiveCompleteMisses?: Readonly<Record<string, number>>;
}

export type HermesReconciliationIntentResult = HermesReconciliationIntent | HermesStaleDelegationIntent;

interface HermesEventRecord {
  readonly type: string;
  readonly child_id?: unknown;
  readonly subagent_id?: unknown;
  readonly session_id?: unknown;
  readonly child_session_id?: unknown;
  readonly parent_id?: unknown;
  readonly observed_at: unknown;
  readonly tool_name?: unknown;
  readonly tool?: unknown;
  readonly activity?: unknown;
  readonly goal?: unknown;
  readonly model?: unknown;
  readonly status?: unknown;
  readonly summary?: unknown;
  readonly duration?: unknown;
  readonly tokens?: unknown;
  readonly files?: unknown;
  readonly output_tail?: unknown;
}

interface HermesStatusRecord {
  readonly child_id: unknown;
  readonly session_id: unknown;
  readonly status: unknown;
  readonly current_tool?: unknown;
  readonly activity?: unknown;
}

interface HermesStatusSnapshot {
  readonly observedAt: unknown;
  readonly delegations: readonly HermesStatusRecord[];
  readonly complete?: unknown;
}

export type HermesSnapshotReason = 'session_open' | 'reconnect' | 'periodic';

export interface HermesDelegationReconciler {
  sessionOpened(): Promise<void>;
  reconnected(): Promise<void>;
  reconcileIfDue(): Promise<boolean>;
}

export function createHermesDelegationReconciler(options: {
  readonly clock: () => number;
  readonly intervalMs: number;
  readonly fetchStatus: (reason: HermesSnapshotReason) => Promise<HermesStatusSnapshot>;
  readonly current?: () => readonly HermesDelegationProjection[];
  readonly onReconciled?: (result: { readonly inputs: readonly HermesLifecycleInput[]; readonly intents: readonly HermesReconciliationIntentResult[] }) => void;
}): HermesDelegationReconciler {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) throw new TypeError('intervalMs must be a positive finite number');
  let lastReconciledAt = options.clock();
  let inFlight: Promise<void> | undefined;
  const consecutiveCompleteMisses: Record<string, number> = {};
  const reconcile = (reason: HermesSnapshotReason): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const snapshot = await options.fetchStatus(reason);
      const current = options.current?.() ?? [];
      const result = reconcileHermesDelegationStatus(snapshot, current, { consecutiveCompleteMisses });
      updateCompleteMisses(snapshot, current, consecutiveCompleteMisses);
      options.onReconciled?.(result);
      lastReconciledAt = options.clock();
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return {
    sessionOpened: () => reconcile('session_open'),
    reconnected: () => reconcile('reconnect'),
    async reconcileIfDue(): Promise<boolean> {
      if (options.clock() - lastReconciledAt < options.intervalMs) return false;
      await reconcile('periodic');
      return true;
    },
  };
}

export function normalizeHermesDelegationEvent(value: HermesEventRecord): HermesLifecycleInput {
  const base: HermesLifecycleInput = {
    childId: requiredText(value.child_id ?? value.subagent_id, 'child_id'),
    sessionId: requiredText(value.session_id ?? value.child_session_id, 'session_id'),
    observedAt: requiredTimestamp(value.observed_at),
    kind: eventKind(value.type),
    state: eventState(value.type, value.status),
  };
  return withEventDetails(base, value);
}

export function reconcileHermesDelegationStatus(
  snapshot: HermesStatusSnapshot,
  current: readonly HermesDelegationProjection[],
  options: HermesReconciliationOptions = {},
): { readonly inputs: readonly HermesLifecycleInput[]; readonly intents: readonly HermesReconciliationIntentResult[] } {
  const observedAt = requiredTimestamp(snapshot.observedAt);
  const currentByDelegationKey = new Map(current.map((input) => [delegationKey(input.childId, input.sessionId), input]));
  const snapshotDelegationKeys = new Set<string>();
  const inputs: HermesLifecycleInput[] = [];
  const intents: HermesReconciliationIntentResult[] = [];

  for (const delegation of snapshot.delegations) {
    const childId = requiredText(delegation.child_id, 'child_id');
    const sessionId = requiredText(delegation.session_id, 'session_id');
    snapshotDelegationKeys.add(delegationKey(childId, sessionId));
    const state = normalizeStatus(delegation.status);
    const input = withDetails({
      kind: 'snapshot_reconciled',
      childId,
      sessionId,
      state,
      observedAt,
    }, optionalText(delegation.current_tool), optionalText(delegation.activity));
    const previous = currentByDelegationKey.get(delegationKey(childId, sessionId));
    const isCurrentActivity = previous?.state === state && isRunningState(state);
    if ((snapshot.complete === true || snapshot.complete !== true && isCurrentActivity)
      && (!previous || !sameProjection(previous, input))) inputs.push(input);
    if (snapshot.complete === true && previous && previous.state !== state) {
      intents.push({ kind: 'correct_projection', childId, sessionId, from: previous.state, to: state, reason: 'authoritative_snapshot' });
    }
  }

  if (snapshot.complete === true) {
    const grace = options.missingGraceSnapshots ?? 2;
    if (!Number.isInteger(grace) || grace < 1) throw new TypeError('missingGraceSnapshots must be a positive integer');
    for (const projection of current) {
      if (snapshotDelegationKeys.has(delegationKey(projection.childId, projection.sessionId)) || !isRunningState(projection.state)) continue;
      const misses = (options.consecutiveCompleteMisses?.[delegationKey(projection.childId, projection.sessionId)] ?? 0) + 1;
      if (misses >= grace) intents.push({
        kind: 'mark_stale_unknown', childId: projection.childId, sessionId: projection.sessionId, from: projection.state, reason: 'complete_snapshot_missing',
      });
    }
  }
  return { inputs, intents };
}

function updateCompleteMisses(
  snapshot: HermesStatusSnapshot,
  current: readonly HermesDelegationProjection[],
  misses: Record<string, number>,
): void {
  if (snapshot.complete !== true) return;
  const present = new Set(snapshot.delegations.map((delegation) => delegationKey(
    requiredText(delegation.child_id, 'child_id'), requiredText(delegation.session_id, 'session_id'),
  )));
  for (const projection of current) {
    if (!isRunningState(projection.state)) continue;
    const key = delegationKey(projection.childId, projection.sessionId);
    if (present.has(key)) delete misses[key];
    else misses[key] = (misses[key] ?? 0) + 1;
  }
}

function delegationKey(childId: string, sessionId: string): string {
  return `${childId}\u0000${sessionId}`;
}

function isRunningState(state: HermesDelegationState): boolean {
  return state === 'created' || state === 'starting' || state === 'running' || state === 'waiting';
}

function eventKind(type: string): HermesLifecycleInputKind {
  if (type === 'subagent.spawn_requested') return 'created';
  if (type === 'subagent.start') return 'state_changed';
  if (type === 'subagent.thinking' || type === 'subagent.tool' || type === 'subagent.tool.started' || type === 'subagent.progress') return 'activity';
  if (type === 'subagent.complete') return 'state_changed';
  throw new TypeError(`Unsupported Hermes delegation event: ${type}`);
}

function eventState(type: string, status: unknown): HermesDelegationState {
  if (type === 'subagent.spawn_requested') return 'created';
  if (type === 'subagent.start' || type === 'subagent.thinking' || type === 'subagent.tool' || type === 'subagent.tool.started' || type === 'subagent.progress') return 'running';
  if (type === 'subagent.complete') return status === undefined ? 'completed' : normalizeStatus(status);
  throw new TypeError(`Unsupported Hermes delegation event: ${type}`);
}

function normalizeStatus(value: unknown): HermesDelegationState {
  const status = requiredText(value, 'status');
  if (status === 'pending') return 'created';
  if (status === 'starting') return 'starting';
  if (status === 'active' || status === 'running') return 'running';
  if (status === 'waiting') return 'waiting';
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  throw new TypeError(`Unsupported Hermes delegation status: ${status}`);
}

function sameProjection(left: HermesDelegationProjection, right: HermesDelegationProjection): boolean {
  return left.sessionId === right.sessionId
    && left.state === right.state
    && left.currentTool === right.currentTool
    && left.activity === right.activity;
}

function withEventDetails(base: HermesLifecycleInput, event: HermesEventRecord): HermesLifecycleInput {
  const activity = optionalText(event.activity) ?? optionalText(event.goal);
  return {
    ...withDetails(base, optionalText(event.tool_name) ?? optionalText(event.tool), activity),
    ...optionalDetail('parentId', event.parent_id),
    ...optionalDetail('model', event.model),
    ...optionalDetail('status', event.status),
    ...optionalDetail('summary', event.summary),
    ...optionalDetail('duration', event.duration),
    ...optionalDetail('tokens', event.tokens),
    ...optionalDetail('files', event.files),
    ...optionalDetail('outputTail', event.output_tail),
  };
}

function optionalDetail<Key extends Exclude<keyof HermesLifecycleInput, keyof HermesDelegationProjection>>(key: Key, value: unknown): Pick<HermesLifecycleInput, Key> {
  const detail = optionalText(value);
  return detail === undefined ? {} as Pick<HermesLifecycleInput, Key> : { [key]: detail } as Pick<HermesLifecycleInput, Key>;
}

function withDetails(base: HermesLifecycleInput, currentTool: string | undefined, activity: string | undefined): HermesLifecycleInput {
  return {
    ...base,
    ...(currentTool === undefined ? {} : { currentTool }),
    ...(activity === undefined ? {} : { activity }),
  };
}

function requiredTimestamp(value: unknown): string {
  const timestamp = requiredText(value, 'observed_at');
  if (Number.isNaN(Date.parse(timestamp))) throw new TypeError('observed_at must be an ISO date-time');
  return timestamp;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredText(value, 'text');
}
