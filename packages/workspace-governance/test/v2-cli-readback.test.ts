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
const run = (args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

async function missing(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function importedSetup(root: string) {
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
  let result = run([
    "init", "--config", config, "--catalog", catalog, "--state", state,
    "--plans-dir", dirs.plans, "--trusted-root", dirs.workspaces,
    "--plan", initPlan, "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  let planId = JSON.parse(result.stdout).plan.id;
  result = run([
    "apply", "--config", config, "--plan", initPlan, "--approve", planId, "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);

  const manifestPath = join(dirs.sources, "manifest.json");
  const sidecarPath = join(dirs.sources, "unclassified.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      apiVersion: "workspace-governance/v1",
      authorityId: "synthetic-readback",
      metadata: {},
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
    }, null, 2) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    sidecarPath,
    JSON.stringify({
      apiVersion: "workspace-governance/unclassified-repositories-v1",
      count: 1,
      repositories: [
        {
          repository: "Acme/Unplaced",
          status: "unclassified",
          reason: "No reviewed placement.",
          suggestionEvidence: "Retained but not activated.",
        },
      ],
    }, null, 2) + "\n",
    { mode: 0o600 },
  );
  const importPlan = join(dirs.plans, "import.json");
  result = run([
    "import-v1", "--config", config, "--manifest", manifestPath,
    "--unclassified", sidecarPath, "--plan", importPlan, "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  planId = JSON.parse(result.stdout).plan.id;
  result = run([
    "apply", "--config", config, "--plan", importPlan, "--approve", planId, "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  return { config, catalog, state };
}

test("M2 list and catalog export read every persisted repository without claiming checkout knowledge", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-v2-readback-"));
  try {
    const setup = await importedSetup(root);
    const listed = run(["list", "--config", setup.config, "--json"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(listed.stderr, "");
    const body = JSON.parse(listed.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.command, "list");
    assert.deepEqual(body.counts, { classified: 1, unclassified: 1, total: 2 });
    assert.match(body.revisions.catalog, /^sha256:[a-f0-9]{64}$/);
    assert.equal(body.repositories.length, 2);
    assert.deepEqual(
      body.repositories.map((repository: Record<string, unknown>) => ({
        id: repository.id,
        classification: repository.classification,
        primaryGroupId: repository.primaryGroupId,
        workspaceState: repository.workspaceState,
      })),
      [
        {
          id: "repo-acme-service",
          classification: "confirmed",
          primaryGroupId: "org-acme",
          workspaceState: "unknown",
        },
        {
          id: body.repositories[1].id,
          classification: "unclassified",
          primaryGroupId: null,
          workspaceState: "unknown",
        },
      ],
    );
    assert.equal(
      body.repositories[1].metadata.migration.record.suggestionEvidence,
      "Retained but not activated.",
    );

    const text = run(["list", "--config", setup.config]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Registered repositories: 2/);
    assert.match(text.stdout, /confirmed.*repo-acme-service.*workspace unknown/);
    assert.match(text.stdout, /unclassified.*workspace unknown/);

    const exported = run([
      "config", "export", "--target", "catalog", "--config", setup.config, "--json",
    ]);
    assert.equal(exported.status, 0, exported.stderr);
    const envelope = JSON.parse(exported.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, "config export");
    assert.equal(envelope.draft.format, "workspacectl-edit/1");
    assert.equal(envelope.draft.target, "catalog");
    assert.equal(envelope.draft.expectedRevision, body.revisions.catalog);
    assert.deepEqual(envelope.draft.document, JSON.parse(await readFile(setup.catalog, "utf8")));

    const editable = run([
      "config", "export", "--target", "catalog", "--config", setup.config,
    ]);
    assert.equal(editable.status, 0, editable.stderr);
    assert.deepEqual(JSON.parse(editable.stdout), envelope.draft);
    assert.equal(await missing(`${setup.catalog}.lock`), true);
    assert.equal(await missing(`${setup.state}.lock`), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
