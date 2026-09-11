import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createReport } from "../src/index.ts";
import { renderReportHtml } from "../src/report-html.ts";

const manifest = {
  apiVersion: "workspace-governance/v1" as const,
  authorityId: "prototype-authority",
  nodes: [
    { id: "person", kind: "user" as const, slug: "criss", parentId: null, visibility: { mode: "public" as const, readers: [] } },
    { id: "cue", kind: "organization" as const, slug: "cueplusplus", parentId: "person" },
    { id: "cue-product", kind: "project" as const, slug: "product", parentId: "cue" },
    { id: "cue-repo", kind: "repository" as const, slug: "app", parentId: "cue-product", remote: "https://github.com/cueplusplus/app" },
    { id: "rgc", kind: "organization" as const, slug: "rgc", parentId: "person" },
    { id: "rgc-product", kind: "project" as const, slug: "platform", parentId: "rgc" },
    { id: "rgc-repo", kind: "repository" as const, slug: "api", parentId: "rgc-product", remote: "https://github.com/rgc-labs/api" },
  ],
  policies: [
    { nodeId: "person", settings: [{ key: "git.pullRequest", merge: "replace" as const, value: true }], constraints: [] },
    { nodeId: "cue", settings: [{ key: "quality.checks", merge: "set-union" as const, value: ["typecheck"] }], constraints: [] },
  ],
  workflows: [
    { nodeId: "person", id: "feature", settings: [], constraints: [], steps: [
      { id: "discover", action: "workspace.discover", inputs: {} },
      { id: "test", action: "repository.test", inputs: {} },
    ] },
  ],
  metadata: {},
};
const snapshot = {
  manifest,
  revision: "prototype-revision",
  complete: true as const,
  stale: false as const,
  authorization: "advisory" as const,
  coverage: "authority" as const,
  subject: null,
};
const root = "/tmp/workspace-governance-report";
const present = `${root}/cueplusplus/product/app`;
const inventory = {
  root,
  complete: true,
  errors: [],
  repositories: [{
    path: present,
    remote: "https://github.com/cueplusplus/app",
    head: "a".repeat(40),
    dirty: false,
    worktree: false,
    status: "",
  }],
  occupiedPaths: [present],
  unsafePaths: [],
};

test("report combines a user-level hierarchy, placement summary, policy provenance and workflow", () => {
  const report = createReport(snapshot, inventory, "person", "cristian", { workflowId: "feature" });
  assert.equal(report.apiVersion, "workspace-governance/report-v1");
  assert.equal(report.executable, false);
  assert.equal(report.nodeId, "person");
  assert.deepEqual(report.summary, {
    repositories: 2,
    present: 1,
    misplaced: 0,
    missingCheckout: 1,
    duplicate: 0,
    blocked: 0,
    needsAttention: 1,
    drift: true,
  });
  assert.deepEqual(report.nodes.map((node) => node.id), [
    "person", "cue", "cue-product", "cue-repo", "rgc", "rgc-product", "rgc-repo",
  ]);
  for (const node of report.nodes) {
    assert.deepEqual(Object.keys(node), ["id", "kind", "slug", "parentId"]);
  }
  const cue = report.repositories.find((repository) => repository.repositoryId === "cue-repo")!;
  assert.equal(cue.status, "present");
  assert.deepEqual(cue.ancestry.map((node) => node.slug), ["criss", "cueplusplus", "product", "app"]);
  assert.equal(cue.resolution.values["git.pullRequest"], true);
  assert.deepEqual(cue.resolution.values["quality.checks"], ["typecheck"]);
  assert.deepEqual(cue.resolution.provenance.map((source) => source.nodeId), ["person", "cue"]);
  assert.deepEqual(cue.resolution.workflow?.steps.map((step) => "action" in step ? step.action : "removed"), [
    "workspace.discover", "repository.test",
  ]);
  const rgc = report.repositories.find((repository) => repository.repositoryId === "rgc-repo")!;
  assert.equal(rgc.status, "missing-checkout");
  assert.equal(Object.hasOwn(rgc.resolution.values, "quality.checks"), false);
});

test("report refuses a user scope with an unreadable descendant", () => {
  const hiddenManifest = structuredClone(manifest) as any;
  hiddenManifest.nodes.find((node: { id: string }) => node.id === "rgc-product").visibility = {
    mode: "restricted",
    readers: ["alice"],
  };
  assert.throws(
    () => createReport({ ...snapshot, manifest: hiddenManifest }, inventory, "person", "cristian"),
    { code: "UNAVAILABLE" },
  );
});

test("HTML renders paths relative to a filesystem-root scan", () => {
  const rootInventory = {
    ...inventory,
    root: "/",
    repositories: [],
    occupiedPaths: [],
  };
  const report = createReport(snapshot, rootInventory, "cue-repo", "cristian");
  const html = renderReportHtml(report);
  assert.match(
    html,
    /<strong>Target<\/strong> <code>\.\/cueplusplus\/product\/app<\/code>/,
  );
  assert.doesNotMatch(html, /<code>\.cueplusplus\/product\/app<\/code>/);
});

test("report creation remains responsive for 600 repositories", () => {
  const repositoryNodes = Array.from({ length: 600 }, (_, index) => ({
    id: `repository-${index}`,
    kind: "repository" as const,
    slug: `repository-${index}`,
    parentId: "cue-product",
    remote: `https://github.com/cueplusplus/repository-${index}`,
  }));
  const largeManifest = {
    ...manifest,
    nodes: [manifest.nodes[0], manifest.nodes[1], manifest.nodes[2], ...repositoryNodes],
    policies: manifest.policies.slice(0, 1),
    workflows: [],
  };
  const emptyInventory = {
    ...inventory,
    repositories: [],
    occupiedPaths: [],
  };
  const startedAt = performance.now();
  const report = createReport({ ...snapshot, manifest: largeManifest }, emptyInventory, "person", "cristian");
  const elapsedMs = performance.now() - startedAt;

  assert.equal(report.repositories.length, 600);
  assert.ok(elapsedMs < 1_000, `expected report creation under 1000ms, got ${elapsedMs.toFixed(1)}ms`);
});
