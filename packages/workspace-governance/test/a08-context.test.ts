import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalJson,
  documentRevision,
  loadRelevantContext,
  resolveCatalogContext,
  resolveProjectContexts,
} from "../src/index.ts";

const tempRoot = join(process.env.TMPDIR ?? tmpdir(), "workspacectl-a08-tests");
const emptyPolicy = (kind: string, id: string, settings: Record<string, unknown> = {}) => ({
  scope: { kind, id }, settings, operations: [], constraints: [], instructions: [], knowledge: [], skills: [],
});
const digest = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function fixture(root: string) {
  const sourcePath = join(root, "trusted", "rules", "shared.json");
  const catalog = {
    schemaVersion: 2, documentType: "workspacectl/catalog",
    groups: [
      { id: "org", kind: "organization", name: "Main Org", slug: "org", parentId: null, metadata: {} },
      { id: "project", kind: "project", name: "Shared Project", slug: "project", parentId: "org", metadata: {} },
      { id: "other-org", kind: "organization", name: "Other Org", slug: "other", parentId: null, metadata: {} },
      { id: "other-project", kind: "project", name: "Other Project", slug: "other-project", parentId: "other-org", metadata: {} },
    ],
    repositories: [
      { id: "repo-a", remote: "https://github.com/example/repo-a", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} },
      { id: "repo-b", remote: "https://github.com/example/repo-b", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} },
      { id: "other-repo", remote: "https://github.com/other/other-repo", sourceId: null, primaryGroupId: "other-project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} },
    ],
    sources: [],
    policies: [
      { ...emptyPolicy("organization", "org", { "commands.test": "npm test" }), instructions: [{ id: "org-rule", text: "Organization rule", required: true }] },
      { ...emptyPolicy("project", "project", { "commands.build": "npm run build" }), knowledge: [{ id: "shared-knowledge", reference: "../knowledge/shared.md", required: true }] },
      { ...emptyPolicy("repository", "repo-a", { "commands.test": "npm run verify-a" }), instructions: [{ id: "repo-a-rule", text: "Repository A rule", required: true }], knowledge: [{ id: "repo-a-knowledge", reference: "../knowledge/a.md", required: false }], skills: [{ id: "repo-a-skill", reference: "../skills/a.md", required: true }], provenance: { sourceRepository: "https://github.com/example/rules", sourcePath, sourceRevision: "rev-a", contentDigest: "a".repeat(64), declaredScope: { kind: "repository", id: "repo-a" } } },
      { ...emptyPolicy("repository", "repo-b", { "commands.test": "npm run verify-b" }), instructions: [{ id: "repo-b-rule", text: "Repository B secret rule", required: true }], knowledge: [{ id: "repo-b-knowledge", reference: "../knowledge/b.md", required: false }] },
      { ...emptyPolicy("organization", "other-org", { "commands.other": "never" }), instructions: [{ id: "other-rule", text: "UNRELATED ORG", required: true }] },
      { ...emptyPolicy("repository", "other-repo", {}), knowledge: [{ id: "other-knowledge", reference: "unrelated.md", required: false }] },
    ],
    workflows: [{ id: "feature", scope: { kind: "project", id: "project" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [{ id: "prepare", type: "context.resolve", needs: [], configuration: {}, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true }] }],
    metadata: {},
  };
  const state = {
    schemaVersion: 2, documentType: "workspacectl/local-state",
    selectedConfig: { path: join(root, "config.json"), revision: `sha256:${"0".repeat(64)}` },
    repositoryWorkspaces: [{ id: "ws-a", kind: "primary", repositoryId: "repo-a", path: join(root, "workspaces", "a"), branch: "main", primarySelected: true, hostLinks: {} }],
    coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {},
  };
  return { catalog, state, sourcePath };
}

