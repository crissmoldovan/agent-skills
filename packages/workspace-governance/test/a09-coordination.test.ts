import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyWorkspacePlan,
  createCoordinationWorkspacePlan,
  documentRevision,
  reopenCoordinationWorkspace,
  validateLocalStateDocument,
  validateWorkspacePlan,
} from "../src/index.ts";

const rootBase = join(process.env.TMPDIR ?? tmpdir(), "workspacectl-a09-coordination-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A09", "-c", "user.email=a09@example.invalid", ...args], { cwd, encoding: "utf8" });
async function makeRepo(path: string, remote: string) { await mkdir(path); git(path, "init", "-b", "main"); git(path, "remote", "add", "origin", remote); await writeFile(join(path, "source.txt"), "preserve\n"); git(path, "add", "."); git(path, "commit", "-m", "seed"); }
async function fixture() {
  await mkdir(rootBase, { recursive: true }); const root = await mkdtemp(join(rootBase, "case-"));
  const trusted = join(root, "trusted"), plans = join(root, "plans"), coordinationParent = join(root, "coordination");
  await Promise.all([mkdir(trusted), mkdir(plans), mkdir(coordinationParent)]);
  const a = join(trusted, "a"), b = join(trusted, "b"); await makeRepo(a, "https://github.com/example/a"); await makeRepo(b, "https://github.com/example/b");
  const configPath = join(root, "config.json"), catalogPath = join(root, "catalog.json"), statePath = join(root, "state.json");
  const config = { schemaVersion: 2, documentType: "workspacectl/config", catalog: { adapter: "file", path: catalogPath }, localState: { adapter: "file", path: statePath }, plans: { directory: plans }, trustedRoots: [trusted, coordinationParent] };
  const catalog = { schemaVersion: 2, documentType: "workspacectl/catalog", groups: [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }, { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} }], repositories: [{ id: "a", remote: "https://github.com/example/a", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }, { id: "b", remote: "https://github.com/example/b", sourceId: null, primaryGroupId: "project", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }], sources: [], policies: [], workflows: [], metadata: {} };
  const state = { schemaVersion: 2, documentType: "workspacectl/local-state", selectedConfig: { path: configPath, revision: documentRevision(config) }, repositoryWorkspaces: [{ id: "ws-a", kind: "primary", repositoryId: "a", path: a, branch: "main", primarySelected: true, hostLinks: {} }, { id: "ws-b", kind: "primary", repositoryId: "b", path: b, branch: "main", primarySelected: true, hostLinks: {} }], coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [], trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {} };
  await Promise.all([writeFile(configPath, JSON.stringify(config)), writeFile(catalogPath, JSON.stringify(catalog)), writeFile(statePath, JSON.stringify(state))]);
  return { root, trusted, plans, coordinationParent, a, b, configPath, catalogPath, statePath };
}

