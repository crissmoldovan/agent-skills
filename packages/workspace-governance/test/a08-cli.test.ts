import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { documentRevision } from "../src/index.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tempRoot = join(process.env.TMPDIR ?? tmpdir(), "workspacectl-a08-cli-tests");
const run = (args: string[], cwd?: string) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd });
const emptyPolicy = (kind: string, id: string, settings: Record<string, unknown> = {}) => ({ scope: { kind, id }, settings, operations: [], constraints: [], instructions: [], knowledge: [], skills: [] });
const sha = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("A08 public context flags load approved bounded references and text/JSON stay relevant and deterministic", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "cli-"));
  try {
    const configPath = join(root, "config.json"), catalogPath = join(root, "trusted", "rules", "catalog.json"), statePath = join(root, "state.json"), plans = join(root, "plans");
    await Promise.all([mkdir(join(root, "trusted", "rules"), { recursive: true }), mkdir(join(root, "trusted", "knowledge"), { recursive: true }), mkdir(plans)]);
    const knowledgePath = join(root, "trusted", "knowledge", "repo.md");
    const knowledgeBytes = Buffer.from("Approved repository knowledge\n");
    await writeFile(knowledgePath, knowledgeBytes);
    const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [join(root, "trusted")] };
    const catalog = {
      schemaVersion: 2, documentType: "workspacectl/catalog", sources: [], metadata: {},
      groups: [
        { id: "org", kind: "organization", name: "Synthetic Org", slug: "org", parentId: null, metadata: {} },
        { id: "project", kind: "project", name: "Synthetic Project", slug: "project", parentId: "org", metadata: {} },
        { id: "other", kind: "organization", name: "Unrelated Org", slug: "other", parentId: null, metadata: {} },
      ],
      repositories: [
        { id: "repo", remote: "https://github.com/example/repo", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} },
        { id: "unrelated", remote: "https://github.com/example/unrelated", sourceId: null, primaryGroupId: "other", memberOf: [], aliases: [], classification: "confirmed", metadata: {} },
      ],
      policies: [
        { ...emptyPolicy("organization", "org", { "commands.test": "npm test" }), instructions: [{ id: "mandatory", text: "Mandatory organization rule", required: true }] },
        { ...emptyPolicy("repository", "repo", { "commands.test": "npm run verify" }), instructions: [{ id: "repo-rule", text: "Repository rule", required: true }, { id: "optional-note", text: "OPTIONAL SUMMARY NOTE", required: false }], knowledge: [{ id: "repo-doc", reference: "../knowledge/repo.md", required: true }] },
        { ...emptyPolicy("organization", "other", { "commands.unrelated": "never" }), instructions: [{ id: "unrelated-rule", text: "MUST NOT MIX", required: true }] },
      ],
      workflows: [{ id: "feature", scope: { kind: "project", id: "project" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [{ id: "prepare", type: "context.resolve", needs: [], configuration: {}, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true }] }],
    };
    const state = { schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config) }, repositoryWorkspaces: [], coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {} };
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
    const immutable = [configPath, catalogPath, statePath, knowledgePath];
    const before = await Promise.all(immutable.map((path) => readFile(path)));
    const differentCwd = join(root, "different-cwd");
    await mkdir(differentCwd);
    const args = ["context", "repo", "--project", "project", "--workflow", "feature", "--config", configPath, "--load", "knowledge:repo-doc", "--approve-content", `knowledge:repo-doc=${sha(knowledgeBytes)}`, "--json"];
    const first = run(args, differentCwd);
    assert.equal(first.status, 0, first.stderr);
    const second = run(args, root);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    const body = JSON.parse(first.stdout);
    assert.equal(body.context.organization.name, "Synthetic Org");
    assert.equal(body.context.project.name, "Synthetic Project");
    assert.equal(body.context.knowledgeReferences[0].content, knowledgeBytes.toString());
    assert.equal(body.context.knowledgeReferences[0].active, false);
    assert.equal(body.context.instructions[0].status, "loaded");
    assert.equal(body.context.workflow.executable, false);
    assert.equal(body.context.commandDefinitions[0].active, false);
    assert.ok(body.context.warnings.includes("optional-instruction-omitted:optional-note:summary"));
    assert.equal(first.stdout.includes("MUST NOT MIX"), false);
    assert.equal(first.stdout.includes("commands.unrelated"), false);
    const text = run(args.filter((value) => value !== "--json"), root);
    assert.equal(text.status, 0, text.stderr);
    for (const expected of ["Synthetic Org", "Synthetic Project", "repo", "npm run verify", "Mandatory organization rule", "feature", "repo-doc", "loaded", "inactive"])
      assert.match(text.stdout, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(text.stdout.includes("OPTIONAL SUMMARY NOTE"), false);
    const stale = run(args.map((value) => value.includes(`knowledge:repo-doc=${sha(knowledgeBytes)}`) ? `knowledge:repo-doc=${sha("old")}` : value), root);
    assert.equal(stale.status, 4);
    assert.equal(JSON.parse(stale.stderr).error.code, "UNTRUSTED_INPUT");
    const staleCommand = run([
      "context", "repo", "--project", "project", "--config", configPath,
      "--approve-content", `command:commands.test=${sha("stale-command")}`, "--json",
    ], root);
    assert.equal(staleCommand.status, 4);
    assert.equal(JSON.parse(staleCommand.stderr).error.details.targetId, "commands.test");
    const oversized = run(["context", "repo", "--project", "project", "--config", configPath, "--budget-bytes", "5", "--json"], root);
    assert.equal(oversized.status, 3);
    assert.equal(JSON.parse(oversized.stderr).error.details.reason, "oversized-context");
    assert.deepEqual(await Promise.all(immutable.map((path) => readFile(path))), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
