import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";

const schemaPath = fileURLToPath(new URL("../schemas/v2/resolved-context.schema.json", import.meta.url));

test("A08 executable resolved-context schema requires trust, budget, status, and inert workflow fields", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const check = new Ajv({ strict: true, allErrors: true }).compile(schema);
  const context = {
    schemaVersion: 2, repositoryId: "repo", workspaceId: null, selectedProjectId: "project",
    revisions: { catalog: "sha256:" + "a".repeat(64), localState: "sha256:" + "b".repeat(64) },
    organization: { id: "org", name: "Org" }, project: { id: "project", name: "Project" },
    settings: { "commands.test": "npm test" }, provenance: [], constraints: [],
    instructions: [{ id: "rule", required: true, text: "Rule", scope: { kind: "organization", id: "org" }, workflowId: null, status: "loaded" }],
    knowledgeReferences: [{ id: "doc", required: false, reference: "doc.md", scope: { kind: "repository", id: "repo" }, workflowId: null, status: "linked", active: false, trust: { approval: "required", approvedRevision: null } }],
    selectedSkills: [], recordProvenance: [],
    workflow: { id: "feature", inputs: [], outputs: [], steps: [], provenance: [], executable: false },
    commandDefinitions: [{ key: "commands.test", value: "npm test", scope: { kind: "organization", id: "org" }, contentRevision: "sha256:" + "c".repeat(64), approval: "required", active: false }],
    displayBudget: { unit: "utf8-bytes", byteLimit: 16000, usedBytes: 4, tokenEquivalent: 4000, bytesPerToken: 4 },
    ancestry: ["org", "project", "repo"], warnings: [],
  };
  assert.equal(check(context), true, JSON.stringify(check.errors));
  for (const mutate of [
    (value: any) => { delete value.displayBudget; },
    (value: any) => { value.instructions[0].status = "enforced"; },
    (value: any) => { value.workflow.executable = true; },
    (value: any) => { value.knowledgeReferences[0].active = true; },
    (value: any) => { value.knowledgeReferences[0].status = "loaded"; delete value.knowledgeReferences[0].content; delete value.knowledgeReferences[0].contentRevision; delete value.knowledgeReferences[0].resolvedPath; },
    (value: any) => { value.knowledgeReferences[0].trust = { approval: "approved", approvedRevision: null }; },
    (value: any) => { value.commandDefinitions[0].approval = "approved"; delete value.commandDefinitions[0].contentRevision; },
  ]) {
    const invalid = structuredClone(context); mutate(invalid);
    assert.equal(check(invalid), false);
  }
  const loaded = structuredClone(context);
  Object.assign(loaded.knowledgeReferences[0], { status: "loaded", content: "Doc", contentRevision: "sha256:" + "d".repeat(64), resolvedPath: "/trusted/doc.md", trust: { approval: "approved", approvedRevision: "sha256:" + "d".repeat(64) } });
  assert.equal(check(loaded), true, JSON.stringify(check.errors));
});
