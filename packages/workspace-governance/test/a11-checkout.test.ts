import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { canonicalJson, digest } from "../src/core.ts";
import { validateWorkspacePlan, workspacePlanSemanticFields } from "../src/v2-model.ts";
import { validateCheckoutOperation } from "../src/checkout-operations.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const tempRoot = join(tmpdir(), "workspacectl-a11-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A11 Fixture", "-c", "user.email=a11@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function fixture() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const dirs = Object.fromEntries(["config", "data", "state", "plans", "workspaces", "source", "remote"].map((name) => [name, join(root, name)]));
  await Promise.all(Object.values(dirs).map((path) => mkdir(path, { mode: 0o700 })));
  git(dirs.source, "init", "--initial-branch=main");
  await writeFile(join(dirs.source, ".gitattributes"), "*.txt text eol=lf\n");
  await writeFile(join(dirs.source, "ordinary.txt"), "main\n");
  await mkdir(join(dirs.source, "included"));
  await mkdir(join(dirs.source, "nested"));
  await writeFile(join(dirs.source, "included", "kept.txt"), "kept\n");
  await writeFile(join(dirs.source, "nested", "required.txt"), "required\n");
  await writeFile(join(dirs.source, "setup.sh"), "#!/bin/sh\nprintf ran > ../SETUP-RAN\n");
  await mkdir(join(dirs.source, ".git", "hooks"), { recursive: true });
  await writeFile(join(dirs.source, ".git", "hooks", "post-checkout"), "#!/bin/sh\nprintf ran > ../HOOK-RAN\n", { mode: 0o755 });
  git(dirs.source, "add", "."); git(dirs.source, "commit", "-m", "main");
  const main = git(dirs.source, "rev-parse", "HEAD").trim();
  git(dirs.source, "checkout", "-b", "feature/a11");
  await writeFile(join(dirs.source, "ordinary.txt"), "feature\n");
  git(dirs.source, "commit", "-am", "feature");
  const feature = git(dirs.source, "rev-parse", "HEAD").trim();
  git(dirs.source, "tag", "v1"); git(dirs.source, "checkout", "main");
  const bare = join(dirs.remote, "repo.git");
  git(root, "clone", "--bare", dirs.source, bare);
  git(bare, "symbolic-ref", "HEAD", "refs/heads/main");

  const config = join(dirs.config, "config.json"), catalog = join(dirs.data, "catalog.json"), state = join(dirs.state, "state.json"), initPlan = join(dirs.plans, "init.json");
  const rewrite = `file://${bare}`;
  const env = { ...process.env, GIT_ALLOW_PROTOCOL: "file", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url." + rewrite + ".insteadOf", GIT_CONFIG_VALUE_0: "https://github.com/acme/repo" };
  const run = (args: string[], override: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...env, ...override } });
  let result = run(["init", "--config", config, "--catalog", catalog, "--state", state, "--plans-dir", dirs.plans, "--trusted-root", dirs.workspaces, "--plan", initPlan, "--json"]);
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
  return { root, dirs, config, state, run, main, feature };
}

async function preview(f: Awaited<ReturnType<typeof fixture>>, destination: string, ref?: string) {
  const planPath = join(f.dirs.plans, `${basename(destination)}.json`);
  const args = ["checkout", "--repo", "repo", "--path", destination, "--config", f.config, "--plan", planPath, ...(ref ? ["--ref", ref] : []), "--json"];
  const result = f.run(args);
  assert.equal(result.status, 0, result.stderr);
  return { planPath, preview: JSON.parse(result.stdout) };
}

