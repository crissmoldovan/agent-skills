import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acknowledgeHostAction,
  createOpenHostAction,
  documentRevision,
  openTarget,
  validateHostAction,
  validateVerifiedHostResult,
} from "../src/index.ts";

const tempRoot = join(process.env.TMPDIR ?? tmpdir(), "workspacectl-a09-open-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Synthetic A09", "-c", "user.email=a09@example.invalid", ...args], { cwd, encoding: "utf8" });
const emptyPolicy = (kind: string, id: string, settings: Record<string, unknown> = {}) => ({ scope: { kind, id }, settings, operations: [], constraints: [], instructions: [], knowledge: [], skills: [] });

async function repository(path: string, remote: string) {
  await mkdir(path, { recursive: true });
  git(path, "init", "--initial-branch=main");
  git(path, "remote", "add", "origin", remote);
  await writeFile(join(path, "tracked.txt"), "unchanged\n");
  git(path, "add", "tracked.txt");
  git(path, "commit", "-m", "synthetic");
}

async function fixture() {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const trusted = join(root, "trusted"), plans = join(root, "plans");
  await Promise.all([mkdir(trusted), mkdir(plans)]);
  const repoA = join(trusted, "repo-a"), repoB = join(trusted, "repo-b");
  await repository(repoA, "https://github.com/example/repo-a");
  await repository(repoB, "https://github.com/example/repo-b");
  const configPath = join(root, "config.json"), catalogPath = join(root, "catalog.json"), statePath = join(root, "state.json");
  const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [trusted] };
  const catalog = {
    schemaVersion: 2, documentType: "workspacectl/catalog",
    groups: [
      { id: "org", kind: "organization", name: "Synthetic Org", slug: "org", parentId: null, metadata: {} },
      { id: "project", kind: "project", name: "Synthetic Project", slug: "project", parentId: "org", metadata: {} },
    ],
    repositories: [
      { id: "repo-a", remote: "https://github.com/example/repo-a", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: ["alpha"], classification: "confirmed", metadata: {} },
      { id: "repo-b", remote: "https://github.com/example/repo-b", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} },
    ],
    sources: [], policies: [emptyPolicy("organization", "org", { "commands.test": "npm test" })], workflows: [], metadata: {},
  };
  const state = {
    schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config) },
    repositoryWorkspaces: [
      { id: "ws-a", kind: "primary", repositoryId: "repo-a", path: repoA, branch: "main", primarySelected: true, hostLinks: {} },
      { id: "ws-b", kind: "primary", repositoryId: "repo-b", path: repoB, branch: "main", primarySelected: true, hostLinks: { hermesProjectId: "project-b" } },
    ],
    coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {},
  };
  await Promise.all([
    writeFile(configPath, JSON.stringify(config, null, 2) + "\n"),
    writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n"),
    writeFile(statePath, JSON.stringify(state, null, 2) + "\n"),
  ]);
  return { root, trusted, plans, repoA, repoB, configPath, catalogPath, statePath };
}

async function bytes(paths: string[]) { return Promise.all(paths.map((path) => readFile(path))); }

function nativeReadback(action: any, projectId?: string) {
  const created = projectId ?? "created-project";
  return {
    actionId: action.id, actionDigest: action.digest, activation: "native-project" as const,
    results: action.requests.map((request: any) => request.operation === "list"
      ? { requestId: request.id, operation: "list", projects: [] }
      : request.operation === "create"
        ? { requestId: request.id, operation: "create", project: { id: created, name: request.name, path: request.path } }
        : { requestId: request.id, operation: "switch", project: { id: request.projectId ?? created, name: action.projectName, path: action.cwd } }),
    project: { id: projectId ?? created, name: action.projectName, path: action.cwd }, effectiveToolCwd: action.cwd,
  };
}

