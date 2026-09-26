import { canonicalRemote, digest, requireThat } from "./core.ts";
import { validateCatalogDocument } from "./v2-model.ts";
import type {
  CatalogDocument,
  GroupRecord,
  RepositoryRecord,
  SourceRecord,
} from "./v2-model.ts";
import type {
  CoverageStatus,
  Inventory,
  RemoteInventory,
  RepositoryObservation,
} from "./discovery.ts";

export interface OverviewSelection {
  sourceIds: string[];
  roots: string[];
  depth: number;
  maxPages: number;
  transient: true;
}

export interface OverviewRevisions {
  config: string;
  catalog: string;
  localState: string;
}

export interface GroupView {
  id: string;
  kind: GroupRecord["kind"];
  name: string;
  slug: string;
  parentId: string | null;
}

export interface SourceCoverageView extends Omit<RemoteInventory["coverage"], "endpoint"> {
  sourceId: string;
  owner: string;
  ownerType: SourceRecord["ownerType"];
  endpoint: RemoteInventory["coverage"]["endpoint"];
  observedAt: string;
  filters: {
    include: string[];
    exclude: string[];
  };
  counts: RemoteInventory["counts"] & {
    selected: number;
    excluded: number;
  };
}

export interface LocalCoverageView {
  root: string;
  observedAt: string;
  status: CoverageStatus;
  complete: boolean;
  errors: Inventory["errors"];
  counts: {
    repositories: number;
    standalone: number;
    worktrees: number;
    dirty: number;
  };
}

export interface CheckoutView {
  path: string;
  kind: "standalone" | "worktree";
  head: string | null;
  dirty: boolean;
  remoteAvailable: boolean;
}

export interface WorkspaceRepositoryView {
  id: string;
  identity: string;
  catalogStatus: "registered" | "observed-only";
  remote: string | null;
  sourceId: string | null;
  primaryGroupId: string | null;
  memberOf: string[];
  aliases: string[];
  classification: RepositoryRecord["classification"];
  metadata: RepositoryRecord["metadata"];
  workspaceState: "present" | "duplicate" | "missing" | "unknown";
  grouping: {
    classification: RepositoryRecord["classification"];
    approvedPrimaryGroup: GroupView | null;
    suggestedPrimaryGroup: GroupView | null;
    memberOf: GroupView[];
    suggestions: Array<{
      kind: "source-default";
      sourceId: string;
      group: GroupView;
    }>;
  };
  observedSourceIds: string[];
  sourceObservations: Array<{
    sourceId: string;
    providerId: number;
    private: boolean;
    archived: boolean;
  }>;
  archived: boolean | null;
  visibility: "private" | "public" | "unknown";
  checkout: {
    state: WorkspaceRepositoryView["workspaceState"];
    selected: null;
    standaloneDuplicates: number;
    checkouts: CheckoutView[];
  };
}

export interface OverviewFinding {
  code:
    | "COVERAGE_INCOMPLETE"
    | "UNCLASSIFIED_REPOSITORY"
    | "SUGGESTION_REVIEW"
    | "DUPLICATE_CHECKOUT"
    | "INTENTIONAL_WORKTREE"
    | "DIRTY_CHECKOUT"
    | "ARCHIVED_REPOSITORY"
    | "MISSING_CHECKOUT"
    | "CHECKOUT_UNKNOWN"
    | "REMOTE_UNAVAILABLE";
  severity: "info" | "warning" | "decision";
  subject: string;
  detail: string;
}

export interface WorkspaceOverview {
  schemaVersion: 2;
  format: "workspacectl-overview/1";
  readOnly: true;
  observedAt: string;
  revisions: OverviewRevisions;
  selection: OverviewSelection;
  coverage: {
    status: CoverageStatus;
    selected: boolean;
    sources: SourceCoverageView[];
    local: LocalCoverageView[];
  };
  groups: GroupView[];
  repositories: WorkspaceRepositoryView[];
  findings: OverviewFinding[];
  summary: {
    catalogRepositories: number;
    observedOnlyRepositories: number;
    repositories: number;
    remoteObserved: number;
    localCheckouts: number;
    present: number;
    duplicate: number;
    missing: number;
    unknown: number;
    archived: number;
    confirmed: number;
    suggested: number;
    unclassified: number;
    findings: number;
  };
}

