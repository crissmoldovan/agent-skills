import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { documentRevision, validateHostAction, validateVerifiedHostResult } from "../src/index.ts";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const skillRoot = fileURLToPath(new URL("../../../skills/workspace-governance/", import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A09", "-c", "user.email=a09@example.invalid", ...args], { cwd, encoding: "utf8" });
async function fixture() {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "a09-cli-")); const trusted = join(root, "trusted"), plans = join(root, "plans"), rooms = join(root, "rooms"); await Promise.all([mkdir(trusted), mkdir(plans), mkdir(rooms)]);
  const repo = join(trusted, "repo"); await mkdir(repo); git(repo, "init", "-b", "main"); git(repo, "remote", "add", "origin", "https://github.com/example/repo"); await writeFile(join(repo, "a"), "a"); git(repo, "add", "."); git(repo, "commit", "-m", "seed");
  const configPath = join(root, "config.json"), catalogPath = join(root, "catalog.json"), statePath = join(root, "state.json");
  const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [trusted, rooms] };
  const catalog = { schemaVersion: 2, documentType: "workspacectl/catalog", groups: [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }, { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} }], repositories: [{ id: "repo", remote: "https://github.com/example/repo", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }], sources: [], policies: [], workflows: [], metadata: {} };
  const state = { schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config) }, repositoryWorkspaces: [{ id: "ws", kind: "primary", repositoryId: "repo", path: repo, branch: "main", primarySelected: true, hostLinks: { hermesProjectId: "hermes-repo" } }], coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {} };
  await Promise.all([writeFile(configPath, JSON.stringify(config)), writeFile(catalogPath, JSON.stringify(catalog)), writeFile(statePath, JSON.stringify(state))]);
  return { root, repo, plans, rooms, configPath };
}

test("A09 CLI open, host acknowledgement, and coordination routes agree in text and JSON", async () => {
  const f = await fixture();
  try {
    const open = run(["open", "repo", "--host", "hermes", "--activate", "--config", f.configPath, "--json"]); assert.equal(open.status, 0, open.stderr);
    const body = JSON.parse(open.stdout); assert.equal(body.open.path, f.repo); assert.equal(body.open.hostAction.type, "hermes-project");
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validateOpen = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas", "v2", "open-result.schema.json"), "utf8")));
    const validateAction = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas", "v2", "host-action.schema.json"), "utf8")));
    assert.equal(validateOpen(body.open), true, JSON.stringify(validateOpen.errors)); assert.equal(validateAction(body.open.hostAction), true, JSON.stringify(validateAction.errors));
    const actionFile = join(f.root, "action.json"), readbackFile = join(f.root, "readback.json"); await writeFile(actionFile, JSON.stringify(body.open.hostAction));
    await writeFile(readbackFile, JSON.stringify({ actionId: body.open.hostAction.id, actionDigest: body.open.hostAction.digest, activation: "native-project", results: [{ requestId: "list-projects", operation: "list", projects: [] }, { requestId: "switch-project", operation: "switch", project: { id: "hermes-repo", name: "repo", path: f.repo } }], project: { id: "hermes-repo", name: "repo", path: f.repo }, effectiveToolCwd: f.repo }));
    const ack = run(["host", "acknowledge", "--action", actionFile, "--readback", readbackFile, "--config", f.configPath, "--json"]); assert.equal(ack.status, 0, ack.stderr); const ackBody = JSON.parse(ack.stdout); assert.equal(ackBody.result.readbackStatus, "exact");
    const validateResult = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas", "v2", "host-result.schema.json"), "utf8"))); assert.equal(validateResult(ackBody.result), true, JSON.stringify(validateResult.errors));
    const planPath = join(f.plans, "coordination.json"), room = join(f.rooms, "project"); const preview = run(["coordination", "create", "--group", "project", "--path", room, "--plan", planPath, "--config", f.configPath, "--json"]); assert.equal(preview.status, 0, preview.stderr);
    const plan = JSON.parse(preview.stdout).plan; const applied = run(["apply", "--plan", planPath, "--approve", plan.id, "--config", f.configPath, "--json"]); assert.equal(applied.status, 0, applied.stderr);
    const validatePlan = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas", "v2", "workspace-plan.schema.json"), "utf8"))); assert.equal(validatePlan(plan), true, JSON.stringify(validatePlan.errors));
    const id = JSON.parse(applied.stdout).readback.localState.coordinationWorkspaces[0].id; const reopen = run(["coordination", "open", "--id", id, "--config", f.configPath, "--json"]); assert.equal(reopen.status, 0, reopen.stderr); assert.equal(JSON.parse(reopen.stdout).coordination.status, "exact");
    const text = run(["open", "repo", "--config", f.configPath]); assert.equal(text.status, 0, text.stderr); assert.match(text.stdout, new RegExp(f.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 executable schemas, help, docs, package verifier and skill expose exact host boundary", async () => {
  const help = run(["--help"]); assert.equal(help.status, 0, help.stderr);
  for (const phrase of ["open TARGET", "host acknowledge", "coordination create", "coordination open", "M4/A09"]) assert.ok(help.stdout.includes(phrase), phrase);
  const ajv = new Ajv({ strict: false, allErrors: true });
  for (const file of ["open-result.schema.json", "host-action.schema.json", "host-result.schema.json"]) {
    const schema = JSON.parse(await readFile(join(packageRoot, "schemas", "v2", file), "utf8")); assert.equal(typeof ajv.compile(schema), "function");
  }
  for (const path of [join(packageRoot, "README.md"), join(packageRoot, "docs", "m4-a09-contract.md"), join(skillRoot, "SKILL.md"), join(skillRoot, "references", "commands.md")]) {
    const text = await readFile(path, "utf8"); assert.match(text, /desktop_project/); assert.match(text, /effective tool cwd/i); assert.match(text, /workspacectl open/);
  }
  const verifier = await readFile(join(packageRoot, "scripts", "verify-package.mjs"), "utf8"); for (const item of ["dist/open.js", "dist/coordination.js", "schemas/v2/host-action.schema.json", "docs/m4-a09-contract.md"]) assert.ok(verifier.includes(item), item);
});

test("A09 host schemas and runtime reject identical malformed operation order and context IDs", async () => {
  const f = await fixture();
  try {
    const opened = JSON.parse(run(["open", "repo", "--host", "hermes", "--activate", "--config", f.configPath, "--json"]).stdout).open;
    const ajv = new Ajv({ strict: false, allErrors: true });
    const actionSchema = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas", "v2", "host-action.schema.json"), "utf8")));
    const malformedAction = structuredClone(opened.hostAction); malformedAction.requests = malformedAction.requests.slice(1);
    assert.equal(actionSchema(malformedAction), false);
    assert.throws(() => validateHostAction(malformedAction), (error: any) => error.code === "INVALID_CONFIG");
    const resultSchema = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas", "v2", "host-result.schema.json"), "utf8")));
    for (const field of ["repositoryId", "workspaceId", "selectedProjectId"] as const) {
      const malformedResult = { schemaVersion: 1, actionId: opened.hostAction.id, actionDigest: opened.hostAction.digest, host: "hermes", logicalTarget: opened.logicalTarget, project: { id: "hermes-repo", name: "repo", path: f.repo }, effectiveToolCwd: f.repo, contextReference: { ...opened.hostAction.contextReference, [field]: "bad/id" }, readbackStatus: "exact" };
      assert.equal(resultSchema(malformedResult), false, field);
      assert.throws(() => validateVerifiedHostResult(malformedResult), (error: any) => error.code === "INVALID_CONFIG", field);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
