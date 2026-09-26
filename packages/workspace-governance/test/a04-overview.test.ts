import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkspaceOverview,
  type CatalogDocument,
  type Inventory,
  type RemoteInventory,
} from "../src/index.ts";

const observedAt = "2026-09-14T12:30:00.000Z";

const catalog: CatalogDocument = {
  schemaVersion: 2,
  documentType: "workspacectl/catalog",
  groups: [
    { id: "org-cue", kind: "organization", name: "CUE++", slug: "cue", parentId: null, metadata: {} },
    { id: "org-rgc", kind: "organization", name: "RGC", slug: "rgc", parentId: null, metadata: {} },
  ],
  sources: [
    {
      id: "source-org",
      provider: "github",
      owner: "Synthetic-Org",
      ownerType: "organization",
      include: [],
      exclude: ["excluded"],
      proposedDefaultGroupId: "org-cue",
      metadata: {},
    },
    {
      id: "source-user",
      provider: "github",
      owner: "Synthetic-User",
      ownerType: "user",
      include: ["wanted"],
      exclude: [],
      proposedDefaultGroupId: "org-rgc",
      metadata: {},
    },
  ],
  repositories: [
    {
      id: "repo-service",
      remote: "https://github.com/Synthetic-Org/service",
      sourceId: "source-org",
      primaryGroupId: "org-cue",
      memberOf: [],
      aliases: ["service"],
      classification: "confirmed",
      metadata: {},
    },
    {
      id: "repo-wanted",
      remote: "https://github.com/Synthetic-User/wanted",
      sourceId: "source-user",
      primaryGroupId: "org-rgc",
      memberOf: [],
      aliases: [],
      classification: "suggested",
      metadata: {},
    },
    {
      id: "repo-missing",
      remote: "https://github.com/Synthetic-Org/missing",
      sourceId: "source-org",
      primaryGroupId: null,
      memberOf: [],
      aliases: [],
      classification: "unclassified",
      metadata: {},
    },
  ],
  policies: [],
  workflows: [],
  metadata: {},
};

function remoteInventory(
  owner: string,
  ownerType: "organization" | "user",
  repositories: RemoteInventory["repositories"],
): RemoteInventory {
  const user = ownerType === "user";
  return {
    provider: "github",
    owner,
    ownerType,
    observedAt,
    complete: !user,
    coverage: {
      status: user ? "partial" : "complete",
      scope: "credential-visible",
      absenceAuthoritative: false,
      privateVisibility: user ? "unavailable" : "observed",
      endpoint: ownerType,
      pages: { requested: 1, completed: 1, max: 100, nextPage: null, truncated: false },
      limitations: user
        ? ["PRIVATE_VISIBILITY_UNAVAILABLE_FOR_USER_ENDPOINT"]
        : ["PRIVATE_REPOSITORY_ABSENCE_NOT_AUTHORITATIVE"],
      errors: [],
    },
    counts: {
      received: repositories.length,
      private: repositories.filter((repository) => repository.private).length,
      archived: repositories.filter((repository) => repository.archived).length,
    },
    repositories,
  };
}

const local: Inventory = {
  root: "/synthetic/root",
  complete: true,
  errors: [],
  occupiedPaths: [],
  unsafePaths: [],
  repositories: [
    {
      path: "/synthetic/root/service-a",
      remote: "https://github.com/synthetic-org/service",
      head: "1".repeat(40),
      dirty: false,
      worktree: false,
      status: "",
    },
    {
      path: "/synthetic/root/service-b",
      remote: "https://github.com/synthetic-org/service",
      head: "1".repeat(40),
      dirty: false,
      worktree: false,
      status: "",
    },
    {
      path: "/synthetic/root/service-task",
      remote: "https://github.com/synthetic-org/service",
      head: "2".repeat(40),
      dirty: true,
      worktree: true,
      status: " M tracked.txt\n",
    },
    {
      path: "/synthetic/root/wanted",
      remote: "https://github.com/synthetic-user/wanted",
      head: "3".repeat(40),
      dirty: false,
      worktree: false,
      status: "",
    },
  ],
};