export interface WorkspaceOverviewInput {
  catalog: CatalogDocument;
  revisions: OverviewRevisions;
  observedAt: string;
  selection: OverviewSelection;
  remote: Array<{ sourceId: string; inventory: RemoteInventory }>;
  local: Array<{
    observedAt: string;
    inventory: Inventory;
    status?: CoverageStatus;
  }>;
}

function groupView(group: GroupRecord): GroupView {
  return {
    id: group.id,
    kind: group.kind,
    name: group.name,
    slug: group.slug,
    parentId: group.parentId,
  };
}

function repositorySelector(remote: string): { name: string; fullName: string } {
  const parts = remote.slice("https://github.com/".length).split("/");
  return { name: parts[1].toLowerCase(), fullName: parts.join("/").toLowerCase() };
}

function selectorMatches(selector: string, remote: string): boolean {
  const normalized = selector.toLowerCase();
  const names = repositorySelector(remote);
  return normalized === names.name || normalized === names.fullName || normalized === remote;
}

function sourceIncludes(source: SourceRecord, remote: string): boolean {
  const included = source.include.length === 0 ||
    source.include.some((selector) => selectorMatches(selector, remote));
  return included && !source.exclude.some((selector) => selectorMatches(selector, remote));
}

function combinedCoverage(statuses: CoverageStatus[], selected: boolean): CoverageStatus {
  if (!selected) return "unknown";
  if (statuses.every((status) => status === "complete")) return "complete";
  if (statuses.every((status) => status === "unknown")) return "unknown";
  return "partial";
}

