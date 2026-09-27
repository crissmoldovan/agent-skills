import test from "node:test";
import assert from "node:assert/strict";
import { convertV1Catalog } from "../src/v1-import.ts";

const classified = (): Record<string, any> => ({
  apiVersion: "workspace-governance/v1",
  authorityId: "synthetic-authority",
  metadata: { oldApproval: true, note: "historical only" },
  nodes: [
    {
      id: "legacy-user",
      kind: "user",
      label: "Legacy User",
      slug: "legacy-user",
      parentId: null,
      visibility: { mode: "public", readers: [] },
    },
    {
      id: "org-acme",
      kind: "domain",
      label: "Acme",
      slug: "acme",
      parentId: "legacy-user",
    },
    {
      id: "namespace-acme-github",
      kind: "namespace",
      label: "acme-github",
      slug: "acme-github",
      parentId: "org-acme",
      metadata: { sourceFact: "legacy namespace" },
    },
    {
      id: "area-platform",
      kind: "area",
      label: "Platform",
      slug: "platform",
      parentId: "namespace-acme-github",
    },
    {
      id: "project-console",
      kind: "project",
      label: "Console",
      slug: "console",
      parentId: "area-platform",
    },
    {
      id: "repo-acme-console",
      kind: "repository",
      label: "Console Service",
      slug: "console-service",
      parentId: "project-console",
      remote: "https://github.com/acme/console-service",
      metadata: { classification: { confidence: "high", reason: "reviewed" } },
    },
  ],
  policies: [],
  workflows: [],
});

const unclassified = (): Record<string, any> => ({
  apiVersion: "workspace-governance/unclassified-repositories-v1",
  count: 1,
  catalogActivationAuthorized: true,
  activationStatus: "historical",
  repositories: [
    {
      repository: "acme/unplaced",
      status: "unclassified",
      reason: "No reviewed business placement.",
    },
  ],
  mutation: "No checkout changed.",
});

test("M2 import maps business ancestry and keeps both source forms as provenance", () => {
  const first = convertV1Catalog(classified(), unclassified());
  const second = convertV1Catalog(classified(), unclassified());

  assert.deepEqual(
    first.groups.map(({ id, kind, name, slug, parentId }) => ({ id, kind, name, slug, parentId })),
    [
      { id: "org-acme", kind: "organization", name: "Acme", slug: "acme", parentId: null },
      { id: "area-platform", kind: "area", name: "Platform", slug: "platform", parentId: "org-acme" },
      { id: "project-console", kind: "project", name: "Console", slug: "console", parentId: "area-platform" },
    ],
  );
  assert.equal(first.sources.length, 0);
  assert.equal(first.policies.length, 0);
  assert.equal(first.workflows.length, 0);

  const confirmed = first.repositories.find((repository) => repository.id === "repo-acme-console");
  assert.deepEqual(confirmed, {
    id: "repo-acme-console",
    remote: "https://github.com/acme/console-service",
    sourceId: null,
    primaryGroupId: "project-console",
    memberOf: [],
    aliases: ["Console Service", "console-service"],
    classification: "confirmed",
    metadata: {
      migration: {
        source: "classified",
        record: classified().nodes.at(-1),
      },
    },
  });

  const pending = first.repositories.find((repository) => repository.classification === "unclassified");
  assert.match(pending?.id ?? "", /^repo-unclassified-[a-f0-9]{24}$/);
  assert.equal(pending?.id, second.repositories.at(-1)?.id);
  assert.deepEqual(pending, {
    id: pending?.id,
    remote: "https://github.com/acme/unplaced",
    sourceId: null,
    primaryGroupId: null,
    memberOf: [],
    aliases: ["unplaced"],
    classification: "unclassified",
    metadata: {
      migration: {
        source: "unclassified",
        record: unclassified().repositories[0],
      },
    },
  });

  assert.deepEqual(first.metadata, {
    migration: {
      format: "workspacectl/import-v1",
      classified: {
        apiVersion: "workspace-governance/v1",
        authorityId: "synthetic-authority",
        metadata: { oldApproval: true, note: "historical only" },
        omittedNodes: [classified().nodes[0], classified().nodes[2]],
      },
      unclassified: {
        topLevel: {
          apiVersion: "workspace-governance/unclassified-repositories-v1",
          count: 1,
          catalogActivationAuthorized: true,
          activationStatus: "historical",
          mutation: "No checkout changed.",
        },
      },
    },
  });
});

