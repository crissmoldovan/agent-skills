import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });

async function missing(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

test("M2 public init preview and exact apply create an isolated setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-cli-init-"));
  try {
    const configDir = join(root, "config");
    const dataDir = join(root, "data");
    const stateDir = join(root, "state");
    const plansDir = join(root, "plans");
    const trustedRoot = join(root, "workspaces");
    await Promise.all(
      [configDir, dataDir, stateDir, plansDir, trustedRoot].map((path) => mkdir(path)),
    );
    const config = join(configDir, "config.yaml");
    const catalog = join(dataDir, "catalog.json");
    const state = join(stateDir, "local-state.json");
    const planPath = join(plansDir, "init.json");
    const initArgs = [
      "init",
      "--config",
      config,
      "--catalog",
      catalog,
      "--state",
      state,
      "--plans-dir",
      plansDir,
      "--trusted-root",
      trustedRoot,
      "--plan",
      planPath,
      "--json",
    ];
    const preview = run(initArgs);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(preview.stderr, "");
    const previewBody = JSON.parse(preview.stdout);
    assert.equal(previewBody.ok, true);
    assert.equal(previewBody.command, "init");
    assert.equal(previewBody.applied, false);
    assert.equal(previewBody.planPath, planPath);
    assert.match(previewBody.plan.id, /^plan-[a-f0-9]{32}$/);
    assert.equal(await missing(planPath), false);
    for (const path of [config, catalog, state]) assert.equal(await missing(path), true, path);

    const absentApproval = run([
      "apply",
      "--config",
      config,
      "--plan",
      planPath,
      "--json",
    ]);
    assert.equal(absentApproval.status, 4, absentApproval.stderr);
    assert.equal(absentApproval.stdout, "");
    assert.equal(JSON.parse(absentApproval.stderr).error.code, "APPROVAL_REQUIRED");
    for (const path of [config, catalog, state]) assert.equal(await missing(path), true, path);

    const applied = run([
      "apply",
      "--config",
      config,
      "--plan",
      planPath,
      "--approve",
      previewBody.plan.id,
      "--json",
    ]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(applied.stderr, "");
    const appliedBody = JSON.parse(applied.stdout);
    assert.equal(appliedBody.ok, true);
    assert.equal(appliedBody.command, "apply");
    assert.equal(appliedBody.applied, true);
    assert.equal(appliedBody.planId, previewBody.plan.id);
    assert.equal(appliedBody.kind, "init");
    assert.equal(appliedBody.readback.config.documentType, "workspacectl/config");
    assert.equal(appliedBody.readback.catalog.documentType, "workspacectl/catalog");
    assert.equal(appliedBody.readback.localState.documentType, "workspacectl/local-state");
    for (const path of [config, catalog, state]) assert.equal(await missing(path), false, path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M2 doctor validates the selected config, trusted roots, and both actual stores", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-cli-doctor-"));
  try {
    const dirs = Object.fromEntries(
      ["config", "data", "state", "plans", "workspaces", "skill"].map((name) => [name, join(root, name)]),
    );
    await Promise.all(Object.values(dirs).map((path) => mkdir(path)));
    const config = join(dirs.config, "config.yaml");
    const catalog = join(dirs.data, "catalog.json");
    const state = join(dirs.state, "local-state.json");
    const planPath = join(dirs.plans, "init.json");
    const skill = join(dirs.skill, "SKILL.md");
    await writeFile(skill, "---\nname: workspace-governance\nversion: 0.3.0\n---\n# Synthetic\n");
    const preview = run([
      "init", "--config", config, "--catalog", catalog, "--state", state,
      "--plans-dir", dirs.plans, "--trusted-root", dirs.workspaces,
      "--plan", planPath, "--json",
    ]);
    assert.equal(preview.status, 0, preview.stderr);
    const planId = JSON.parse(preview.stdout).plan.id;
    const apply = run([
      "apply", "--config", config, "--plan", planPath, "--approve", planId, "--json",
    ]);
    assert.equal(apply.status, 0, apply.stderr);

    const doctor = run(["doctor", "--integration", "--config", config, "--skill", skill, "--json"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(doctor.stderr, "");
    const diagnosis = JSON.parse(doctor.stdout);
    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.ready, true);
    assert.equal(diagnosis.milestone, "M2/A03");
    const checks = Object.fromEntries(diagnosis.checks.map((item: { id: string }) => [item.id, item]));
    assert.equal(checks.config.status, "pass");
    assert.equal(checks.config.validated, true);
    assert.equal(checks["trusted-roots"].status, "pass");
    assert.equal(checks["trusted-roots"].count, 1);
    assert.equal(checks.catalog.status, "pass");
    assert.equal(checks["local-state"].status, "pass");
    assert.equal(checks.store.status, "pass");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M2/A05 help exposes setup/import, selected overviews, and bounded catalog edits", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^workspacectl 0\.3\.0 — Workspaces M2\/A05/m);
  for (const command of [
    "init",
    "import-v1",
    "apply",
    "discover --config",
    "list",
    "report",
    "audit",
    "config export",
    "config validate",
    "config plan",
    "group create",
    "repo membership",
    "repo classify",
    "worktree create",
  ])
    assert.ok(result.stdout.includes(command), command);
  for (const premature of [
    "repo add",
    "  adopt PATH",
    "  checkout REPO",
  ]) assert.equal(result.stdout.includes(premature), false, premature);
});