export function buildWorkspaceOverview(input: WorkspaceOverviewInput): WorkspaceOverview {
  const catalog = validateCatalogDocument(input.catalog);
  requireThat(
    typeof input.observedAt === "string" &&
      Number.isFinite(Date.parse(input.observedAt)) &&
      input.selection.transient === true &&
      Number.isInteger(input.selection.depth) &&
      input.selection.depth >= 0 &&
      input.selection.depth <= 32 &&
      Number.isInteger(input.selection.maxPages) &&
      input.selection.maxPages >= 1 &&
      input.selection.maxPages <= 100,
    "INVALID_CONFIG",
  );
  requireThat(new Set(input.selection.sourceIds).size === input.selection.sourceIds.length, "INVALID_CONFIG");
  requireThat(new Set(input.selection.roots).size === input.selection.roots.length, "INVALID_CONFIG");
  requireThat(input.remote.length === input.selection.sourceIds.length, "INVALID_CONFIG");
  requireThat(input.local.length === input.selection.roots.length, "INVALID_CONFIG");
  requireThat(
    input.local.every((entry, index) =>
      entry.inventory.root === input.selection.roots[index] &&
      typeof entry.observedAt === "string" &&
      Number.isFinite(Date.parse(entry.observedAt)) &&
      (entry.status === undefined || ["complete", "partial", "unknown"].includes(entry.status)) &&
      (entry.status !== "complete" || entry.inventory.complete) &&
      (entry.status !== "unknown" || (!entry.inventory.complete && entry.inventory.repositories.length === 0))
    ),
    "INVALID_CONFIG",
  );

  const groupsById = new Map(catalog.groups.map((group) => [group.id, group]));
  const sourcesById = new Map(catalog.sources.map((source) => [source.id, source]));
  const selectedSourceIds = new Set(input.selection.sourceIds);
  requireThat(
    new Set(input.remote.map((entry) => entry.sourceId)).size === input.remote.length,
    "INVALID_CONFIG",
  );

  const remoteByIdentity = new Map<
    string,
    Array<{ source: SourceRecord; id: number; private: boolean; archived: boolean }>
  >();
  const sourceCoverage: SourceCoverageView[] = [];
  for (const entry of input.remote) {
    const source = sourcesById.get(entry.sourceId);
    requireThat(
      source !== undefined &&
        selectedSourceIds.has(entry.sourceId) &&
        entry.inventory.owner === source.owner &&
        entry.inventory.ownerType === source.ownerType,
      "INVALID_CONFIG",
    );
    const selected = entry.inventory.repositories.filter((repository) =>
      sourceIncludes(source, repository.remote)
    );
    for (const repository of selected) {
      const identity = canonicalRemote(repository.remote);
      const observations = remoteByIdentity.get(identity) ?? [];
      observations.push({
        source,
        id: repository.id,
        private: repository.private,
        archived: repository.archived,
      });
      remoteByIdentity.set(identity, observations);
    }
    sourceCoverage.push({
      sourceId: source.id,
      owner: source.owner,
      ownerType: source.ownerType,
      endpoint: entry.inventory.coverage.endpoint,
      observedAt: entry.inventory.observedAt,
      status: entry.inventory.coverage.status,
      scope: entry.inventory.coverage.scope,
      absenceAuthoritative: false,
      privateVisibility: entry.inventory.coverage.privateVisibility,
      pages: structuredClone(entry.inventory.coverage.pages),
      limitations: [...entry.inventory.coverage.limitations],
      errors: structuredClone(entry.inventory.coverage.errors),
      filters: { include: [...source.include], exclude: [...source.exclude] },
      counts: {
        ...entry.inventory.counts,
        selected: selected.length,
        excluded: entry.inventory.repositories.length - selected.length,
      },
    });
  }

  const localCoverage: LocalCoverageView[] = input.local.map(({ observedAt, inventory, status }) => ({
    root: inventory.root,
    observedAt,
    status: status ?? (inventory.complete ? "complete" : "partial"),
    complete: inventory.complete,
    errors: structuredClone(inventory.errors),
    counts: {
      repositories: inventory.repositories.length,
      standalone: inventory.repositories.filter((repository) => !repository.worktree).length,
      worktrees: inventory.repositories.filter((repository) => repository.worktree).length,
      dirty: inventory.repositories.filter((repository) => repository.dirty).length,
    },
  }));
  const localByIdentity = new Map<string, RepositoryObservation[]>();
  const localWithoutRemote: RepositoryObservation[] = [];
  const localByPath = new Map<string, RepositoryObservation>();
  for (const { inventory } of input.local) {
    for (const repository of inventory.repositories) {
      const previous = localByPath.get(repository.path);
      if (previous === undefined) {
        localByPath.set(repository.path, repository);
        continue;
      }
      requireThat(
        previous.remote === repository.remote &&
          previous.head === repository.head &&
          previous.dirty === repository.dirty &&
          previous.worktree === repository.worktree &&
          previous.status === repository.status,
        "INVALID_CONFIG",
      );
    }
  }
  for (const repository of localByPath.values()) {
    if (repository.remote === null) {
      localWithoutRemote.push(repository);
      continue;
    }
    const identity = canonicalRemote(repository.remote);
    const observations = localByIdentity.get(identity) ?? [];
    observations.push(repository);
    localByIdentity.set(identity, observations);
  }

  const catalogByIdentity = new Map(
    catalog.repositories.map((repository) => [canonicalRemote(repository.remote), repository]),
  );
  const identities = [
    ...catalog.repositories.map((repository) => canonicalRemote(repository.remote)),
    ...[...remoteByIdentity.keys()].filter((identity) => !catalogByIdentity.has(identity)).sort(),
    ...[...localByIdentity.keys()]
      .filter((identity) => !catalogByIdentity.has(identity) && !remoteByIdentity.has(identity))
      .sort(),
  ];
  const uniqueIdentities = [...new Set(identities)];
  const allLocalCoverageComplete = input.local.length > 0 &&
    input.local.every(({ inventory }) => inventory.complete);

  const repositories: WorkspaceRepositoryView[] = uniqueIdentities.map((identity) => {
    const registered = catalogByIdentity.get(identity);
    const remoteObservations = remoteByIdentity.get(identity) ?? [];
    const localObservations = (localByIdentity.get(identity) ?? []).sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    );
    const standalone = localObservations.filter((observation) => !observation.worktree);
    const state: WorkspaceRepositoryView["workspaceState"] = standalone.length > 1
      ? "duplicate"
      : localObservations.length > 0
        ? "present"
        : allLocalCoverageComplete
          ? "missing"
          : "unknown";
    const primary = registered?.primaryGroupId === null || registered?.primaryGroupId === undefined
      ? null
      : groupView(groupsById.get(registered.primaryGroupId)!);
    const classification = registered?.classification ?? "unclassified";
    const observedSources = [...new Set(remoteObservations.map(({ source }) => source.id))].sort();
    const suggestions = remoteObservations
      .filter(({ source }) => source.proposedDefaultGroupId !== null)
      .map(({ source }) => ({
        kind: "source-default" as const,
        sourceId: source.id,
        group: groupView(groupsById.get(source.proposedDefaultGroupId!)!),
      }))
      .filter((suggestion, index, values) =>
        values.findIndex((candidate) =>
          candidate.sourceId === suggestion.sourceId && candidate.group.id === suggestion.group.id
        ) === index &&
        !(classification === "confirmed" && primary?.id === suggestion.group.id)
      );
    const id = registered?.id ?? `observation-${digest(identity).slice(0, 24)}`;
    const checkoutViews = localObservations.map((observation): CheckoutView => ({
      path: observation.path,
      kind: observation.worktree ? "worktree" : "standalone",
      head: observation.head,
      dirty: observation.dirty,
      remoteAvailable: observation.remote !== null,
    }));
    return {
      id,
      identity,
      catalogStatus: registered === undefined ? "observed-only" : "registered",
      remote: identity,
      sourceId: registered?.sourceId ?? null,
      primaryGroupId: registered?.primaryGroupId ?? null,
      memberOf: [...(registered?.memberOf ?? [])],
      aliases: [...(registered?.aliases ?? [])],
      classification,
      metadata: structuredClone(registered?.metadata ?? {}),
      workspaceState: state,
      grouping: {
        classification,
        approvedPrimaryGroup: classification === "confirmed" ? primary : null,
        suggestedPrimaryGroup: classification === "suggested" ? primary : null,
        memberOf: (registered?.memberOf ?? []).map((groupId) => groupView(groupsById.get(groupId)!)),
        suggestions,
      },
      observedSourceIds: observedSources,
      sourceObservations: remoteObservations.map((observation) => ({
        sourceId: observation.source.id,
        providerId: observation.id,
        private: observation.private,
        archived: observation.archived,
      })),
      archived: remoteObservations.length === 0
        ? null
        : remoteObservations.some((observation) => observation.archived),
      visibility: remoteObservations.some((observation) => observation.private)
        ? "private"
        : remoteObservations.length > 0
          ? "public"
          : "unknown",
      checkout: {
        state,
        selected: null,
        standaloneDuplicates: standalone.length,
        checkouts: checkoutViews,
      },
    };
  });

  for (const observation of localWithoutRemote.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )) {
    const identity = `local-path:${digest(observation.path).slice(0, 24)}`;
    repositories.push({
      id: `observation-${digest(identity).slice(0, 24)}`,
      identity,
      catalogStatus: "observed-only",
      remote: null,
      sourceId: null,
      primaryGroupId: null,
      memberOf: [],
      aliases: [],
      classification: "unclassified",
      metadata: {},
      workspaceState: "present",
      grouping: {
        classification: "unclassified",
        approvedPrimaryGroup: null,
        suggestedPrimaryGroup: null,
        memberOf: [],
        suggestions: [],
      },
      observedSourceIds: [],
      sourceObservations: [],
      archived: null,
      visibility: "unknown",
      checkout: {
        state: "present",
        selected: null,
        standaloneDuplicates: observation.worktree ? 0 : 1,
        checkouts: [{
          path: observation.path,
          kind: observation.worktree ? "worktree" : "standalone",
          head: observation.head,
          dirty: observation.dirty,
          remoteAvailable: false,
        }],
      },
    });
  }

  const findings: OverviewFinding[] = [];
  for (const source of sourceCoverage) {
    if (source.status !== "complete") findings.push({
      code: "COVERAGE_INCOMPLETE",
      severity: "warning",
      subject: `source:${source.sourceId}`,
      detail: `GitHub ${source.ownerType} coverage is ${source.status}; absence is not authoritative.`,
    });
  }
  for (const local of localCoverage) {
    if (local.status !== "complete") findings.push({
      code: "COVERAGE_INCOMPLETE",
      severity: "warning",
      subject: `root:${local.root}`,
      detail: "Local coverage is incomplete; unmatched repositories remain unknown.",
    });
  }
  for (const repository of repositories) {
    if (repository.grouping.classification === "unclassified") findings.push({
      code: "UNCLASSIFIED_REPOSITORY",
      severity: "decision",
      subject: repository.identity,
      detail: "No approved business grouping is assigned.",
    });
    if (
      repository.grouping.classification === "suggested" ||
      repository.grouping.suggestions.length > 0
    ) findings.push({
      code: "SUGGESTION_REVIEW",
      severity: "decision",
      subject: repository.identity,
      detail: "A grouping suggestion is visible but not approved.",
    });
    if (repository.checkout.state === "duplicate") findings.push({
      code: "DUPLICATE_CHECKOUT",
      severity: "decision",
      subject: repository.identity,
      detail: `${repository.checkout.standaloneDuplicates} standalone checkouts were observed; none was selected as primary.`,
    });
    if (repository.checkout.checkouts.some((checkout) => checkout.kind === "worktree")) findings.push({
      code: "INTENTIONAL_WORKTREE",
      severity: "info",
      subject: repository.identity,
      detail: "An intentional Git worktree was observed separately from standalone clones.",
    });
    if (repository.checkout.checkouts.some((checkout) => checkout.dirty)) findings.push({
      code: "DIRTY_CHECKOUT",
      severity: "warning",
      subject: repository.identity,
      detail: "At least one observed checkout is dirty; discovery did not modify it.",
    });
    if (repository.archived === true) findings.push({
      code: "ARCHIVED_REPOSITORY",
      severity: "info",
      subject: repository.identity,
      detail: "GitHub reported this repository archived; no lifecycle action followed.",
    });
    if (repository.checkout.state === "missing") findings.push({
      code: "MISSING_CHECKOUT",
      severity: "decision",
      subject: repository.identity,
      detail: "No checkout was observed within the complete selected local roots.",
    });
    if (repository.checkout.state === "unknown") findings.push({
      code: "CHECKOUT_UNKNOWN",
      severity: "warning",
      subject: repository.identity,
      detail: "Selected local coverage cannot establish whether a checkout is missing.",
    });
    if (repository.remote === null) findings.push({
      code: "REMOTE_UNAVAILABLE",
      severity: "warning",
      subject: repository.identity,
      detail: "The local Git checkout remote identity was unavailable.",
    });
  }

  const selected = input.selection.sourceIds.length + input.selection.roots.length > 0;
  const statuses = [
    ...sourceCoverage.map((coverage) => coverage.status),
    ...localCoverage.map((coverage) => coverage.status),
  ];
  const countState = (state: WorkspaceRepositoryView["workspaceState"]) =>
    repositories.filter((repository) => repository.checkout.state === state).length;
  const countClassification = (classification: RepositoryRecord["classification"]) =>
    repositories.filter((repository) => repository.grouping.classification === classification).length;

  return {
    schemaVersion: 2,
    format: "workspacectl-overview/1",
    readOnly: true,
    observedAt: input.observedAt,
    revisions: structuredClone(input.revisions),
    selection: structuredClone(input.selection),
    coverage: {
      status: combinedCoverage(statuses, selected),
      selected,
      sources: sourceCoverage,
      local: localCoverage,
    },
    groups: catalog.groups.map(groupView),
    repositories,
    findings,
    summary: {
      catalogRepositories: catalog.repositories.length,
      observedOnlyRepositories: repositories.filter((repository) => repository.catalogStatus === "observed-only").length,
      repositories: repositories.length,
      remoteObserved: repositories.filter((repository) => repository.sourceObservations.length > 0).length,
      localCheckouts: repositories.reduce((total, repository) => total + repository.checkout.checkouts.length, 0),
      present: countState("present"),
      duplicate: countState("duplicate"),
      missing: countState("missing"),
      unknown: countState("unknown"),
      archived: repositories.filter((repository) => repository.archived === true).length,
      confirmed: countClassification("confirmed"),
      suggested: countClassification("suggested"),
      unclassified: countClassification("unclassified"),
      findings: findings.length,
    },
  };
}