test("M2 import reports every nonempty v1 semantic record A03 cannot map", () => {
  const manifest = classified();
  manifest.nodes[2] = {
    ...manifest.nodes[2],
    visibility: { mode: "restricted", readers: ["reviewer"] },
  };
  manifest.nodes.push({
    id: "workspace-console",
    kind: "workspace",
    slug: "local",
    parentId: "repo-acme-console",
  });
  manifest.policies.push({
    nodeId: "namespace-acme-github",
    settings: [{ key: "commands.test", merge: "replace", value: "npm test" }],
    constraints: [],
  });
  manifest.workflows.push({
    nodeId: "project-console",
    id: "release",
    settings: [],
    constraints: [],
    steps: [{ id: "verify", action: "command", inputs: {} }],
  });

  assert.throws(
    () => convertV1Catalog(manifest, unclassified()),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "UNSUPPORTED");
      assert.deepEqual((error as { details?: unknown }).details, {
        unmappable: [
          { source: "manifest.nodes[2].visibility", record: manifest.nodes[2].visibility },
          { source: "manifest.nodes[6]", record: manifest.nodes[6] },
          { source: "manifest.policies[0]", record: manifest.policies[0] },
          { source: "manifest.workflows[0]", record: manifest.workflows[0] },
        ],
      });
      return true;
    },
  );
});

test("M2 import reports canonical identity conflicts across classified and sidecar inputs", () => {
  const sidecar = unclassified();
  sidecar.repositories[0] = {
    repository: "acme/console-service",
    status: "unclassified",
    reason: "Synthetic duplicate.",
  };

  assert.throws(
    () => convertV1Catalog(classified(), sidecar),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "CONFLICT");
      const details = (error as {
        details?: { conflicts?: Array<{ canonical: string; occurrences: Array<{ source: string; id: string }> }> };
      }).details;
      assert.equal(details?.conflicts?.length, 1);
      assert.equal(details?.conflicts?.[0]?.canonical, "acme/console-service");
      assert.deepEqual(
        details?.conflicts?.[0]?.occurrences.map(({ source }) => source),
        ["classified", "unclassified"],
      );
      assert.equal(details?.conflicts?.[0]?.occurrences[0]?.id, "repo-acme-console");
      assert.match(details?.conflicts?.[0]?.occurrences[1]?.id ?? "", /^repo-unclassified-[a-f0-9]{24}$/);
      return true;
    },
  );
});

test("M2 import refuses malformed sidecar remote tokens without repairing them", () => {
  const sidecar = unclassified();
  sidecar.repositories[0] = {
    repository: " acme/unplaced",
    status: "unclassified",
    reason: "Synthetic malformed token.",
  };

  assert.throws(
    () => convertV1Catalog(classified(), sidecar),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "INVALID_CONFIG");
      assert.deepEqual((error as { details?: unknown }).details, {
        invalidRemoteTokens: [
          {
            source: "sidecar.repositories[0].repository",
            value: " acme/unplaced",
          },
        ],
      });
      return true;
    },
  );
});

test("M2 import accepts valid mixed-case source tokens while preserving the literal provenance", () => {
  const sidecar = unclassified();
  sidecar.repositories[0] = {
    repository: "Acme/Unplaced",
    status: "unclassified",
    reason: "Valid GitHub identity with source casing.",
  };
  const catalog = convertV1Catalog(classified(), sidecar);
  const imported = catalog.repositories.find(
    (repository) => repository.classification === "unclassified",
  );
  assert.equal(imported?.remote, "https://github.com/acme/unplaced");
  assert.equal(
    (imported?.metadata.migration as { record: { repository: string } }).record.repository,
    "Acme/Unplaced",
  );
});

test("M2 import preserves sidecar suggestion evidence without activating it", () => {
  const sidecar = unclassified();
  sidecar.repositories[0] = {
    repository: "Acme/Unplaced",
    status: "unclassified",
    reason: "Suggestion remains unapproved.",
    withheldSuggestion: {
      domain: "acme",
      area: "platform",
      project: null,
    },
    suggestionEvidence: "Synthetic evidence retained verbatim.",
  };
  const catalog = convertV1Catalog(classified(), sidecar);
  const imported = catalog.repositories.find(
    (repository) => repository.classification === "unclassified",
  );
  assert.equal(imported?.classification, "unclassified");
  assert.equal(imported?.primaryGroupId, null);
  assert.deepEqual(
    (imported?.metadata.migration as { record: unknown }).record,
    sidecar.repositories[0],
  );
});
