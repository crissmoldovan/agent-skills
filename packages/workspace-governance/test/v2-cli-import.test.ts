import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
const run = (args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

const manifest = {
  apiVersion: "workspace-governance/v1",
  authorityId: "synthetic-cli-import",
  metadata: { activationAuthorized: true, approvalBasis: "historical-only" },
  nodes: [
    {
      id: "legacy-user",
      kind: "user",
      slug: "legacy",
      parentId: null,
      visibility: { mode: "public", readers: [] },
    },
    {
      id: "org-acme",
      kind: "domain",
      label: "Acme",
      slug: "acme",
      parentId: "legacy-user",
    },
    {
      id: "namespace-acme",
      kind: "namespace",
      slug: "acme",
      parentId: "org-acme",
    },
    {
      id: "repo-acme-service",
      kind: "repository",
      slug: "service",
      parentId: "namespace-acme",
      remote: "https://github.com/acme/service",
    },
  ],
  policies: [],
  workflows: [],
};

const sidecar = {
  apiVersion: "workspace-governance/unclassified-repositories-v1",
  catalogActivationAuthorized: true,
  count: 1,
  repositories: [
    {
      repository: "acme/unplaced",
      status: "unclassified",
      reason: "No reviewed placement.",
    },
  ],
};

test("M2 public import preview needs new approval and exact apply reads back the isolated catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-cli-import-"));
  try {
    const dirs = Object.fromEntries(
      ["config", "data", "state", "plans", "workspaces", "sources"].map((name) => [
        name,
        join(root, name),
      ]),
    );
    await Promise.all(Object.values(dirs).map((path) => mkdir(path, { mode: 0o700 })));
    const config = join(dirs.config, "config.yaml");
    const catalog = join(dirs.data, "catalog.json");
    const state = join(dirs.state, "local-state.json");
    const initPlan = join(dirs.plans, "init.json");
    const init = run([
      "init", "--config", config, "--catalog", catalog, "--state", state,
      "--plans-dir", dirs.plans, "--trusted-root", dirs.workspaces,
      "--plan", initPlan, "--json",
    ]);
    assert.equal(init.status, 0, init.stderr);
    const initId = JSON.parse(init.stdout).plan.id;
    const initialized = run([
      "apply", "--config", config, "--plan", initPlan, "--approve", initId, "--json",
    ]);
    assert.equal(initialized.status, 0, initialized.stderr);

    const manifestPath = join(dirs.sources, "manifest.json");
    const sidecarPath = join(dirs.sources, "unclassified.json");
    const importPlan = join(dirs.plans, "import.json");
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const sidecarBytes = Buffer.from(JSON.stringify(sidecar, null, 2) + "\n");
    await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
    await writeFile(sidecarPath, sidecarBytes, { mode: 0o600 });

    const preview = run([
      "import-v1", "--config", config, "--manifest", manifestPath,
      "--unclassified", sidecarPath, "--plan", importPlan, "--json",
    ]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(preview.stderr, "");
    const previewBody = JSON.parse(preview.stdout);
    assert.equal(previewBody.ok, true);
    assert.equal(previewBody.command, "import-v1");
    assert.equal(previewBody.applied, false);
    assert.equal(previewBody.planPath, importPlan);
    assert.deepEqual(previewBody.counts, { classified: 1, unclassified: 1, total: 2 });
    assert.match(previewBody.plan.id, /^plan-[a-f0-9]{32}$/);
    assert.equal(JSON.parse(await readFile(catalog, "utf8")).repositories.length, 0);

    const absentApproval = run([
      "apply", "--config", config, "--plan", importPlan, "--json",
    ]);
    assert.equal(absentApproval.status, 4, absentApproval.stderr);
    assert.equal(JSON.parse(absentApproval.stderr).error.code, "APPROVAL_REQUIRED");
    assert.equal(JSON.parse(await readFile(catalog, "utf8")).repositories.length, 0);

    const applied = run([
      "apply", "--config", config, "--plan", importPlan,
      "--approve", previewBody.plan.id, "--json",
    ]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(applied.stderr, "");
    const result = JSON.parse(applied.stdout);
    assert.equal(result.kind, "import-v1");
    assert.deepEqual(result.counts, { classified: 1, unclassified: 1, total: 2 });
    assert.equal(result.readback.catalog.repositories.length, 2);
    assert.deepEqual(result.readback.localState.repositoryWorkspaces, []);
    assert.deepEqual(await readFile(manifestPath), manifestBytes);
    assert.deepEqual(await readFile(sidecarPath), sidecarBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
