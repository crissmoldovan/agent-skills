import test from "node:test";
import assert from "node:assert/strict";
import {
  carriedRuleSetDigest,
  compareCarriedRuleSet,
  resolveCatalogContext,
  validateCatalogDocument,
  validateLocalStateDocument,
} from "../src/index.ts";
import { emptyCatalogDocument, emptyLocalStateDocument } from "../src/v2-model.ts";

const scope = (kind: string, id: string) => ({ kind, id });
const policy = (kind: string, id: string, settings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  scope: scope(kind, id), settings, operations: [], constraints: [], instructions: [], knowledge: [], skills: [], ...extra,
});

function fixture() {
  const catalog: any = emptyCatalogDocument();
  catalog.groups = [
    { id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} },
    { id: "outer", kind: "area", name: "Outer", slug: "outer", parentId: "org", metadata: {} },
    { id: "inner", kind: "area", name: "Inner", slug: "inner", parentId: "outer", metadata: {} },
    { id: "project", kind: "project", name: "Project", slug: "project", parentId: "inner", metadata: {} },
  ];
  catalog.repositories = [{
    id: "repo", remote: "https://github.com/foreign-owner/repo", sourceId: null,
    primaryGroupId: "inner", memberOf: ["project"], aliases: [], classification: "confirmed", metadata: {},
  }];
  catalog.policies = [
    policy("base", "defaults", { "commands.test": "base", list: ["base"] }),
    policy("organization", "org", { "commands.test": "org" }, {
      operations: [{ key: "list", merge: "append", value: ["org"] }],
      constraints: [{ id: "must-pr", key: "git.requirePullRequest", operator: "equals", value: true }],
      instructions: [{ id: "required-rule", text: "Keep review", required: true }],
      knowledge: [{ id: "architecture", reference: "docs/architecture.md", required: false }],
      skills: [{ id: "testing", reference: "test-driven-development", required: false }],
    }),
    policy("area", "outer", { "commands.test": "outer" }),
    policy("area", "inner", { "commands.test": "inner" }),
    policy("project", "project", { "commands.test": "project" }),
    policy("repository", "repo", { "commands.test": "repo", "git.requirePullRequest": true }, {
      instructions: [{ id: "local", text: "Repository instruction", required: false }],
    }),
  ];
  catalog.workflows = [
    {
      id: "feature", scope: scope("organization", "org"), inputs: [{ id: "ticket", required: true }], outputs: [],
      settings: { "commands.test": "org-workflow" }, operations: [], constraints: [],
      steps: [
        { id: "prepare", type: "context.resolve", needs: [], configuration: {}, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
        { id: "test", type: "command", needs: ["prepare"], configuration: { argv: ["npm", "test"] }, sideEffect: "workspace", approval: "explicit", retry: { mode: "safe", maxAttempts: 2 }, required: false },
      ],
    },
    {
      id: "feature", scope: scope("repository", "repo"), inputs: [], outputs: [], settings: { "commands.test": "repo-workflow" }, operations: [], constraints: [],
      steps: [
        { id: "test", type: "command", needs: ["prepare"], configuration: { argv: ["npm", "run", "verify"] }, sideEffect: "workspace", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: false },
      ],
    },
  ];
  const state: any = emptyLocalStateDocument("/tmp/a07-config.json", `sha256:${"0".repeat(64)}`);
  state.repositoryWorkspaces = [{ id: "ws", kind: "primary", repositoryId: "repo", path: "/tmp/a07-repo", branch: "main", primarySelected: true, hostLinks: {} }];
  state.workspacePolicyOverlays = [policy("workspace", "ws", { "commands.test": "workspace" })];
  return { catalog, state };
}