export function renderWorkspaceOverview(
  command: "discover" | "list" | "report" | "audit",
  overview: WorkspaceOverview,
): string {
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  const lines = [
    `Workspace overview: ${command}`,
    `Coverage: ${overview.coverage.status} ` +
      `(${plural(overview.coverage.sources.length, "source")}, ` +
      `${plural(overview.coverage.local.length, "local root")})`,
    `Repositories: ${overview.summary.repositories} ` +
      `(${overview.summary.confirmed} confirmed, ${overview.summary.suggested} suggested, ` +
      `${overview.summary.unclassified} unclassified)`,
    `Checkouts: ${overview.summary.localCheckouts} ` +
      `(${overview.summary.present} present, ${overview.summary.duplicate} duplicate, ` +
      `${overview.summary.missing} missing, ${overview.summary.unknown} unknown)`,
    "Groups:",
  ];
  if (overview.groups.length === 0) lines.push("  (none)");
  for (const group of overview.groups)
    lines.push(`  - ${group.id}: ${group.name} (${group.kind})`);

  lines.push("Repositories:");
  if (overview.repositories.length === 0) lines.push("  (none)");
  for (const repository of overview.repositories) {
    const approved = repository.grouping.approvedPrimaryGroup?.name ?? "none";
    const suggested = [
      ...(repository.grouping.suggestedPrimaryGroup === null
        ? []
        : [repository.grouping.suggestedPrimaryGroup.name]),
      ...repository.grouping.suggestions.map((entry) => entry.group.name),
    ];
    lines.push(
      `  - [${repository.grouping.classification}] ${repository.id} ${repository.identity}; ` +
      `approved group ${approved}; suggested groups ${suggested.length === 0 ? "none" : [...new Set(suggested)].join(", ")}; ` +
      `checkout ${repository.checkout.state}; archived ${repository.archived === null ? "unknown" : repository.archived ? "yes" : "no"}; ` +
      `visibility ${repository.visibility}`,
    );
    for (const checkout of repository.checkout.checkouts)
      lines.push(
        `      ${checkout.kind} ${checkout.path}; head ${checkout.head ?? "unborn"}; ` +
        `dirty ${checkout.dirty ? "yes" : "no"}; remote ${checkout.remoteAvailable ? "available" : "unavailable"}`,
      );
  }

  lines.push("Coverage details:");
  if (overview.coverage.sources.length + overview.coverage.local.length === 0)
    lines.push("  (no source or local root selected; absence and checkout state are unknown)");
  for (const source of overview.coverage.sources) {
    lines.push(
      `  - source ${source.sourceId}: GitHub ${source.ownerType} ${source.owner}; ` +
      `${source.status}; pages ${source.pages.completed}/${source.pages.requested} completed/requested; ` +
      `${source.counts.selected} selected of ${source.counts.received} received; ` +
      `private visibility ${source.privateVisibility}; absence not authoritative`,
    );
    for (const error of source.errors)
      lines.push(`      ${error.code} at page ${error.page}`);
  }
  for (const local of overview.coverage.local) {
    lines.push(
      `  - root ${local.root}: ${local.status}; ${plural(local.counts.repositories, "repository", "repositories")}; ` +
      `${plural(local.counts.worktrees, "worktree")}; ${plural(local.counts.dirty, "dirty checkout")}`,
    );
    for (const error of local.errors)
      lines.push(`      ${error.code}: ${error.target}`);
  }

  lines.push("Findings:");
  if (overview.findings.length === 0) lines.push("  (none)");
  for (const finding of overview.findings)
    lines.push(`  - [${finding.severity}] ${finding.code} ${finding.subject}: ${finding.detail}`);
  lines.push("Read-only observation; no selections were persisted.");
  return lines.join("\n") + "\n";
}