test("A04 one overview keeps approved, suggested, observed-only, duplicate, worktree, archive and missing facts distinct", () => {
  const overview = buildWorkspaceOverview({
    catalog,
    revisions: {
      config: `sha256:${"a".repeat(64)}`,
      catalog: `sha256:${"b".repeat(64)}`,
      localState: `sha256:${"c".repeat(64)}`,
    },
    observedAt,
    selection: {
      sourceIds: ["source-org", "source-user"],
      roots: [local.root],
      depth: 8,
      maxPages: 100,
      transient: true,
    },
    remote: [
      {
        sourceId: "source-org",
        inventory: remoteInventory("Synthetic-Org", "organization", [
          { remote: "https://github.com/synthetic-org/service", id: 1, archived: false, private: false },
          { remote: "https://github.com/synthetic-org/archive", id: 2, archived: true, private: true },
          { remote: "https://github.com/synthetic-org/excluded", id: 3, archived: false, private: false },
        ]),
      },
      {
        sourceId: "source-user",
        inventory: remoteInventory("Synthetic-User", "user", [
          { remote: "https://github.com/synthetic-user/wanted", id: 4, archived: false, private: false },
          { remote: "https://github.com/synthetic-user/not-selected", id: 5, archived: false, private: false },
        ]),
      },
    ],
    local: [{ observedAt, inventory: local }],
  });

  assert.equal(overview.readOnly, true);
  assert.equal(overview.coverage.status, "partial");
  assert.equal(overview.coverage.sources[0].counts.received, 3);
  assert.equal(overview.coverage.sources[0].counts.selected, 2);
  assert.equal(overview.coverage.sources[0].counts.excluded, 1);
  assert.equal(overview.coverage.sources[1].counts.selected, 1);
  assert.equal(overview.repositories.length, 4);

  const byIdentity = new Map(overview.repositories.map((repository) => [repository.identity, repository]));
  const service = byIdentity.get("https://github.com/synthetic-org/service")!;
  assert.equal(service.id, "repo-service");
  assert.equal(service.catalogStatus, "registered");
  assert.equal(service.grouping.classification, "confirmed");
  assert.equal(service.grouping.approvedPrimaryGroup?.name, "CUE++");
  assert.equal(service.grouping.suggestedPrimaryGroup, null);
  assert.equal(service.checkout.state, "duplicate");
  assert.equal(service.checkout.standaloneDuplicates, 2);
  assert.equal(service.checkout.checkouts.filter((checkout) => checkout.kind === "worktree").length, 1);
  assert.equal(service.checkout.selected, null);

  const wanted = byIdentity.get("https://github.com/synthetic-user/wanted")!;
  assert.equal(wanted.grouping.classification, "suggested");
  assert.equal(wanted.grouping.approvedPrimaryGroup, null);
  assert.equal(wanted.grouping.suggestedPrimaryGroup?.name, "RGC");
  assert.equal(wanted.checkout.state, "present");

  const missing = byIdentity.get("https://github.com/synthetic-org/missing")!;
  assert.equal(missing.checkout.state, "missing");
  assert.equal(missing.grouping.classification, "unclassified");

  const archive = byIdentity.get("https://github.com/synthetic-org/archive")!;
  assert.equal(archive.catalogStatus, "observed-only");
  assert.equal(archive.grouping.classification, "unclassified");
  assert.equal(archive.archived, true);
  assert.equal(archive.visibility, "private");
  assert.equal(archive.grouping.suggestions[0].group.name, "CUE++");
  assert.match(archive.id, /^observation-[a-f0-9]{24}$/);

  assert.equal(byIdentity.has("https://github.com/synthetic-org/excluded"), false);
  assert.equal(byIdentity.has("https://github.com/synthetic-user/not-selected"), false);
  assert.deepEqual(overview.summary, {
    catalogRepositories: 3,
    observedOnlyRepositories: 1,
    repositories: 4,
    remoteObserved: 3,
    localCheckouts: 4,
    present: 1,
    duplicate: 1,
    missing: 2,
    unknown: 0,
    archived: 1,
    confirmed: 1,
    suggested: 1,
    unclassified: 2,
    findings: overview.findings.length,
  });
  assert.ok(overview.findings.some((finding) => finding.code === "COVERAGE_INCOMPLETE"));
  assert.ok(overview.findings.some((finding) => finding.code === "DUPLICATE_CHECKOUT"));
  assert.ok(overview.findings.some((finding) => finding.code === "INTENTIONAL_WORKTREE"));
  assert.ok(overview.findings.some((finding) => finding.code === "ARCHIVED_REPOSITORY"));
  assert.ok(overview.findings.some((finding) => finding.code === "SUGGESTION_REVIEW"));
});