test("A07 resolves full precedence, named records and workflow provenance", () => {
  const { catalog, state } = fixture();
  validateCatalogDocument(catalog);
  validateLocalStateDocument(state);
  const result = resolveCatalogContext(catalog, state, {
    repositoryId: "repo", workspaceId: "ws", selectedProjectId: "project", workflowId: "feature",
    userPolicies: [policy("user", "user", { "commands.test": "user" }) as any],
    invocation: { settings: { "commands.test": "invocation" }, operations: [{ key: "list", merge: "set-union", value: ["invocation"] }] },
  });
  assert.equal(result.settings["commands.test"], "invocation");
  assert.deepEqual(result.settings.list, ["base", "org", "invocation"]);
  assert.deepEqual(result.ancestry, ["org", "outer", "inner", "project", "repo", "ws"]);
  assert.deepEqual(result.instructions.map((item: any) => item.id), ["required-rule", "local"]);
  assert.equal(result.knowledgeReferences[0].id, "architecture");
  assert.equal(result.selectedSkills[0].id, "testing");
  assert.ok(result.recordProvenance.some((entry: any) => entry.recordId === "required-rule" && entry.operation === "add"));
  assert.equal((result.workflow as any).steps[1].configuration.argv[2], "verify");
  const repoWorkflow = result.provenance.find((entry: any) => entry.scope.kind === "repository" && entry.workflowId === "feature" && entry.key === "commands.test");
  const repoOrdinary = result.provenance.find((entry: any) => entry.scope.kind === "repository" && entry.workflowId === null && entry.key === "commands.test");
  assert.ok(repoWorkflow && repoOrdinary && result.provenance.indexOf(repoWorkflow) < result.provenance.indexOf(repoOrdinary));
  assert.equal(result.constraints[0].scope.id, "org");
});

test("A07 refuses illegal project selection, required removals, conflicts and invalid workflow graphs", () => {
  const { catalog, state } = fixture();
  const unchanged = JSON.stringify({ catalog, state });
  assert.throws(() => resolveCatalogContext(catalog, state, { repositoryId: "repo", selectedProjectId: "missing" }), (error: any) => error.code === "POLICY_CONFLICT");
  const repositoryPolicy = catalog.policies.find((record: any) => record.scope.kind === "repository");
  repositoryPolicy.instructions.push({ id: "required-rule", remove: true });
  assert.throws(() => resolveCatalogContext(catalog, state, { repositoryId: "repo" }), (error: any) => error.code === "POLICY_CONFLICT");
  repositoryPolicy.instructions.pop();
  repositoryPolicy.settings["git.requirePullRequest"] = false;
  assert.throws(() => resolveCatalogContext(catalog, state, { repositoryId: "repo" }), (error: any) => error.code === "POLICY_CONFLICT");
  delete repositoryPolicy.settings["git.requirePullRequest"];
  catalog.workflows[1].steps[0].needs = ["absent"];
  assert.throws(() => resolveCatalogContext(catalog, state, { repositoryId: "repo", workflowId: "feature" }), (error: any) => error.code === "POLICY_CONFLICT");
  catalog.workflows[1].steps = [{ id: "prepare", remove: true }];
  assert.throws(() => resolveCatalogContext(catalog, state, { repositoryId: "repo", workflowId: "feature" }), (error: any) => error.code === "POLICY_CONFLICT");
  catalog.workflows[1].steps = [
    { id: "prepare", type: "context.resolve", needs: ["test"], configuration: {}, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
    { id: "test", type: "command", needs: ["prepare"], configuration: {}, sideEffect: "workspace", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: false },
  ];
  assert.throws(() => resolveCatalogContext(catalog, state, { repositoryId: "repo", workflowId: "feature" }), (error: any) => error.code === "POLICY_CONFLICT");
  assert.throws(() => resolveCatalogContext(fixture().catalog, fixture().state, { repositoryId: "repo", invocation: { settings: { commands: "conflict" }, operations: [] } }), (error: any) => error.code === "POLICY_CONFLICT");
  assert.throws(() => resolveCatalogContext(fixture().catalog, fixture().state, { repositoryId: "repo", invocation: { settings: {}, operations: [{ key: "commands.test", merge: "append", value: ["bad"] }] } }), (error: any) => error.code === "POLICY_CONFLICT");
  assert.equal(JSON.stringify({ catalog: fixture().catalog, state: fixture().state }), unchanged);
});

test("A07 carried rule-set comparison preserves declared provenance and never changes bytes", () => {
  const carried = policy("organization", "org", { "rules.one": true });
  const bytes = Buffer.from(JSON.stringify(carried, null, 2) + "\n");
  const provenance = {
    sourceRepository: "https://github.com/synthetic/source",
    sourcePath: "rules/shared.json", sourceRevision: "abc123", contentDigest: carriedRuleSetDigest(carried as any),
    declaredScope: { kind: "organization", id: "org" },
  };
  const before = Buffer.from(bytes);
  assert.equal(compareCarriedRuleSet(provenance as any, carried as any, bytes).status, "matching");
  assert.equal(compareCarriedRuleSet(provenance as any, carried as any, Buffer.from("changed")).status, "drift");
  assert.deepEqual(bytes, before);
});