test("A11 executable plan and operation schemas align with strict runtime validation", async () => {
  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, "schema");
    const { planPath, preview: p } = await preview(f, destination);
    const ajv = new Ajv({ allErrors: true, strict: true });
    const planSchema = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas/v2/workspace-plan.schema.json"), "utf8")));
    const operationSchema = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas/v2/operation.schema.json"), "utf8")));
    assert.equal(planSchema(p.plan), true, JSON.stringify(planSchema.errors));
    assert.deepEqual(validateWorkspacePlan(p.plan), p.plan);
    const applied = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", p.plan.id, "--json"]);
    assert.equal(applied.status, 0, applied.stderr);
    const operation = JSON.parse(await readFile(join(f.dirs.plans, "operations", `${p.plan.request.operationId}.json`), "utf8"));
    assert.equal(operationSchema(operation), true, JSON.stringify(operationSchema.errors));
    assert.deepEqual(validateCheckoutOperation(operation), operation);
    for (const resolved of [
      { kind: "branch", name: null, commit: f.main },
      { kind: "tag", name: null, commit: f.main },
      { kind: "commit", name: "main", commit: f.main },
    ]) {
      const malformedPlan = structuredClone(p.plan);
      malformedPlan.request.resolved = resolved;
      assert.equal(planSchema(malformedPlan), false, `${canonicalJson(resolved)} unexpectedly passed plan schema`);
      assert.throws(() => validateWorkspacePlan(malformedPlan));
      const malformedOperation = { ...structuredClone(operation), resolved };
      assert.equal(operationSchema(malformedOperation), false, `${canonicalJson(resolved)} unexpectedly passed operation schema`);
      assert.throws(() => validateCheckoutOperation(malformedOperation));
    }
    for (const resolved of [
      { kind: "branch", name: "main", commit: f.main },
      { kind: "tag", name: "v1", commit: f.feature },
      { kind: "commit", name: null, commit: f.main },
    ]) {
      const validPlan = structuredClone(p.plan);
      validPlan.request.resolved = resolved;
      assert.equal(planSchema(validPlan), true, JSON.stringify(planSchema.errors));
      assert.deepEqual(validateWorkspacePlan(validPlan), validPlan);
      const validOperation = { ...structuredClone(operation), resolved };
      assert.equal(operationSchema(validOperation), true, JSON.stringify(operationSchema.errors));
      assert.deepEqual(validateCheckoutOperation(validOperation), validOperation);
    }
    for (const malformed of [
      { ...structuredClone(operation), status: "replay" },
      { ...structuredClone(operation), destination: "relative" },
      { ...structuredClone(operation), resolved: {} },
      { ...structuredClone(operation), credential: "secret" },
    ]) {
      assert.equal(operationSchema(malformed), false);
      assert.throws(() => validateCheckoutOperation(malformed));
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A11 apply freshly rederives the complete canonical checkout plan before any effect", async () => {
  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, "edited-plan");
    const { planPath, preview: p } = await preview(f, destination);
    const edited = structuredClone(p.plan);
    const forgedRevision = `sha256:${"b".repeat(64)}`;
    edited.inputRevisions.sources.remoteRef = "c".repeat(64);
    edited.request.localStateChange.nextRevision = forgedRevision;
    edited.actions = [{ ...edited.actions[2], nextRevision: forgedRevision }];
    edited.expectedOutputs = [{ ...edited.expectedOutputs[0], revision: forgedRevision }];
    edited.semanticDigest = digest(workspacePlanSemanticFields(edited));
    edited.id = `plan-${edited.semanticDigest.slice(0, 32)}`;
    assert.deepEqual(validateWorkspacePlan(edited), edited);
    await writeFile(planPath, JSON.stringify(edited, null, 2) + "\n");
    const stateBefore = await readFile(f.state);
    const result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", edited.id, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    assert.deepEqual(await readFile(f.state), stateBefore);
    await assert.rejects(readFile(destination));
    await assert.rejects(readFile(p.plan.request.stagingPath));
    await assert.rejects(readFile(join(f.dirs.plans, "operations", `${p.plan.request.operationId}.json`)));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const [name, ref, expectedHead, branch] of [
  ["default branch", undefined, "main", "main"],
  ["explicit branch", "branch:feature/a11", "feature", "feature/a11"],
  ["explicit tag", "tag:v1", "feature", null],
  ["explicit commit", "commit:MAIN", "main", null],
] as const) test(`A11 checkout ${name} is revision-bound, usable, and does not execute repository code`, async () => {
  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, name.replaceAll(" ", "-"));
    const { planPath, preview: p } = await preview(f, destination, ref === "commit:MAIN" ? `commit:${f.main}` : ref);
    assert.equal(p.applied, false);
    assert.equal(p.plan.kind, "checkout");
    assert.equal(p.plan.request.destination, destination);
    assert.equal(p.plan.request.resolved.commit, expectedHead === "main" ? f.main : f.feature);
    await assert.rejects(readFile(destination));
    const applied = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", p.plan.id, "--json"]);
    assert.equal(applied.status, 0, applied.stderr);
    const body = JSON.parse(applied.stdout);
    assert.equal(body.kind, "checkout");
    assert.equal(git(destination, "config", "--get", "remote.origin.url"), "https://github.com/acme/repo\n");
    assert.equal(git(destination, "rev-parse", "HEAD").trim(), p.plan.request.resolved.commit);
    const symbolic = spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: destination, encoding: "utf8" });
    assert.equal(symbolic.status === 0 ? symbolic.stdout.trim() : null, branch);
    assert.equal(await readFile(join(destination, "ordinary.txt"), "utf8"), expectedHead === "main" ? "main\n" : "feature\n");
    assert.equal(await readFile(join(destination, ".gitattributes"), "utf8"), "*.txt text eol=lf\n");
    await assert.rejects(readFile(join(f.root, "SETUP-RAN")));
    await assert.rejects(readFile(join(f.dirs.workspaces, "HOOK-RAN")));
    const state = JSON.parse(await readFile(f.state, "utf8"));
    assert.equal(state.repositoryWorkspaces.at(-1).path, destination);
    assert.equal(state.repositoryWorkspaces.at(-1).branch, branch);
    const shown = f.run(["operation", "show", p.plan.request.operationId, "--config", f.config, "--json"]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(JSON.parse(shown.stdout).operation.status, "completed");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A11 collision, stale approval, auth failure, unsafe path, wrong identity, and changed ref do not mutate unrelated state", async () => {
  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, "guarded");
    const { planPath, preview: p } = await preview(f, destination, "branch:feature/a11");
    const before = await readFile(f.state);
    let result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", "plan-wrong", "--json"]);
    assert.equal(JSON.parse(result.stderr).error.code, "APPROVAL_REQUIRED");
    assert.deepEqual(await readFile(f.state), before);
    await mkdir(destination);
    result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", p.plan.id, "--json"]);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    assert.deepEqual(await readFile(f.state), before);
    await rm(destination, { recursive: true });

    const symlinkPath = join(f.dirs.workspaces, "link");
    await symlink(f.dirs.source, symlinkPath, "dir");
    result = f.run(["checkout", "--repo", "repo", "--path", symlinkPath, "--config", f.config, "--plan", join(f.dirs.plans, "unsafe.json"), "--json"]);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readFile(f.state), before);

    const authDest = join(f.dirs.workspaces, "auth-failure");
    const auth = await preview(f, authDest);
    result = f.run(["apply", "--config", f.config, "--plan", auth.planPath, "--approve", auth.preview.plan.id, "--json"], { GIT_CONFIG_COUNT: "0", GIT_TERMINAL_PROMPT: "0" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readFile(f.state), before);
    assert.ok(!JSON.stringify(auth.preview.plan).includes("GIT_CONFIG_VALUE"));

    git(f.dirs.source, "checkout", "feature/a11");
    await writeFile(join(f.dirs.source, "changed.txt"), "changed\n"); git(f.dirs.source, "add", "."); git(f.dirs.source, "commit", "-m", "changed");
    git(f.dirs.source, "push", `file://${join(f.dirs.remote, "repo.git")}`, "feature/a11");
    const changedDest = join(f.dirs.workspaces, "changed-ref");
    const changed = await preview(f, changedDest, "branch:feature/a11");
    git(f.dirs.source, "commit", "--allow-empty", "-m", "changed again"); git(f.dirs.source, "push", `file://${join(f.dirs.remote, "repo.git")}`, "feature/a11");
    result = f.run(["apply", "--config", f.config, "--plan", changed.planPath, "--approve", changed.preview.plan.id, "--json"]);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    assert.deepEqual(await readFile(f.state), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A11 LFS pointers refuse when verified LFS materialization is unavailable", async () => {
  const f = await fixture();
  try {
    git(f.dirs.source, "checkout", "main");
    await writeFile(join(f.dirs.source, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
    await writeFile(join(f.dirs.source, "asset.bin"), "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 4\n");
    git(f.dirs.source, "add", "."); git(f.dirs.source, "commit", "-m", "lfs pointer"); git(f.dirs.source, "push", `file://${join(f.dirs.remote, "repo.git")}`, "main");
    const destination = join(f.dirs.workspaces, "lfs");
    const { planPath, preview: p } = await preview(f, destination);
    const result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", p.plan.id, "--json"], { PATH: "/usr/bin:/bin" });
    assert.notEqual(result.status, 0);
    assert.match(JSON.parse(result.stderr).error.code, /UNSUPPORTED|ACTION_FAILED/);
    await assert.rejects(readFile(destination));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A11 interrupted clone is preserved; show reports needs-attention; reconcile refuses ambiguity and only plans safe binding repair", async () => {
  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, "interrupted");
    const { planPath, preview: p } = await preview(f, destination);
    await mkdir(p.plan.request.stagingPath);
    await writeFile(join(p.plan.request.stagingPath, "partial.pack"), "keep me\n");
    let result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", p.plan.id, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(p.plan.request.stagingPath, "partial.pack"), "utf8"), "keep me\n");
    result = f.run(["operation", "show", p.plan.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation.status, "needs-attention");
    result = f.run(["operation", "reconcile", p.plan.request.operationId, "--config", f.config, "--plan", join(f.dirs.plans, "ambiguous-reconcile.json"), "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(p.plan.request.stagingPath, "partial.pack"), "utf8"), "keep me\n");

    await rm(p.plan.request.stagingPath, { recursive: true });
    git(f.root, "clone", "--no-recurse-submodules", `file://${join(f.dirs.remote, "repo.git")}`, p.plan.request.stagingPath);
    git(p.plan.request.stagingPath, "remote", "set-url", "origin", "https://github.com/acme/repo");
    await rename(p.plan.request.stagingPath, destination);
    result = f.run(["operation", "reconcile", p.plan.request.operationId, "--config", f.config, "--plan", join(f.dirs.plans, "reconcile.json"), "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const repair = JSON.parse(result.stdout);
    assert.equal(repair.applied, false);
    assert.equal(repair.plan.kind, "checkout-reconcile");
    let state = JSON.parse(await readFile(f.state, "utf8"));
    assert.equal(state.repositoryWorkspaces.length, 0);
    result = f.run(["apply", "--config", f.config, "--plan", join(f.dirs.plans, "reconcile.json"), "--approve", repair.plan.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    state = JSON.parse(await readFile(f.state, "utf8"));
    assert.equal(state.repositoryWorkspaces[0].path, destination);
    result = f.run(["operation", "show", p.plan.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation.status, "completed");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A11 operation show derives needs-attention from fresh invalid observations without journal mutation", async () => {
  for (const invalidation of ["absent", "wrong-origin", "wrong-ref"] as const) {
    const f = await fixture();
    try {
      const destination = join(f.dirs.workspaces, `show-${invalidation}`);
      const { planPath, preview: p } = await preview(f, destination);
      const applied = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", p.plan.id, "--json"]);
      assert.equal(applied.status, 0, applied.stderr);
      const journalPath = join(f.dirs.plans, "operations", `${p.plan.request.operationId}.json`);
      const journalBefore = await readFile(journalPath);
      if (invalidation === "absent") await rm(destination, { recursive: true });
      else if (invalidation === "wrong-origin") git(destination, "remote", "set-url", "origin", "https://github.com/other/repo");
      else git(destination, "checkout", "--detach", f.feature);
      const shown = f.run(["operation", "show", p.plan.request.operationId, "--config", f.config, "--json"]);
      assert.equal(shown.status, 3, shown.stderr);
      assert.equal(JSON.parse(shown.stdout).operation.status, "needs-attention");
      assert.deepEqual(await readFile(journalPath), journalBefore);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("A11 reconcile refuses dirty or incomplete tracked content and preserves checkout bytes", async () => {
  for (const damage of ["deleted", "modified", "untracked", "skip-worktree-deleted", "skip-worktree-modified", "assume-unchanged-deleted", "assume-unchanged-modified", "sparse-index-deleted"] as const) {
    const f = await fixture();
    try {
      const destination = join(f.dirs.workspaces, `reconcile-${damage}`);
      const { planPath, preview: p } = await preview(f, destination);
      await mkdir(p.plan.request.stagingPath);
      const interrupted = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", p.plan.id, "--json"]);
      assert.notEqual(interrupted.status, 0);
      await rm(p.plan.request.stagingPath, { recursive: true });
      git(f.root, "clone", "--no-recurse-submodules", `file://${join(f.dirs.remote, "repo.git")}`, destination);
      git(destination, "remote", "set-url", "origin", "https://github.com/acme/repo");
      const target = damage === "untracked" ? join(destination, "untracked.txt") : damage === "sparse-index-deleted" ? join(destination, "nested", "required.txt") : join(destination, "ordinary.txt");
      if (damage === "sparse-index-deleted") {
        git(destination, "sparse-checkout", "set", "--sparse-index", "included");
        await assert.rejects(readFile(target));
        assert.equal(git(destination, "status", "--porcelain=v1", "--untracked-files=all"), "");
      } else if (damage.startsWith("skip-worktree-") || damage.startsWith("assume-unchanged-")) {
        const flag = damage.startsWith("skip-worktree-") ? "skip-worktree" : "assume-unchanged";
        git(destination, "update-index", `--${flag}`, "ordinary.txt");
        if (damage.endsWith("-deleted")) await rm(target);
        else await writeFile(target, "hidden modification\n");
        assert.equal(git(destination, "status", "--porcelain=v1", "--untracked-files=all"), "");
      } else if (damage === "deleted") await rm(target);
      else await writeFile(target, `${damage}\n`);
      const before = await readFile(target).catch(() => null);
      const stateBefore = await readFile(f.state);
      const journalPath = join(f.dirs.plans, "operations", `${p.plan.request.operationId}.json`);
      const journalBefore = await readFile(journalPath);
      const reconcilePath = join(f.dirs.plans, `${damage}.json`);
      const result = f.run(["operation", "reconcile", p.plan.request.operationId, "--config", f.config, "--plan", reconcilePath, "--json"]);
      assert.notEqual(result.status, 0, result.stdout);
      assert.equal(JSON.parse(result.stderr).error.code, "UNSUPPORTED");
      assert.deepEqual(await readFile(target).catch(() => null), before);
      assert.deepEqual(await readFile(f.state), stateBefore);
      assert.deepEqual(await readFile(journalPath), journalBefore);
      await assert.rejects(readFile(reconcilePath));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