test("A09 repository and group open are read-only, exact, and carry A08 context", async () => {
  const f = await fixture();
  try {
    const immutable = [f.configPath, f.catalogPath, f.statePath, join(f.repoA, "tracked.txt"), join(f.repoB, "tracked.txt")];
    const before = await bytes(immutable);
    const repositoryOpen = await openTarget(f.configPath, { target: "alpha" });
    assert.equal(repositoryOpen.kind, "repository");
    assert.equal(repositoryOpen.path, f.repoA);
    assert.equal(repositoryOpen.workspace.id, "ws-a");
    assert.equal(repositoryOpen.context.repositoryId, "repo-a");
    assert.equal(repositoryOpen.context.commandDefinitions[0].value, "npm test");
    assert.equal(repositoryOpen.hostAction, null);
    const groupOpen = await openTarget(f.configPath, { target: "project" });
    assert.equal(groupOpen.kind, "group");
    assert.deepEqual(groupOpen.members.map((member) => [member.repositoryId, member.workspaceId, member.path]), [
      ["repo-a", "ws-a", f.repoA], ["repo-b", "ws-b", f.repoB],
    ]);
    assert.equal(groupOpen.coordinationWorkspace, null);
    assert.equal(groupOpen.hostAction, null);
    assert.deepEqual(await bytes(immutable), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 explicit host activation emits typed inert Hermes or terminal actions", async () => {
  const f = await fixture();
  try {
    const readOnly = await openTarget(f.configPath, { target: "repo-b", host: "hermes" });
    assert.equal(readOnly.hostAction, null);
    const hermes = await openTarget(f.configPath, { target: "repo-b", host: "hermes", activate: true });
    assert.equal(hermes.hostAction?.host, "hermes");
    assert.deepEqual(hermes.hostAction?.requests.map((request) => request.operation), ["list", "switch"]);
    assert.equal(hermes.hostAction?.requests[1].projectId, "project-b");
    assert.equal(validateHostAction(hermes.hostAction).digest, hermes.hostAction?.digest);
    const create = await openTarget(f.configPath, { target: "repo-a", host: "hermes", activate: true });
    assert.deepEqual(create.hostAction?.requests.map((request) => request.operation), ["list", "create", "switch"]);
    const terminal = await openTarget(f.configPath, { target: "repo-a", host: "terminal", activate: true });
    assert.equal(terminal.hostAction?.type, "terminal-launch");
    assert.equal(terminal.hostAction?.cwd, f.repoA);
    await assert.rejects(openTarget(f.configPath, { target: "repo-a", activate: true }), (error: any) => error.code === "INVALID_CONFIG");
    await assert.rejects(openTarget(f.configPath, { target: "repo-a", host: "unsupported" as any, activate: true }), (error: any) => error.code === "UNSUPPORTED");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 Hermes acknowledgement binds exact action and native Project plus tool cwd readback", async () => {
  const f = await fixture();
  try {
    const opened = await openTarget(f.configPath, { target: "repo-b", host: "hermes", activate: true });
    const action = opened.hostAction!;
    const exact = nativeReadback(action, "project-b");
    const result = await acknowledgeHostAction(f.configPath, action, exact);
    assert.equal(result.readbackStatus, "exact");
    assert.equal(result.logicalTarget.id, "repo-b");
    assert.equal(result.contextReference.revisions.catalog, opened.revisions.catalog);
    assert.equal(validateVerifiedHostResult(result).actionDigest, action.digest);
    for (const bad of [
      { ...exact, actionId: "action-wrong" },
      { ...exact, actionDigest: "0".repeat(64) },
      { ...exact, project: { ...exact.project, id: "wrong" } },
      { ...exact, project: { ...exact.project, path: f.repoA } },
      { ...exact, activation: "shell-cd" as any },
      { ...exact, effectiveToolCwd: f.repoA },
      { ...exact, results: exact.results.slice(1) },
    ]) await assert.rejects(acknowledgeHostAction(f.configPath, action, bad), (error: any) => error.code === "ACTION_FAILED");
    await assert.rejects(acknowledgeHostAction(f.configPath, action, exact), (error: any) => error.code === "ACTION_FAILED");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 acknowledgement accepts and persists the identity created by a list-create-switch chain", async () => {
  const f = await fixture();
  try {
    const opened = await openTarget(f.configPath, { target: "repo-a", host: "hermes", activate: true });
    const exact = nativeReadback(opened.hostAction!);
    const result = await acknowledgeHostAction(f.configPath, opened.hostAction!, exact);
    assert.equal(result.project.id, "created-project");
    const state = JSON.parse(await readFile(f.statePath, "utf8"));
    assert.equal(state.repositoryWorkspaces.find((workspace: any) => workspace.id === "ws-a").hostLinks.hermesProjectId, "created-project");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 acknowledgement rejects stale config, catalog, or local state and binds created identity through final switch", async () => {
  const f = await fixture();
  try {
    const opened = await openTarget(f.configPath, { target: "repo-a", host: "hermes", activate: true });
    const action = opened.hostAction!;
    const exact = nativeReadback(action);
    const wrongCreated = structuredClone(exact); wrongCreated.results[2].project.id = "different-project";
    await assert.rejects(acknowledgeHostAction(f.configPath, action, wrongCreated), (error: any) => error.code === "ACTION_FAILED");
    const state = JSON.parse(await readFile(f.statePath, "utf8")); state.metadata.changedAfterAction = true; await writeFile(f.statePath, JSON.stringify(state));
    await assert.rejects(acknowledgeHostAction(f.configPath, action, exact), (error: any) => error.code === "ACTION_FAILED");
  } finally { await rm(f.root, { recursive: true, force: true }); }
  for (const stale of ["catalog", "config"] as const) {
    const next = await fixture();
    try {
      const opened = await openTarget(next.configPath, { target: "repo-a", host: "hermes", activate: true });
      const path = stale === "catalog" ? next.catalogPath : next.configPath;
      const document = JSON.parse(await readFile(path, "utf8"));
      if (stale === "catalog") document.metadata = { stale: true };
      else document.trustedRoots.push(join(next.root, "other-trusted"));
      await writeFile(path, JSON.stringify(document));
      await assert.rejects(acknowledgeHostAction(next.configPath, opened.hostAction!, nativeReadback(opened.hostAction!)), (error: any) => error.code === "ACTION_FAILED", stale);
    } finally { await rm(next.root, { recursive: true, force: true }); }
  }
});

test("A09 group activation reuses persisted coordination Hermes Project", async () => {
  const f = await fixture();
  try {
    const state = JSON.parse(await readFile(f.statePath, "utf8"));
    const base = { id: "coord-project", kind: "coordination", scope: { kind: "project", id: "project" }, path: f.trusted, memberRepositoryIds: ["repo-a", "repo-b"], memberWorkspaceIds: ["ws-a", "ws-b"], hostProjectId: "hermes-coordination", generatedFiles: ["WORKSPACE.md"] };
    state.coordinationWorkspaces.push({ ...base, revision: documentRevision(base) }); await writeFile(f.statePath, JSON.stringify(state));
    const opened = await openTarget(f.configPath, { target: "project", host: "hermes", activate: true });
    assert.equal(opened.kind, "group"); assert.equal(opened.coordinationWorkspace?.hostProjectId, "hermes-coordination");
    assert.deepEqual(opened.hostAction?.requests.map((request) => request.operation), ["list", "switch"]);
    assert.equal(opened.hostAction?.requests[1].projectId, "hermes-coordination");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 create acknowledgement persists the native Project identity for the next switch", async () => {
  const f = await fixture();
  try {
    const created = await openTarget(f.configPath, { target: "repo-a", host: "hermes", activate: true });
    await acknowledgeHostAction(f.configPath, created.hostAction!, nativeReadback(created.hostAction!));
    const reopened = await openTarget(f.configPath, { target: "repo-a", host: "hermes", activate: true });
    assert.deepEqual(reopened.hostAction?.requests.map((request) => request.operation), ["list", "switch"]);
    assert.equal(reopened.hostAction?.requests[1].projectId, "created-project");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 open never guesses missing or duplicate selected primary bindings", async () => {
  const f = await fixture();
  try {
    const state = JSON.parse(await readFile(f.statePath, "utf8"));
    state.repositoryWorkspaces[0].primarySelected = false;
    await writeFile(f.statePath, JSON.stringify(state));
    await assert.rejects(openTarget(f.configPath, { target: "repo-a" }), (error: any) => error.code === "NOT_FOUND");
    state.repositoryWorkspaces[0].primarySelected = true;
    state.repositoryWorkspaces.push({ ...state.repositoryWorkspaces[0], id: "ws-a-duplicate", path: f.repoB });
    await writeFile(f.statePath, JSON.stringify(state));
    await assert.rejects(openTarget(f.configPath, { target: "repo-a" }), (error: any) => error.code === "AMBIGUOUS" || error.code === "INVALID_CONFIG");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
