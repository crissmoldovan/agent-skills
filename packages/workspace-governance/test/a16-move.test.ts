import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { Ajv } from "ajv";
import { validateMoveOperation } from "../src/move-operations.ts";
import { validateWorkspacePlan } from "../src/v2-model.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = process.env.WORKSPACECTL_E2E_CLI ?? fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tempRoot = join(homedir(), "tmp", "workspacectl-a16-tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=A16 Fixture", "-c", "user.email=a16@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function snapshotPath(path: string): Promise<unknown> {
  try {
    const status = await lstat(path);
    const mode = status.mode & 0o7777;
    if (status.isSymbolicLink()) return { kind: "symlink", mode, target: await readlink(path) };
    if (status.isDirectory()) {
      const entries: Record<string, unknown> = {};
      for (const name of (await readdir(path)).sort()) entries[name] = await snapshotPath(join(path, name));
      return { kind: "directory", mode, entries };
    }
    if (status.isFile()) return { kind: "file", mode, bytes: (await readFile(path)).toString("base64") };
    return { kind: "other", mode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fixture(options: { crossFilesystem?: boolean } = {}) {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const crossRoot = options.crossFilesystem ? join("/dev/shm", `workspacectl-a16-${root.split("/").at(-1)}`) : null;
  if (crossRoot !== null) await mkdir(crossRoot, { recursive: true, mode: 0o700 });
  const dirs = Object.fromEntries(["config", "data", "state", "plans", "workspaces", "source"].map((name) => [name, join(root, name)]));
  await Promise.all(Object.values(dirs).map((path) => mkdir(path, { mode: 0o700 })));
  git(dirs.source, "init", "--initial-branch=main");
  await writeFile(join(dirs.source, "tracked.txt"), "move me\n");
  git(dirs.source, "add", "."); git(dirs.source, "commit", "-m", "initial");
  git(dirs.source, "remote", "add", "origin", "https://github.com/acme/repo");
  const head = git(dirs.source, "rev-parse", "HEAD").trim();
  const config = join(dirs.config, "config.json"), catalog = join(dirs.data, "catalog.json"), state = join(dirs.state, "state.json");
  const run = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  let result = run(["init", "--config", config, "--catalog", catalog, "--state", state, "--plans-dir", dirs.plans, "--trusted-root", root, ...(crossRoot === null ? [] : ["--trusted-root", crossRoot]), "--plan", join(dirs.plans, "init.json"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  result = run(["apply", "--config", config, "--plan", join(dirs.plans, "init.json"), "--approve", JSON.parse(result.stdout).plan.id, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const draft = JSON.parse(run(["config", "export", "--target", "catalog", "--config", config]).stdout);
  draft.document.repositories = [{ id: "repo", remote: "https://github.com/acme/repo", sourceId: null, primaryGroupId: null, memberOf: [], aliases: [], classification: "confirmed", metadata: {} }];
  await writeFile(join(root, "catalog-draft.json"), JSON.stringify(draft) + "\n");
  result = run(["config", "plan", join(root, "catalog-draft.json"), "--config", config, "--plan", join(dirs.plans, "seed.json"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  result = run(["apply", "--config", config, "--plan", join(dirs.plans, "seed.json"), "--approve", JSON.parse(result.stdout).plan.id, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  result = run(["adopt", "--repo", "repo", "--path", dirs.source, "--config", config, "--plan", join(dirs.plans, "adopt.json"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const adopt = JSON.parse(result.stdout).plan;
  result = run(["apply", "--config", config, "--plan", join(dirs.plans, "adopt.json"), "--approve", adopt.id, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return { root, crossRoot, dirs, config, state, run, head, workspaceId: adopt.request.workspaceId };
}

test("A16 explicitly approved move renames one clean standalone checkout and preserves stable identity", async () => {
  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, "moved");
    const planPath = join(f.dirs.plans, "move.json");
    let result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.applied, false);
    assert.equal(preview.plan.kind, "checkout-move");
    assert.equal(preview.plan.request.source, f.dirs.source);
    assert.equal(preview.plan.request.destination, destination);
    assert.equal(git(f.dirs.source, "rev-parse", "HEAD").trim(), f.head);
    result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", preview.plan.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(readFile(join(f.dirs.source, "tracked.txt")));
    assert.equal(await readFile(join(destination, "tracked.txt"), "utf8"), "move me\n");
    assert.equal(git(destination, "rev-parse", "HEAD").trim(), f.head);
    const state = JSON.parse(await readFile(f.state, "utf8"));
    const binding = state.repositoryWorkspaces.find((entry: any) => entry.id === f.workspaceId);
    assert.equal(binding.repositoryId, "repo");
    assert.equal(binding.path, destination);
    result = f.run(["operation", "show", preview.plan.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).operation.status, "completed");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A16 move plan and journal align with executable schemas and strict runtime validators", async () => {
  const f = await fixture();
  try {
    const planPath = join(f.dirs.plans, "schema-move.json"), destination = join(f.dirs.workspaces, "schema-moved");
    let result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout).plan;
    const ajv = new Ajv({ allErrors: true, strict: true });
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const planSchema = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas/v2/workspace-plan.schema.json"), "utf8")));
    const operationSchema = ajv.compile(JSON.parse(await readFile(join(packageRoot, "schemas/v2/operation.schema.json"), "utf8")));
    assert.equal(planSchema(plan), true, JSON.stringify(planSchema.errors));
    assert.deepEqual(validateWorkspacePlan(plan), plan);
    result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", plan.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const operation = JSON.parse(await readFile(join(f.dirs.plans, "operations", `${plan.request.operationId}.json`), "utf8"));
    assert.equal(operationSchema(operation), true, JSON.stringify(operationSchema.errors));
    assert.deepEqual(validateMoveOperation(operation), operation);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A16 dirty, busy, collision, nested, symlink, wrong identity, stale checkout, and wrong approval refuse unchanged", async () => {
  for (const refusal of ["dirty", "busy", "collision", "nested", "wrong-identity"] as const) {
    const f = await fixture();
    try {
      const before = await readFile(f.state), destination = refusal === "nested" ? join(f.dirs.source, "nested") : join(f.dirs.workspaces, refusal);
      let sleeper: ReturnType<typeof spawn> | undefined;
      if (refusal === "dirty") await writeFile(join(f.dirs.source, "dirty.txt"), "dirty\n");
      if (refusal === "busy") sleeper = spawn("sleep", ["30"], { cwd: f.dirs.source, stdio: "ignore" });
      if (refusal === "collision") await mkdir(destination);
      if (refusal === "wrong-identity") git(f.dirs.source, "remote", "set-url", "origin", "https://github.com/other/repo");
      const result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", join(f.dirs.plans, `${refusal}.json`), "--json"]);
      sleeper?.kill("SIGKILL");
      assert.notEqual(result.status, 0, refusal);
      assert.deepEqual(await readFile(f.state), before);
      assert.equal(git(f.dirs.source, "rev-parse", "HEAD").trim(), f.head);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }

  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, "stale"), planPath = join(f.dirs.plans, "stale.json");
    let result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);
    assert.equal(result.status, 0, result.stderr); const plan = JSON.parse(result.stdout).plan; const before = await readFile(f.state);
    result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", "plan-wrong", "--json"]);
    assert.equal(JSON.parse(result.stderr).error.code, "APPROVAL_REQUIRED");
    await writeFile(join(f.dirs.source, "changed.txt"), "changed\n");
    result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", plan.id, "--json"]);
    assert.notEqual(result.status, 0); assert.deepEqual(await readFile(f.state), before); assert.equal(await readFile(join(f.dirs.source, "changed.txt"), "utf8"), "changed\n");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A16 linked worktree, submodule, and symlink-redirection moves refuse without changing binding", async () => {
  for (const refusal of ["linked", "submodule", "symlink"] as const) {
    const f = await fixture();
    try {
      let destination = join(f.dirs.workspaces, refusal);
      if (refusal === "linked") {
        const primary = join(f.root, "relocated-primary");
        await rename(f.dirs.source, primary);
        git(primary, "worktree", "add", "--detach", f.dirs.source, f.head);
      } else if (refusal === "submodule") {
        const child = join(f.root, "child"); await mkdir(child); git(child, "init", "--initial-branch=main"); await writeFile(join(child, "child.txt"), "child\n"); git(child, "add", "."); git(child, "commit", "-m", "child");
        execFileSync("git", ["-c", "protocol.file.allow=always", "-c", "user.name=A16 Fixture", "-c", "user.email=a16@example.invalid", "submodule", "add", child, "nested-child"], { cwd: f.dirs.source, stdio: "pipe" });
        git(f.dirs.source, "commit", "-am", "submodule");
      } else {
        const actual = join(f.root, "actual-destination-parent"); await mkdir(actual); const link = join(f.dirs.workspaces, "redirect"); await symlink(actual, link, "dir"); destination = join(link, "moved");
      }
      const before = await readFile(f.state);
      const result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", join(f.dirs.plans, `${refusal}.json`), "--json"]);
      assert.notEqual(result.status, 0, refusal);
      assert.deepEqual(await readFile(f.state), before);
      assert.equal(JSON.parse(await readFile(f.state, "utf8")).repositoryWorkspaces[0].path, f.dirs.source);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("A16 main checkout owning linked-worktree metadata refuses preview and late apply without mutation", async () => {
  for (const phase of ["preview", "late-apply"] as const) {
    const f = await fixture();
    try {
      const destination = join(f.dirs.workspaces, `main-with-worktree-${phase}`);
      const planPath = join(f.dirs.plans, `main-with-worktree-${phase}.json`);
      let plan: any;
      if (phase === "late-apply") {
        const planned = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);
        assert.equal(planned.status, 0, planned.stderr);
        plan = JSON.parse(planned.stdout).plan;
      }

      const linked = join(f.root, `linked-${phase}`);
      git(f.dirs.source, "worktree", "add", "--detach", linked, f.head);
      const metadata = join(f.dirs.source, ".git", "worktrees");
      const before = {
        state: await readFile(f.state),
        metadata: await snapshotPath(metadata),
        worktrees: git(f.dirs.source, "worktree", "list", "--porcelain"),
        sourceHead: git(f.dirs.source, "rev-parse", "HEAD"),
        sourceStatus: git(f.dirs.source, "status", "--porcelain=v1", "--untracked-files=all"),
        linkedHead: git(linked, "rev-parse", "HEAD"),
        linkedCommon: git(linked, "rev-parse", "--path-format=absolute", "--git-common-dir"),
        linkedFile: await readFile(join(linked, "tracked.txt")),
        plan: await snapshotPath(planPath),
      };

      const result = phase === "preview"
        ? f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"])
        : f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", plan.id, "--json"]);

      assert.notEqual(result.status, 0, phase);
      assert.equal(JSON.parse(result.stderr).error.code, "UNSUPPORTED");
      assert.deepEqual(await readFile(f.state), before.state);
      assert.deepEqual(await snapshotPath(metadata), before.metadata);
      assert.equal(git(f.dirs.source, "worktree", "list", "--porcelain"), before.worktrees);
      assert.equal(git(f.dirs.source, "rev-parse", "HEAD"), before.sourceHead);
      assert.equal(git(f.dirs.source, "status", "--porcelain=v1", "--untracked-files=all"), before.sourceStatus);
      assert.equal(git(linked, "rev-parse", "HEAD"), before.linkedHead);
      assert.equal(git(linked, "rev-parse", "--path-format=absolute", "--git-common-dir"), before.linkedCommon);
      assert.deepEqual(await readFile(join(linked, "tracked.txt")), before.linkedFile);
      assert.equal(await snapshotPath(destination), null);
      assert.deepEqual(await snapshotPath(planPath), before.plan);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("A16 unsafe linked-worktree registrations refuse without prune, repair, or move", async () => {
  for (const registration of ["locked", "stale", "malformed", "symlinked", "unreadable"] as const) {
    const f = await fixture();
    const destination = join(f.dirs.workspaces, `unsafe-registration-${registration}`);
    try {
      const registrations = join(f.dirs.source, ".git", "worktrees");
      const entry = join(registrations, registration);
      let linked: string | undefined;
      if (registration === "locked" || registration === "stale") {
        linked = join(f.root, `linked-${registration}`);
        git(f.dirs.source, "worktree", "add", "--detach", linked, f.head);
        const actualEntry = (await readdir(registrations))[0];
        if (registration === "locked") git(f.dirs.source, "worktree", "lock", linked);
        else await rm(linked, { recursive: true, force: true });
        assert.ok(actualEntry);
      } else {
        await mkdir(registrations, { recursive: true });
        if (registration === "symlinked") {
          const external = join(f.root, "external-registration");
          await mkdir(external);
          await symlink(external, entry, "dir");
        } else {
          await mkdir(entry);
          await writeFile(join(entry, "gitdir"), registration === "malformed" ? "not-a-path\n" : `${join(f.root, "missing", ".git")}\n`);
          if (registration === "unreadable") await chmod(entry, 0o000);
        }
      }

      const rawBefore = registration === "unreadable"
        ? { names: await readdir(registrations), mode: (await lstat(entry)).mode & 0o7777 }
        : await snapshotPath(registrations);
      const before = {
        state: await readFile(f.state),
        raw: rawBefore,
        worktrees: git(f.dirs.source, "worktree", "list", "--porcelain"),
        sourceHead: git(f.dirs.source, "rev-parse", "HEAD"),
        sourceStatus: git(f.dirs.source, "status", "--porcelain=v1", "--untracked-files=all"),
        sourceFile: await readFile(join(f.dirs.source, "tracked.txt")),
        linkedHead: linked && registration === "locked" ? git(linked, "rev-parse", "HEAD") : null,
      };
      const planPath = join(f.dirs.plans, `unsafe-registration-${registration}.json`);
      const result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);

      assert.notEqual(result.status, 0, registration);
      assert.equal(JSON.parse(result.stderr).error.code, "UNSUPPORTED");
      assert.deepEqual(await readFile(f.state), before.state);
      const rawAfter = registration === "unreadable"
        ? { names: await readdir(registrations), mode: (await lstat(entry)).mode & 0o7777 }
        : await snapshotPath(registrations);
      assert.deepEqual(rawAfter, before.raw);
      assert.equal(git(f.dirs.source, "worktree", "list", "--porcelain"), before.worktrees);
      assert.equal(git(f.dirs.source, "rev-parse", "HEAD"), before.sourceHead);
      assert.equal(git(f.dirs.source, "status", "--porcelain=v1", "--untracked-files=all"), before.sourceStatus);
      assert.deepEqual(await readFile(join(f.dirs.source, "tracked.txt")), before.sourceFile);
      if (linked && registration === "locked") assert.equal(git(linked, "rev-parse", "HEAD"), before.linkedHead);
      assert.equal(await snapshotPath(destination), null);
      assert.equal(await snapshotPath(planPath), null);
    } finally {
      if (registration === "unreadable") {
        for (const base of [f.dirs.source, destination]) {
          try { await chmod(join(base, ".git", "worktrees", registration), 0o700); } catch {}
        }
      }
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("A16 move preview refuses an ignored nested Git repository without writing a plan", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dirs.source, ".gitignore"), "ignored/\n");
    git(f.dirs.source, "add", ".gitignore");
    git(f.dirs.source, "commit", "-m", "ignore nested fixture");
    const nested = join(f.dirs.source, "ignored", "child");
    await mkdir(nested, { recursive: true });
    git(nested, "init", "--initial-branch=main");
    await writeFile(join(nested, "child.txt"), "nested\n");
    git(nested, "add", ".");
    git(nested, "commit", "-m", "nested");
    assert.equal(git(f.dirs.source, "status", "--porcelain=v1", "--untracked-files=all"), "");

    const before = await readFile(f.state);
    const destination = join(f.dirs.workspaces, "nested-ignored-move");
    const planPath = join(f.dirs.plans, "nested-ignored.json");
    const result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);

    assert.notEqual(result.status, 0);
    assert.deepEqual(await readFile(f.state), before);
    assert.equal(await readFile(join(f.dirs.source, "ignored", "child", "child.txt"), "utf8"), "nested\n");
    await assert.rejects(readFile(join(destination, "tracked.txt")));
    await assert.rejects(readFile(planPath));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("A16 move preview refuses repository clean and process filters without executing them or writing a plan", async () => {
  for (const kind of ["clean", "process"] as const) {
    const f = await fixture();
    try {
      await writeFile(join(f.dirs.source, ".gitattributes"), "tracked.txt filter=canary\n");
      git(f.dirs.source, "add", ".gitattributes");
      git(f.dirs.source, "commit", "-m", "add filter attribute");
      const marker = join(f.root, `${kind}-executed`);
      const canary = join(f.root, `${kind}-canary.cjs`);
      await writeFile(canary, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed\\n");\n`);
      git(f.dirs.source, "config", `filter.canary.${kind}`, `${process.execPath} ${canary}`);

      const before = await readFile(f.state);
      const destination = join(f.dirs.workspaces, `${kind}-filter-move`);
      const planPath = join(f.dirs.plans, `${kind}-filter.json`);
      const result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);

      assert.notEqual(result.status, 0, kind);
      assert.deepEqual(await readFile(f.state), before);
      assert.equal(await readFile(join(f.dirs.source, "tracked.txt"), "utf8"), "move me\n");
      await assert.rejects(readFile(marker));
      await assert.rejects(readFile(planPath));
      await assert.rejects(readFile(join(destination, "tracked.txt")));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("A16 cross-filesystem move refuses unchanged without copy fallback", async (t) => {
  const f = await fixture({ crossFilesystem: true });
  try {
    assert.notEqual(f.crossRoot, null);
    if ((await stat(f.dirs.source)).dev === (await stat(f.crossRoot!)).dev) { t.skip("fixture filesystems share a device"); return; }
    const before = await readFile(f.state), destination = join(f.crossRoot!, "moved");
    const result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", join(f.dirs.plans, "cross-filesystem.json"), "--json"]);
    assert.notEqual(result.status, 0); assert.equal(JSON.parse(result.stderr).error.code, "UNSUPPORTED");
    assert.deepEqual(await readFile(f.state), before); assert.equal(await readFile(join(f.dirs.source, "tracked.txt"), "utf8"), "move me\n");
    await assert.rejects(readFile(join(destination, "tracked.txt")));
  } finally { await rm(f.root, { recursive: true, force: true }); if (f.crossRoot !== null) await rm(f.crossRoot, { recursive: true, force: true }); }
});

test("A16 rename-success state-save-failure is shown and repaired only by an exact approved reconcile plan", async () => {
  const f = await fixture();
  try {
    const destination = join(f.dirs.workspaces, "repair"), planPath = join(f.dirs.plans, "repair-move.json");
    let result = f.run(["move", f.workspaceId, "--to", destination, "--confirm-inactive", "--config", f.config, "--plan", planPath, "--json"]);
    assert.equal(result.status, 0, result.stderr); const move = JSON.parse(result.stdout).plan;
    const lock = `${f.state}.lock`; await writeFile(lock, "held\n");
    result = f.run(["apply", "--config", f.config, "--plan", planPath, "--approve", move.id, "--json"]);
    assert.notEqual(result.status, 0); await rm(lock);
    await assert.rejects(readFile(join(f.dirs.source, "tracked.txt")));
    assert.equal(await readFile(join(destination, "tracked.txt"), "utf8"), "move me\n");
    let state = JSON.parse(await readFile(f.state, "utf8")); assert.equal(state.repositoryWorkspaces[0].path, f.dirs.source);
    result = f.run(["operation", "show", move.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 3, result.stderr); const shown = JSON.parse(result.stdout).operation;
    assert.equal(shown.observation.sourcePresent, false); assert.equal(shown.observation.destinationValid, true); assert.equal(shown.observation.bindingAtSource, true);
    const reconcilePath = join(f.dirs.plans, "repair-reconcile.json");
    result = f.run(["operation", "reconcile", move.request.operationId, "--config", f.config, "--plan", reconcilePath, "--json"]);
    assert.equal(result.status, 0, result.stderr); const repair = JSON.parse(result.stdout).plan;
    assert.equal(repair.kind, "checkout-move-reconcile"); assert.deepEqual(repair.actions.map((entry: any) => entry.type), ["document-cas"]);
    result = f.run(["apply", "--config", f.config, "--plan", reconcilePath, "--approve", "plan-wrong", "--json"]);
    assert.equal(JSON.parse(result.stderr).error.code, "APPROVAL_REQUIRED");
    result = f.run(["apply", "--config", f.config, "--plan", reconcilePath, "--approve", repair.id, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    state = JSON.parse(await readFile(f.state, "utf8")); assert.equal(state.repositoryWorkspaces[0].path, destination);
    result = f.run(["operation", "show", move.request.operationId, "--config", f.config, "--json"]);
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).operation.status, "completed");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
