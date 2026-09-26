import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { validateWorkspacePlan } from "../src/v2-model.ts";
import { createWorktreePlan, createWorktreeRemovePlan, validateWorktreeOperation } from "../src/worktree-operations.ts";

const cli = process.env.WORKSPACECTL_E2E_CLI ?? fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const tempRoot = join(homedir(), "tmp", "workspacectl-a12-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A12 Fixture", "-c", "user.email=a12@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function fixture() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const dirs = Object.fromEntries(["config", "data", "state", "plans", "workspaces", "primary", "remote"].map((name) => [name, join(root, name)]));
  await Promise.all(Object.values(dirs).map((path) => mkdir(path, { mode: 0o700 })));
  git(dirs.primary, "init", "--initial-branch=main");
  await writeFile(join(dirs.primary, "tracked.txt"), "primary\n");
  git(dirs.primary, "add", "."); git(dirs.primary, "commit", "-m", "initial");
  const base = git(dirs.primary, "rev-parse", "HEAD").trim();
  const bare = join(dirs.remote, "repo.git");
  git(root, "clone", "--bare", dirs.primary, bare);
  git(dirs.primary, "remote", "add", "origin", "https://github.com/acme/repo");
  const config = join(dirs.config, "config.json"), catalog = join(dirs.data, "catalog.json"), state = join(dirs.state, "state.json"), initPlan = join(dirs.plans, "init.json");
  const rewrite = `file://${bare}`;
  const env = { ...process.env, GIT_ALLOW_PROTOCOL: "file", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url." + rewrite + ".insteadOf", GIT_CONFIG_VALUE_0: "https://github.com/acme/repo" };
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
  let result = run(["init", "--config", config, "--catalog", catalog, "--state", state, "--plans-dir", dirs.plans, "--trusted-root", root, "--plan", initPlan, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  result = run(["apply", "--config", config, "--plan", initPlan, "--approve", JSON.parse(result.stdout).plan.id, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const draft = JSON.parse(run(["config", "export", "--target", "catalog", "--config", config]).stdout);
  draft.document.repositories = [{ id: "repo", remote: "https://github.com/acme/repo", sourceId: null, primaryGroupId: null, memberOf: [], aliases: [], classification: "confirmed", metadata: {} }];
  const draftPath = join(root, "catalog-draft.json"), seedPlan = join(dirs.plans, "seed.json");
  await writeFile(draftPath, JSON.stringify(draft) + "\n");
  result = run(["config", "plan", draftPath, "--config", config, "--plan", seedPlan, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  result = run(["apply", "--config", config, "--plan", seedPlan, "--approve", JSON.parse(result.stdout).plan.id, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const adoptPlan = join(dirs.plans, "adopt.json");
  result = run(["adopt", "--repo", "repo", "--path", dirs.primary, "--config", config, "--plan", adoptPlan, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  result = run(["apply", "--config", config, "--plan", adoptPlan, "--approve", JSON.parse(result.stdout).plan.id, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return { root, dirs, config, state, run, base, bare, env };
}

function snapshotPrimary(path: string) {
  return {
    branch: git(path, "symbolic-ref", "--short", "HEAD"),
    index: git(path, "ls-files", "--stage"),
    status: git(path, "status", "--porcelain=v1", "--untracked-files=all"),
    file: git(path, "show", ":tracked.txt"),
  };
}

test("A12 create and remove plans align with the executable schema and runtime validator", async () => {
  const f = await fixture();
  try {
    const target = join(f.dirs.workspaces, "schema");
    const createPath = join(f.dirs.plans, "schema-create.json");
    let result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", "task/schema", "--path", target, "--config", f.config, "--plan", createPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const create = JSON.parse(result.stdout).plan;
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validate = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas/v2/workspace-plan.schema.json"), "utf8")));
    const validateOperation = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas/v2/operation.schema.json"), "utf8")));
    assert.equal(validate(create), true, JSON.stringify(validate.errors));
    assert.deepEqual(validateWorkspacePlan(create), create);
    for (const branch of ["bad..name", ".invalid", "bad.lock", "bad//name", "bad@{name", "bad.", "-bad"]) {
      const invalid = structuredClone(create);
      invalid.request.branch = branch;
      assert.equal(validate(invalid), false, branch);
      assert.throws(() => validateWorkspacePlan(invalid), branch);
    }
    result = f.run(["apply", "--config", f.config, "--plan", createPath, "--approve", create.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const createOperation = JSON.parse(await readFile(join(f.dirs.plans, "operations", `${create.request.operationId}.json`), "utf8"));
    assert.equal(validateOperation(createOperation), true, JSON.stringify(validateOperation.errors));
    assert.deepEqual(validateWorktreeOperation(createOperation), createOperation);
    const removePath = join(f.dirs.plans, "schema-remove.json");
    result = f.run(["worktree", "remove", "--workspace", create.request.workspaceId, "--confirm-inactive", "--config", f.config, "--plan", removePath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const remove = JSON.parse(result.stdout).plan;
    assert.equal(validate(remove), true, JSON.stringify(validate.errors));
    assert.deepEqual(validateWorkspacePlan(remove), remove);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A12 executable operation schema and runtime agree on Git-valid branch names", async () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateOperation = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas/v2/operation.schema.json"), "utf8")));
  const operation = {
    format: "workspacectl-operation/1", id: `operation-${"1".repeat(24)}`, kind: "worktree-create",
    planId: `plan-${"2".repeat(32)}`, planDigest: "3".repeat(64), configPath: "/tmp/config.json",
    repositoryId: "repo", workspaceId: "workspace", primaryPath: "/tmp/primary", path: "/tmp/worktree",
    branch: "task/valid", baseCommit: "4".repeat(40), status: "planned", outcome: null,
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
  for (const branch of ["task/valid", "valid", "release/v1.2", "@"]) {
    const candidate = { ...operation, branch };
    assert.equal(validateOperation(candidate), true, `${branch}: ${JSON.stringify(validateOperation.errors)}`);
    assert.deepEqual(validateWorktreeOperation(candidate), candidate);
  }
  for (const branch of ["bad..name", ".invalid", "bad.lock", "bad//name", "bad@{name", "bad.", "-bad", "bad\\name", "bad\tname", "bad\n"]) {
    const candidate = { ...operation, branch };
    assert.equal(validateOperation(candidate), false, branch);
    assert.throws(() => validateWorktreeOperation(candidate), branch);
  }
});

test("A12 creation preview rejects branches that Git check-ref-format rejects without writing a plan", async () => {
  const f = await fixture();
  try {
    for (const [index, branch] of [".invalid", "bad..name", "bad.lock", "bad//name", "bad@{name", "bad.", "-bad"].entries()) {
      const planPath = join(f.dirs.plans, `invalid-${index}.json`);
      const result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", branch, "--path", join(f.dirs.workspaces, `invalid-${index}`), "--config", f.config, "--plan", planPath, "--json"]);
      assert.notEqual(result.status, 0, branch);
      await assert.rejects(readFile(planPath), branch);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A12 apply refuses self-consistently replaced create and remove plans before every effect", async () => {
  const f = await fixture();
  try {
    const createPath = join(f.dirs.plans, "authoritative-create.json");
    const target = join(f.dirs.workspaces, "authoritative-create");
    let result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", "task/original", "--path", target, "--config", f.config, "--plan", createPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const originalCreate = JSON.parse(result.stdout).plan;
    const forgedCreate = await createWorktreePlan({ configPath: f.config, repositoryId: "repo", base: f.base, branch: "task/forged", path: target }, originalCreate.createdAt);
    await writeFile(createPath, JSON.stringify(forgedCreate, null, 2) + "\n");
    const createStateBefore = await readFile(f.state);
    const createGitBefore = git(f.dirs.primary, "worktree", "list", "--porcelain");
    const createPlansBefore = (await readdir(f.dirs.plans, { recursive: true })).sort();
    result = f.run(["apply", "--config", f.config, "--plan", createPath, "--approve", forgedCreate.id, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    await assert.rejects(readFile(target));
    assert.deepEqual(await readFile(f.state), createStateBefore);
    assert.equal(git(f.dirs.primary, "worktree", "list", "--porcelain"), createGitBefore);
    assert.deepEqual((await readdir(f.dirs.plans, { recursive: true })).sort(), createPlansBefore);

    const first = await createOwned(f, "authoritative-remove-one");
    const second = await createOwned(f, "authoritative-remove-two");
    const removePath = join(f.dirs.plans, "authoritative-remove.json");
    result = f.run(["worktree", "remove", "--workspace", first.workspaceId, "--confirm-inactive", "--config", f.config, "--plan", removePath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const originalRemove = JSON.parse(result.stdout).plan;
    const gitEnvKeys = ["GIT_ALLOW_PROTOCOL", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"] as const;
    const previousGitEnv = Object.fromEntries(gitEnvKeys.map((key) => [key, process.env[key]]));
    let forgedRemove;
    try {
      for (const key of gitEnvKeys) process.env[key] = f.env[key];
      forgedRemove = await createWorktreeRemovePlan({ configPath: f.config, workspaceId: second.workspaceId, confirmInactive: true }, originalRemove.createdAt);
    } finally {
      for (const key of gitEnvKeys) {
        const previous = previousGitEnv[key];
        if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
      }
    }
    await writeFile(removePath, JSON.stringify(forgedRemove, null, 2) + "\n");
    const removeStateBefore = await readFile(f.state);
    const removeGitBefore = git(f.dirs.primary, "worktree", "list", "--porcelain");
    const removePlansBefore = (await readdir(f.dirs.plans, { recursive: true })).sort();
    result = f.run(["apply", "--config", f.config, "--plan", removePath, "--approve", forgedRemove.id, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    assert.equal(git(first.target, "rev-parse", "HEAD").trim().length, 40);
    assert.equal(git(second.target, "rev-parse", "HEAD").trim().length, 40);
    assert.deepEqual(await readFile(f.state), removeStateBefore);
    assert.equal(git(f.dirs.primary, "worktree", "list", "--porcelain"), removeGitBefore);
    assert.deepEqual((await readdir(f.dirs.plans, { recursive: true })).sort(), removePlansBefore);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A12 public operation show dispatches worktree journals with fresh nonmutating observation", async () => {
  const f = await fixture();
  try {
    const target = join(f.dirs.workspaces, "shown");
    const planPath = join(f.dirs.plans, "shown.json");
    let result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", "task/shown", "--path", target, "--config", f.config, "--plan", planPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout).plan;
    result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", plan.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const journalPath = join(f.dirs.plans, "operations", `${plan.request.operationId}.json`);
    const journalBefore = await readFile(journalPath);
    const stateBefore = await readFile(f.state);
    result = f.run(["operation", "show", plan.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation.observation.valid, true);
    assert.deepEqual(await readFile(journalPath), journalBefore);
    assert.deepEqual(await readFile(f.state), stateBefore);

    git(f.dirs.primary, "worktree", "remove", target);
    result = f.run(["operation", "show", plan.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation.observation.valid, false);
    assert.deepEqual(await readFile(journalPath), journalBefore);
    assert.deepEqual(await readFile(f.state), stateBefore);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A12 creates, lists, uses, and removes an owned worktree without changing the primary or deleting the branch", async () => {
  const f = await fixture();
  try {
    const before = snapshotPrimary(f.dirs.primary);
    const target = join(f.dirs.workspaces, "task-a12");
    const createPlan = join(f.dirs.plans, "worktree-create.json");
    let result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", "task/a12", "--path", target, "--config", f.config, "--plan", createPlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.applied, false);
    assert.equal(preview.plan.kind, "worktree-create");
    await assert.rejects(readFile(target));
    result = f.run(["apply", "--config", f.config, "--plan", createPlan, "--approve", preview.plan.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(snapshotPrimary(f.dirs.primary), before);
    assert.equal(git(target, "symbolic-ref", "--short", "HEAD").trim(), "task/a12");
    await writeFile(join(target, "task.txt"), "done\n");
    git(target, "add", "task.txt"); git(target, "commit", "-m", "task");
    git(target, "push", `file://${f.bare}`, "HEAD:refs/heads/task/a12");
    result = f.run(["worktree", "list", "--repo", "repo", "--config", f.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const listed = JSON.parse(result.stdout).worktrees;
    assert.equal(listed.find((entry: any) => entry.path === target)?.owned, true);
    const removePlan = join(f.dirs.plans, "worktree-remove.json");
    result = f.run(["worktree", "remove", "--workspace", preview.plan.request.workspaceId, "--confirm-inactive", "--config", f.config, "--plan", removePlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const removal = JSON.parse(result.stdout);
    assert.equal(removal.plan.kind, "worktree-remove");
    result = f.run(["apply", "--config", f.config, "--plan", removePlan, "--approve", removal.plan.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    result = f.run(["operation", "show", removal.plan.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation.observation.valid, true);
    await assert.rejects(readFile(target));
    assert.deepEqual(snapshotPrimary(f.dirs.primary), before);
    assert.equal(git(f.dirs.primary, "show-ref", "--verify", "refs/heads/task/a12").trim().endsWith("refs/heads/task/a12"), true);
    const state = JSON.parse(await readFile(f.state, "utf8"));
    assert.equal(state.repositoryWorkspaces.some((entry: any) => entry.path === target), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

async function createOwned(f: Awaited<ReturnType<typeof fixture>>, name: string) {
  const target = join(f.dirs.workspaces, name), planPath = join(f.dirs.plans, `${name}-create.json`), branch = `task/${name}`;
  let result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", branch, "--path", target, "--config", f.config, "--plan", planPath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout).plan;
  result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", plan.id, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return { target, branch, workspaceId: plan.request.workspaceId };
}

function previewRemoval(f: Awaited<ReturnType<typeof fixture>>, workspaceId: string, name: string, confirm = true) {
  const path = join(f.dirs.plans, `${name}-remove.json`);
  const args = ["worktree", "remove", "--workspace", workspaceId, ...(confirm ? ["--confirm-inactive"] : []), "--config", f.config, "--plan", path, "--json"];
  return { path, result: f.run(args) };
}

test("A12 removal refuses dirty and unpushed worktrees and stale plans without effects", async () => {
  const f = await fixture();
  try {
    const primaryBefore = snapshotPrimary(f.dirs.primary);
    const dirty = await createOwned(f, "dirty");
    await writeFile(join(dirty.target, "untracked.txt"), "dirty\n");
    let attempted = previewRemoval(f, dirty.workspaceId, "dirty");
    assert.notEqual(attempted.result.status, 0);
    assert.equal(JSON.parse(attempted.result.stderr).error.code, "CONFLICT");
    assert.equal(await readFile(join(dirty.target, "untracked.txt"), "utf8"), "dirty\n");
    await rm(join(dirty.target, "untracked.txt"));

    await writeFile(join(dirty.target, "committed.txt"), "not pushed\n");
    git(dirty.target, "add", "committed.txt"); git(dirty.target, "commit", "-m", "unpushed");
    attempted = previewRemoval(f, dirty.workspaceId, "unpushed");
    assert.notEqual(attempted.result.status, 0);
    assert.equal(JSON.parse(attempted.result.stderr).error.code, "CONFLICT");

    git(dirty.target, "push", `file://${f.bare}`, `HEAD:refs/heads/${dirty.branch}`);
    attempted = previewRemoval(f, dirty.workspaceId, "stale");
    assert.equal(attempted.result.status, 0, attempted.result.stderr);
    const removal = JSON.parse(attempted.result.stdout).plan;
    await writeFile(join(dirty.target, "changed-after-preview.txt"), "stale\n");
    const applied = f.run(["apply", "--config", f.config, "--plan", attempted.path, "--approve", removal.id, "--json"]);
    assert.notEqual(applied.status, 0);
    assert.equal(JSON.parse(applied.stderr).error.code, "CONFLICT");
    assert.equal(await readFile(join(dirty.target, "changed-after-preview.txt"), "utf8"), "stale\n");
    assert.deepEqual(snapshotPrimary(f.dirs.primary), primaryBefore);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A12 removal refuses absent inactivity confirmation, locked, active, foreign, and identity-mismatched trees", async () => {
  const f = await fixture();
  try {
    const owned = await createOwned(f, "guarded");
    let attempted = previewRemoval(f, owned.workspaceId, "no-confirm", false);
    assert.notEqual(attempted.result.status, 0);
    assert.equal(JSON.parse(attempted.result.stderr).error.code, "APPROVAL_REQUIRED");

    git(f.dirs.primary, "worktree", "lock", owned.target);
    attempted = previewRemoval(f, owned.workspaceId, "locked");
    assert.notEqual(attempted.result.status, 0);
    assert.equal(JSON.parse(attempted.result.stderr).error.code, "BUSY");
    git(f.dirs.primary, "worktree", "unlock", owned.target);

    const sleeper = spawn("sleep", ["30"], { cwd: owned.target, stdio: "ignore" });
    try {
      attempted = previewRemoval(f, owned.workspaceId, "active");
      assert.notEqual(attempted.result.status, 0);
      assert.equal(JSON.parse(attempted.result.stderr).error.code, "BUSY");
    } finally { sleeper.kill("SIGKILL"); }

    const foreign = join(f.dirs.workspaces, "foreign");
    git(f.dirs.primary, "worktree", "add", "--detach", foreign, f.base);
    const listed = f.run(["worktree", "list", "--repo", "repo", "--config", f.config, "--json"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).worktrees.find((entry: any) => entry.path === foreign)?.owned, false);
    attempted = previewRemoval(f, "workspace-not-owned", "foreign");
    assert.notEqual(attempted.result.status, 0);
    assert.equal(JSON.parse(attempted.result.stderr).error.code, "NOT_FOUND");

    git(f.dirs.primary, "worktree", "remove", owned.target);
    git(f.root, "clone", `file://${f.bare}`, owned.target);
    git(owned.target, "remote", "set-url", "origin", "https://github.com/acme/repo");
    attempted = previewRemoval(f, owned.workspaceId, "identity");
    assert.notEqual(attempted.result.status, 0);
    assert.equal(JSON.parse(attempted.result.stderr).error.code, "CONFLICT");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A12 creation refuses wrong base, branch/path collisions, unsafe nesting, and edited plans without mutation", async () => {
  const f = await fixture();
  try {
    const before = snapshotPrimary(f.dirs.primary);
    for (const [name, base, branch, path] of [
      ["wrong-base", "0".repeat(40), "task/wrong", join(f.dirs.workspaces, "wrong")],
      ["nested", f.base, "task/nested", join(f.dirs.primary, "nested-worktree")],
    ] as const) {
      const result = f.run(["worktree", "create", "--repo", "repo", "--base", base, "--branch", branch, "--path", path, "--config", f.config, "--plan", join(f.dirs.plans, `${name}.json`), "--json"]);
      assert.notEqual(result.status, 0, name);
    }
    const first = await createOwned(f, "collision");
    let result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", first.branch, "--path", join(f.dirs.workspaces, "other"), "--config", f.config, "--plan", join(f.dirs.plans, "branch-collision.json"), "--json"]);
    assert.notEqual(result.status, 0);
    result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", "task/other", "--path", first.target, "--config", f.config, "--plan", join(f.dirs.plans, "path-collision.json"), "--json"]);
    assert.notEqual(result.status, 0);

    const editedTarget = join(f.dirs.workspaces, "edited"), editedPath = join(f.dirs.plans, "edited.json");
    result = f.run(["worktree", "create", "--repo", "repo", "--base", f.base, "--branch", "task/edited", "--path", editedTarget, "--config", f.config, "--plan", editedPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const edited = JSON.parse(result.stdout).plan;
    edited.request.branch = "task/forged";
    await writeFile(editedPath, JSON.stringify(edited) + "\n");
    result = f.run(["apply", "--config", f.config, "--plan", editedPath, "--approve", edited.id, "--json"]);
    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(editedTarget));
    assert.deepEqual(snapshotPrimary(f.dirs.primary), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