test("A09 approved coordination plan creates only declared non-Git files and CAS binding", async () => {
  const f = await fixture();
  try {
    const target = join(f.coordinationParent, "project-room");
    const sourcesBefore = await Promise.all([readFile(join(f.a, "source.txt")), readFile(join(f.b, "source.txt"))]);
    const plan = await createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: target }, "2026-09-20T12:00:00.000Z");
    assert.equal(plan.kind, "coordination-create");
    assert.deepEqual(plan.repositoryIds, ["a", "b"]);
    assert.deepEqual(plan.actions.map((action) => action.type), ["directory-create", "file-create", "file-create", "document-cas"]);
    assert.equal(validateWorkspacePlan(plan).semanticDigest, plan.semanticDigest);
    await assert.rejects(applyWorkspacePlan(plan, { selectedConfigPath: f.configPath, approval: "plan-wrong" }), (error: any) => error.code === "APPROVAL_REQUIRED");
    const applied = await applyWorkspacePlan(plan, { selectedConfigPath: f.configPath, approval: plan.id });
    assert.equal(applied.kind, "coordination-create");
    assert.deepEqual(await readdir(target), ["WORKSPACE.md", "members.json"]);
    await assert.rejects(readFile(join(target, ".git")), (error: any) => error.code === "EISDIR" || error.code === "ENOENT");
    const binding = applied.readback.localState.coordinationWorkspaces[0];
    assert.equal(binding.path, target); assert.deepEqual(binding.memberWorkspaceIds, ["ws-a", "ws-b"]);
    assert.equal(validateLocalStateDocument(applied.readback.localState).coordinationWorkspaces[0].revision, binding.revision);
    assert.deepEqual(await Promise.all([readFile(join(f.a, "source.txt")), readFile(join(f.b, "source.txt"))]), sourcesBefore);
    const reopened = await reopenCoordinationWorkspace(f.configPath, binding.id);
    assert.equal(reopened.status, "exact"); assert.equal(reopened.members.every((member) => member.status === "exact"), true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 coordination reopen reports member drift without mutation", async () => {
  const f = await fixture();
  try {
    const target = join(f.coordinationParent, "room");
    const plan = await createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: target });
    const applied = await applyWorkspacePlan(plan, { selectedConfigPath: f.configPath, approval: plan.id });
    const id = applied.readback.localState.coordinationWorkspaces[0].id;
    const state = JSON.parse(await readFile(f.statePath, "utf8")); state.repositoryWorkspaces.find((entry: any) => entry.id === "ws-b").path = join(f.trusted, "missing"); await writeFile(f.statePath, JSON.stringify(state));
    const before = await readFile(f.statePath);
    const reopened = await reopenCoordinationWorkspace(f.configPath, id);
    assert.equal(reopened.status, "drift");
    assert.equal(reopened.members.find((member) => member.repositoryId === "b")?.status, "missing");
    assert.deepEqual(await readFile(f.statePath), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 coordination destination and stale/collision guards refuse without unrelated writes", async () => {
  const f = await fixture();
  try {
    const occupied = join(f.coordinationParent, "occupied"); await mkdir(occupied); await writeFile(join(occupied, "notes.md"), "keep\n");
    await assert.rejects(createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: occupied }), (error: any) => error.code === "CONFLICT");
    const outside = join(f.root, "outside"); await mkdir(outside); const link = join(f.coordinationParent, "link"); await symlink(outside, link);
    await assert.rejects(createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: join(link, "room") }), (error: any) => error.code === "INVALID_CONFIG" || error.code === "UNTRUSTED_INPUT");
    await assert.rejects(createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: f.a }), (error: any) => error.code === "CONFLICT");
    const target = join(f.coordinationParent, "stale"); const plan = await createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: target });
    const state = JSON.parse(await readFile(f.statePath, "utf8")); state.metadata.changed = true; await writeFile(f.statePath, JSON.stringify(state));
    await assert.rejects(applyWorkspacePlan(plan, { selectedConfigPath: f.configPath, approval: plan.id }), (error: any) => error.code === "STALE_PLAN");
    await assert.rejects(readFile(target), (error: any) => error.code === "ENOENT" || error.code === "EISDIR");
    assert.equal(await readFile(join(occupied, "notes.md"), "utf8"), "keep\n");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 coordination creation never follows a replaced parent component", async () => {
  const f = await fixture();
  try {
    const target = join(f.coordinationParent, "race-room"), movedParent = join(f.root, "coordination-original"), outside = join(f.root, "outside-race");
    await mkdir(outside);
    const plan = await createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: target });
    await assert.rejects(applyWorkspacePlan(plan, {
      selectedConfigPath: f.configPath, approval: plan.id,
      testHooks: { beforeCoordinationDirectoryCreate: async () => { await rename(f.coordinationParent, movedParent); await symlink(outside, f.coordinationParent); } },
    } as any), (error: any) => error.code === "ACTION_FAILED");
    await assert.rejects(readFile(join(outside, "race-room", "members.json")), (error: any) => error.code === "ENOENT");
    await assert.rejects(readFile(join(movedParent, "race-room", "members.json")), (error: any) => error.code === "ENOENT");
    assert.equal(JSON.parse(await readFile(f.statePath, "utf8")).coordinationWorkspaces.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 destructive post-CAS loss restores declared artifacts without clobbering concurrent local state", async () => {
  const f = await fixture();
  try {
    const target = join(f.coordinationParent, "destructive-recovery-room");
    const plan = await createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: target });
    await assert.rejects(applyWorkspacePlan(plan, {
      selectedConfigPath: f.configPath, approval: plan.id,
      testHooks: {
        afterCoordinationLocalStateWriteBeforeReadback: async () => {
          await unlink(join(target, "members.json"));
          const state = JSON.parse(await readFile(f.statePath, "utf8"));
          state.metadata.concurrent = "preserved";
          await writeFile(f.statePath, JSON.stringify(state));
        },
      },
    } as any), (error: any) => error.code === "ACTION_FAILED");
    const state = JSON.parse(await readFile(f.statePath, "utf8"));
    assert.equal(state.metadata.concurrent, "preserved");
    assert.equal(state.coordinationWorkspaces.length, 1);
    assert.deepEqual(await readdir(target), ["WORKSPACE.md", "members.json"]);
    assert.equal((await reopenCoordinationWorkspace(f.configPath, state.coordinationWorkspaces[0].id)).status, "exact");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 unsafe post-CAS replacement rolls back only the exact binding and preserves concurrent state", async () => {
  const f = await fixture();
  try {
    const target = join(f.coordinationParent, "rollback-room");
    const plan = await createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: target });
    await assert.rejects(applyWorkspacePlan(plan, {
      selectedConfigPath: f.configPath, approval: plan.id,
      testHooks: {
        afterCoordinationLocalStateWriteBeforeReadback: async () => {
          const replacement = join(target, "replacement.tmp");
          await writeFile(replacement, "replacement owned elsewhere\n");
          await rename(replacement, join(target, "members.json"));
          const state = JSON.parse(await readFile(f.statePath, "utf8"));
          state.metadata.concurrent = "preserved-during-rollback";
          await writeFile(f.statePath, JSON.stringify(state));
        },
      },
    } as any), (error: any) => error.code === "ACTION_FAILED");
    const state = JSON.parse(await readFile(f.statePath, "utf8"));
    assert.equal(state.metadata.concurrent, "preserved-during-rollback");
    assert.equal(state.coordinationWorkspaces.length, 0);
    assert.equal(await readFile(join(target, "members.json"), "utf8"), "replacement owned elsewhere\n");
    assert.deepEqual(await readdir(target), ["members.json"]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A09 post-CAS readback failure leaves one complete recoverable coordination state", async () => {
  const f = await fixture();
  try {
    const target = join(f.coordinationParent, "recoverable-room");
    const plan = await createCoordinationWorkspacePlan({ configPath: f.configPath, groupId: "project", path: target });
    await assert.rejects(applyWorkspacePlan(plan, {
      selectedConfigPath: f.configPath, approval: plan.id,
      testHooks: { afterCoordinationLocalStateWriteBeforeReadback: async () => { throw new Error("injected readback failure"); } },
    } as any), (error: any) => error.code === "ACTION_FAILED");
    const state = JSON.parse(await readFile(f.statePath, "utf8"));
    assert.equal(state.coordinationWorkspaces.length, 1); assert.deepEqual(await readdir(target), ["WORKSPACE.md", "members.json"]);
    assert.equal((await reopenCoordinationWorkspace(f.configPath, state.coordinationWorkspaces[0].id)).status, "exact");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