test("A08 loads only selected relevant context with provenance, trust, budget, and declaring-base paths", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "relevant-"));
  try {
    const { catalog, state } = fixture(root);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    const files = {
      shared: join(trusted, "knowledge", "shared.md"),
      a: join(trusted, "knowledge", "a.md"),
      skill: join(trusted, "skills", "a.md"),
    };
    await writeFile(files.shared, "Shared project knowledge\n");
    await writeFile(files.a, "Repository A knowledge\n");
    await writeFile(files.skill, "Repository A skill\n");
    const base = resolveCatalogContext(catalog, state, { repositoryId: "repo-a", workspaceId: "ws-a", selectedProjectId: "project", workflowId: "feature" });
    const options = {
      catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted],
      load: ["knowledge:repo-a-knowledge", "skill:repo-a-skill"],
      approvals: [
        `knowledge:repo-a-knowledge=${digest(await readFile(files.a))}`,
        `skill:repo-a-skill=${digest(await readFile(files.skill))}`,
      ],
    };
    const context = await loadRelevantContext(base, options);
    assert.equal(context.organization.id, "org");
    assert.equal(context.project?.id, "project");
    assert.equal(context.repositoryId, "repo-a");
    assert.equal(context.workspaceId, "ws-a");
    assert.equal(context.displayBudget.byteLimit, 16_000);
    assert.equal(context.displayBudget.tokenEquivalent, 4_000);
    assert.equal(context.instructions.every((entry: any) => entry.status === "loaded"), true);
    assert.equal(context.knowledgeReferences.find((entry: any) => entry.id === "repo-a-knowledge")!.content, "Repository A knowledge\n");
    assert.equal(context.selectedSkills.find((entry: any) => entry.id === "repo-a-skill")!.active, false);
    assert.equal(context.workflow?.executable, false);
    assert.equal(context.commandDefinitions.find((entry: any) => entry.key === "commands.test")!.active, false);
    const baseline = await loadRelevantContext(base, { ...options, load: [], approvals: [] });
    await writeFile(files.a, "x".repeat(5_000));
    const optionalBudget = await loadRelevantContext(base, { ...options, load: ["knowledge:repo-a-knowledge"], approvals: [`knowledge:repo-a-knowledge=${digest("x".repeat(5_000))}`], budgetBytes: baseline.displayBudget.usedBytes + 500 });
    assert.equal(optionalBudget.knowledgeReferences.find((entry) => entry.id === "repo-a-knowledge")!.status, "linked");
    assert.ok(optionalBudget.warnings.includes("optional-knowledge-omitted:repo-a-knowledge:budget"));
    await writeFile(files.a, "Repository A knowledge\n");
    const bytes = canonicalJson(context as any);
    assert.equal(bytes.includes("repo-b-rule"), false);
    assert.equal(bytes.includes("Repository B secret rule"), false);
    assert.equal(bytes.includes("UNRELATED ORG"), false);
    assert.equal(bytes.includes("other-knowledge"), false);
    assert.equal(canonicalJson(await loadRelevantContext(base, options) as any), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A08 refuses escaped, symlinked, missing, oversized, and stale-approved loaded targets without mutation", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "refusals-"));
  try {
    const { catalog, state } = fixture(root);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    const shared = join(trusted, "knowledge", "shared.md"), skill = join(trusted, "skills", "a.md"), a = join(trusted, "knowledge", "a.md");
    await writeFile(shared, "Shared\n"); await writeFile(skill, "Skill\n"); await writeFile(a, "A\n");
    const base = resolveCatalogContext(catalog, state, { repositoryId: "repo-a", selectedProjectId: "project" });
    const immutable = [shared, skill, a];
    const before = await Promise.all(immutable.map((path) => readFile(path)));
    const common = { catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted] };
    await assert.rejects(loadRelevantContext(base, { ...common, load: ["knowledge:repo-a-knowledge"], approvals: [`knowledge:repo-a-knowledge=${digest("old")}`] }), (error: any) => error.code === "UNTRUSTED_INPUT" && error.details?.targetId === "repo-a-knowledge");
    (base.knowledgeReferences.find((entry) => entry.id === "repo-a-knowledge") as any).reference = "../../../outside.md";
    await assert.rejects(loadRelevantContext(base, { ...common, load: ["knowledge:repo-a-knowledge"], approvals: [] }), (error: any) => error.code === "UNTRUSTED_INPUT");
    (base.knowledgeReferences.find((entry) => entry.id === "repo-a-knowledge") as any).reference = "../knowledge/link.md";
    const outside = join(root, "outside.md"); await writeFile(outside, "outside\n"); await symlink(outside, join(trusted, "knowledge", "link.md"));
    await assert.rejects(loadRelevantContext(base, { ...common, load: ["knowledge:repo-a-knowledge"], approvals: [] }), (error: any) => error.code === "UNTRUSTED_INPUT");
    await rm(shared);
    await assert.rejects(loadRelevantContext(base, common), (error: any) => error.code === "INCOMPLETE" && error.details?.targetId === "shared-knowledge");
    await writeFile(shared, "Shared\n");
    base.instructions.push({ id: "huge", required: true, text: "x".repeat(100), scope: { kind: "repository", id: "repo-a" }, workflowId: null });
    await assert.rejects(loadRelevantContext(base, { ...common, budgetBytes: 20 }), (error: any) => error.code === "INCOMPLETE" && error.details?.reason === "oversized-context" && error.details?.offendingIds.includes("huge"));
    assert.deepEqual(await Promise.all(immutable.map((path) => readFile(path))), before.map((bytes, index) => index === 0 ? Buffer.from("Shared\n") : bytes));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A08 validates every required target, warns for malformed optional targets, and rejects unknown approvals", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "validation-"));
  try {
    const { catalog, state } = fixture(root);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    const shared = join(trusted, "knowledge", "shared.md");
    await writeFile(shared, Buffer.from([0xff, 0xfe, 0xfd]));
    await writeFile(join(trusted, "skills", "a.md"), "Skill\n");
    await writeFile(join(trusted, "knowledge", "a.md"), Buffer.from([0xff]));
    const base = resolveCatalogContext(catalog, state, { repositoryId: "repo-a", selectedProjectId: "project" });
    const common = { catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted] };
    await assert.rejects(loadRelevantContext(base, common), (error: any) =>
      error.code === "INVALID_CONFIG" && error.details?.targetId === "shared-knowledge" && error.details?.reason === "malformed-target");
    await writeFile(shared, "Shared\n");
    const context = await loadRelevantContext(base, common);
    assert.ok(context.warnings.includes("optional-knowledge-inactive:repo-a-knowledge:malformed-target"));
    await assert.rejects(loadRelevantContext(base, { ...common, approvals: [`command:does.not.exist=${digest("x")}`] }),
      (error: any) => error.code === "INVALID_CONFIG" && error.details?.reason === "unknown-approval-target" && error.details?.targetId === "command:does.not.exist");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A08 trusted descriptor read detects pathname replacement through the injected open seam", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "race-"));
  try {
    const { catalog, state } = fixture(root);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    const shared = join(trusted, "knowledge", "shared.md");
    await writeFile(shared, "original\n");
    await writeFile(join(trusted, "skills", "a.md"), "Skill\n");
    const base = resolveCatalogContext(catalog, state, { repositoryId: "repo-a", selectedProjectId: "project" });
    let replaced = false;
    await assert.rejects(loadRelevantContext(base, {
      catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted],
      fileOps: { open: async (path, flags) => {
        const descriptor = await open(path, flags);
        if (!replaced && path === shared) {
          replaced = true;
          await rename(shared, `${shared}.opened`);
          await writeFile(shared, "replacement\n");
        }
        return descriptor;
      } },
    }), (error: any) => error.code === "UNTRUSTED_INPUT" && error.details?.reason === "path-drift");
    assert.equal((constants.O_NOFOLLOW ?? 0) !== 0, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A08 refuses trusted-root replacement before leaf open without returning replacement bytes", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "root-race-"));
  try {
    const { catalog, state } = fixture(root);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    const shared = join(trusted, "knowledge", "shared.md");
    await writeFile(shared, "original\n");
    await writeFile(join(trusted, "skills", "a.md"), "Skill\n");
    const base = resolveCatalogContext(catalog, state, { repositoryId: "repo-a", selectedProjectId: "project" });
    const displaced = join(root, "trusted-displaced");
    let replaced = false;
    let returned: unknown;
    await assert.rejects(async () => {
      returned = await loadRelevantContext(base, {
        catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted],
        fileOps: { open: async (path, flags) => {
          if (!replaced && path === shared) {
            replaced = true;
            await rename(trusted, displaced);
            await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
            await writeFile(shared, "replacement-outside-validated-root\n");
          }
          return open(path, flags);
        } },
      });
    }, (error: any) => error.code === "UNTRUSTED_INPUT" && error.details?.reason === "path-drift");
    assert.equal(returned, undefined);
    assert.equal(await readFile(join(displaced, "knowledge", "shared.md"), "utf8"), "original\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A08 requires exact approval for externally sourced broad-scope references", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "external-"));
  try {
    const { catalog, state } = fixture(root);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    const shared = join(trusted, "knowledge", "shared.md");
    await writeFile(shared, "Shared\n"); await writeFile(join(trusted, "skills", "a.md"), "Skill\n");
    const policy = catalog.policies.find((entry: any) => entry.scope.id === "project")! as any;
    policy.provenance = { sourceRepository: "https://github.com/example/external", sourcePath: join(trusted, "rules", "project.json"), sourceRevision: "rev", contentDigest: "b".repeat(64), declaredScope: { kind: "project", id: "project" } };
    const base = resolveCatalogContext(catalog, state, { repositoryId: "repo-a", selectedProjectId: "project" });
    const common = { catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted] };
    const linked = await loadRelevantContext(base, common);
    assert.equal(linked.knowledgeReferences.find((entry) => entry.id === "shared-knowledge")?.trust.approval, "required");
    await assert.rejects(loadRelevantContext(base, { ...common, load: ["knowledge:shared-knowledge"] }),
      (error: any) => error.code === "UNTRUSTED_INPUT" && error.details?.reason === "renewed-review-required");
    const approved = await loadRelevantContext(base, { ...common, load: ["knowledge:shared-knowledge"], approvals: [`knowledge:shared-knowledge=${digest("Shared\n")}`] });
    assert.equal(approved.knowledgeReferences.find((entry) => entry.id === "shared-knowledge")?.trust.approval, "approved");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A08 cross-repository project context returns complete bound relevant contexts without mixing", async () => {
  const root = await mkdtemp(join(tempRoot, "project-"));
  const { catalog, state } = fixture(root);
  const trusted = join(root, "trusted");
  await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
  await writeFile(join(trusted, "knowledge", "shared.md"), "Shared\n");
  await writeFile(join(trusted, "skills", "a.md"), "Skill\n");
  const contexts = await resolveProjectContexts(catalog, state, {
    projectId: "project", repositoryIds: ["repo-b", "repo-a"], catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted], groups: catalog.groups as any,
  });
  assert.deepEqual(contexts.repositoryContexts.map((entry: any) => entry.repositoryId), ["repo-a", "repo-b"]);
  assert.deepEqual(contexts.sharedProjectContext.instructions.map((entry: any) => entry.id), ["org-rule"]);
  assert.deepEqual(contexts.repositoryContexts[0].instructions.map((entry: any) => entry.id), ["org-rule", "repo-a-rule"]);
  assert.deepEqual(contexts.repositoryContexts[1].instructions.map((entry: any) => entry.id), ["org-rule", "repo-b-rule"]);
  assert.equal(canonicalJson(contexts.repositoryContexts[0] as any).includes("repo-b-rule"), false);
  assert.equal(canonicalJson(contexts.repositoryContexts[1] as any).includes("repo-a-rule"), false);
  for (const context of [contexts.sharedProjectContext, ...contexts.repositoryContexts]) {
    assert.equal(context.revisions.catalog, documentRevision(catalog));
    assert.equal(context.revisions.localState, documentRevision(state));
    assert.ok(context.organization.name.length > 0);
    assert.ok(Array.isArray(context.commandDefinitions));
    assert.ok(context.displayBudget.usedBytes > 0);
    assert.equal(context.knowledgeReferences.every((entry: any) => entry.trust && entry.active === false), true);
  }
  await rm(root, { recursive: true, force: true });
});

