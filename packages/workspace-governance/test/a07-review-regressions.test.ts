import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import {
  assertCatalogRulesResolvable,
  canonicalJson,
  compareCarriedRuleSet,
  resolveCatalogContext,
  validateCatalogDocument,
  validateLocalStateDocument,
} from "../src/index.ts";
import { emptyCatalogDocument, emptyLocalStateDocument } from "../src/v2-model.ts";

const policy = (kind: string, id: string, extra: Record<string, unknown> = {}) => ({
  scope: { kind, id }, settings: {}, operations: [], constraints: [], instructions: [], knowledge: [], skills: [], ...extra,
});
const step = (id: string, required: boolean) => ({
  id, type: "command", needs: [], configuration: {}, sideEffect: "workspace", approval: "explicit",
  retry: { mode: "never", maxAttempts: 1 }, required,
});
function fixture() {
  const catalog: any = emptyCatalogDocument();
  catalog.groups = [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }];
  catalog.repositories = [{ id: "repo", remote: "https://github.com/synthetic/repo", sourceId: null, primaryGroupId: "org", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }];
  const state: any = emptyLocalStateDocument("/tmp/a07-review-config.json", `sha256:${"0".repeat(64)}`);
  state.repositoryWorkspaces = [{ id: "ws", kind: "primary", repositoryId: "repo", path: "/tmp/a07-review-repo", branch: "main", primarySelected: true, hostLinks: {} }];
  return { catalog, state };
}

test("A07 required named records remain required through replacement and cannot later be removed", () => {
  const { catalog, state } = fixture();
  catalog.policies = [
    policy("organization", "org", { instructions: [{ id: "guard", text: "original", required: true }] }),
    policy("repository", "repo", { instructions: [{ id: "guard", text: "replacement", required: false }] }),
  ];
  state.workspacePolicyOverlays = [policy("workspace", "ws", { instructions: [{ id: "guard", remove: true }] })];
  assert.throws(
    () => resolveCatalogContext(catalog, state, { repositoryId: "repo", workspaceId: "ws" }),
    (error: any) => error.code === "POLICY_CONFLICT" && error.details?.reason === "required-removal",
  );
});

test("A07 required workflow steps remain required through replacement and cannot later be removed", () => {
  const { catalog, state } = fixture();
  catalog.workflows = [
    { id: "flow", scope: { kind: "organization", id: "org" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [step("guard", true)] },
    { id: "flow", scope: { kind: "repository", id: "repo" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [step("guard", false)] },
  ];
  state.workspaceWorkflowOverlays = [{ id: "flow", scope: { kind: "workspace", id: "ws" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [{ id: "guard", remove: true }] }];
  assert.throws(
    () => resolveCatalogContext(catalog, state, { repositoryId: "repo", workspaceId: "ws", workflowId: "flow" }),
    (error: any) => error.code === "POLICY_CONFLICT" && error.details?.reason === "required-step-removal",
  );
});

test("A07 local-state schema and runtime agree on typed workspace policies, workflows and retry invariant", async () => {
  const schema = JSON.parse(await readFile(fileURLToPath(new URL("../schemas/v2/local-state.schema.json", import.meta.url)), "utf8"));
  const check = new Ajv({ strict: true, allErrors: true }).compile(schema);
  const { state } = fixture();
  state.workspacePolicyOverlays = [policy("workspace", "ws", { operations: [{ key: "list", merge: "append", value: ["ok"] }] })];
  state.workspaceWorkflowOverlays = [{ id: "flow", scope: { kind: "workspace", id: "ws" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [step("check", false)] }];
  assert.equal(check(state), true, JSON.stringify(check.errors));
  assert.deepEqual(validateLocalStateDocument(state), state);
  const malformed = structuredClone(state);
  malformed.workspacePolicyOverlays[0].operations[0] = { key: "list", merge: "append", value: "bad" };
  assert.equal(check(malformed), false);
  assert.throws(() => validateLocalStateDocument(malformed), (error: any) => error.code === "INVALID_CONFIG");
  const badRetry = structuredClone(state);
  badRetry.workspaceWorkflowOverlays[0].steps[0].retry = { mode: "never", maxAttempts: 2 };
  assert.equal(check(badRetry), false);
  assert.throws(() => validateLocalStateDocument(badRetry), (error: any) => error.code === "INVALID_CONFIG");
});

test("A07 catalog schema rejects runtime-invalid never retry and catalog workspace scopes use INVALID_CONFIG", async () => {
  const schema = JSON.parse(await readFile(fileURLToPath(new URL("../schemas/v2/catalog.schema.json", import.meta.url)), "utf8"));
  const check = new Ajv({ strict: true, allErrors: true }).compile(schema);
  const { catalog } = fixture();
  catalog.workflows = [{ id: "flow", scope: { kind: "organization", id: "org" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [{ ...step("check", false), retry: { mode: "never", maxAttempts: 2 } }] }];
  assert.equal(check(catalog), false);
  assert.throws(() => validateCatalogDocument(catalog), (error: any) => error.code === "INVALID_CONFIG");
  catalog.workflows = [];
  catalog.policies = [policy("workspace", "ws")];
  assert.throws(() => validateCatalogDocument(catalog), (error: any) => error.code === "INVALID_CONFIG");
});

test("A07 carried digest binds canonical payload and canonical source JSON", () => {
  const carried: any = policy("organization", "org", { settings: { "commands.test": "npm test" } });
  const contentDigest = createHash("sha256").update(canonicalJson(carried)).digest("hex");
  const provenance = { sourceRepository: "https://github.com/synthetic/source", sourcePath: "rules.json", sourceRevision: "rev", contentDigest, declaredScope: carried.scope };
  const source = Buffer.from(JSON.stringify(carried, null, 2) + "\n");
  assert.equal(compareCarriedRuleSet(provenance, carried, source).status, "matching");
  assert.equal(compareCarriedRuleSet(provenance, { ...carried, settings: { "commands.test": "changed" } }, source).status, "drift");
  assert.equal(compareCarriedRuleSet(provenance, carried, Buffer.from(JSON.stringify({ ...carried, settings: { "commands.test": "changed" } }))).status, "drift");
  assert.equal(contentDigest, createHash("sha256").update(canonicalJson(carried)).digest("hex"));
});

test("A07 suggested placement activates no inherited group policy", () => {
  const { catalog, state } = fixture();
  catalog.repositories[0].classification = "suggested";
  catalog.policies = [policy("organization", "org", { settings: { inherited: true } })];
  const result = resolveCatalogContext(catalog, state, { repositoryId: "repo" });
  assert.equal(result.settings.inherited, undefined);
  assert.deepEqual(result.ancestry, ["repo"]);
});

test("A07 whole-draft validation catches contradictory rule chains with zero repositories", () => {
  const catalog: any = emptyCatalogDocument();
  catalog.policies = [policy("base", "defaults", {
    settings: { required: false },
    constraints: [{ id: "required-true", key: "required", operator: "equals", value: true }],
  })];
  assert.throws(() => assertCatalogRulesResolvable(catalog), (error: any) => error.code === "POLICY_CONFLICT");
});

test("A07 whole-draft validation does not activate suggested project memberships", () => {
  const catalog: any = emptyCatalogDocument();
  catalog.groups = [
    { id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} },
    { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} },
  ];
  catalog.repositories = [{
    id: "repo", remote: "https://github.com/synthetic/unclassified", sourceId: null,
    primaryGroupId: null, memberOf: ["project"], aliases: [], classification: "unclassified", metadata: {},
  }];
  assert.doesNotThrow(() => assertCatalogRulesResolvable(catalog));
});