test("A08 shared project context selects an unused internal repository ID without mixing colliding policies", async () => {
  const root = await mkdtemp(join(tempRoot, "project-collision-"));
  try {
    const { catalog, state } = fixture(root);
    for (const [index, id] of ["$shared-project", "$shared-project-1", "$shared-project-2"].entries()) {
      catalog.repositories.push({ id, remote: `https://github.com/example/shared-collision-${index}`, sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} });
      catalog.policies.push({ ...emptyPolicy("repository", id), instructions: [{ id: `collision-rule-${index}`, text: `Collision ${index}`, required: true }] });
    }
    const catalogBefore = canonicalJson(catalog as any);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    await writeFile(join(trusted, "knowledge", "shared.md"), "Shared\n");
    await writeFile(join(trusted, "skills", "a.md"), "Skill\n");
    const contexts = await resolveProjectContexts(catalog, state, {
      projectId: "project", repositoryIds: ["repo-b", "repo-a"], catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted], groups: catalog.groups as any,
    });
    assert.equal(contexts.sharedProjectContext.repositoryId, "$shared-project-3");
    assert.deepEqual(contexts.sharedProjectContext.instructions.map((entry) => entry.id), ["org-rule"]);
    assert.deepEqual(contexts.repositoryContexts.map((entry) => entry.repositoryId), ["repo-a", "repo-b"]);
    assert.equal(canonicalJson(contexts as any).includes("collision-rule"), false);
    assert.equal(canonicalJson(catalog as any), catalogBefore);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("A08 budgets complete rendered and serialized context and bounds overflow details", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "budget-"));
  try {
    const { catalog, state } = fixture(root);
    const trusted = join(root, "trusted");
    await Promise.all(["rules", "knowledge", "skills"].map((name) => mkdir(join(trusted, name), { recursive: true })));
    await writeFile(join(trusted, "knowledge", "shared.md"), "Shared\n"); await writeFile(join(trusted, "skills", "a.md"), "Skill\n");
    const base = resolveCatalogContext(catalog, state, { repositoryId: "repo-a", selectedProjectId: "project", workflowId: "feature" });
    for (let index = 0; index < 40; index += 1) {
      const key = `commands.massive-${index}`;
      base.settings[key] = "x".repeat(400);
      base.provenance.push({ key, merge: "replace", value: base.settings[key] as any, scope: { kind: "project", id: "project" }, workflowId: null });
    }
    await assert.rejects(loadRelevantContext(base, { catalogPath: join(trusted, "rules", "catalog.json"), trustedRoots: [trusted] }), (error: any) => {
      const encoded = Buffer.byteLength(JSON.stringify(error.details ?? {}), "utf8");
      return error.code === "INCOMPLETE" && error.details?.reason === "oversized-context" && error.details?.requiredBytes > error.details?.budgetBytes && encoded <= 2048 && (error.details?.offendingIds?.length ?? 0) <= 32;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
