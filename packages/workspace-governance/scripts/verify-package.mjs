import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  copyFile,
  stat,
  realpath,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
// Resolved: the consumer scan root is handed to discoverLocal, which refuses a
// root with symlink ancestors, and macOS `tmpdir()` sits under /var -> /private/var.
const temp = await realpath(await mkdtemp(join(tmpdir(), "governance-consumer-")));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !k.toLowerCase().startsWith("npm_"),
  ),
);
for (const key of [
  "WORKSPACECTL_CONFIG",
  "WORKSPACECTL_SKILL",
  "WORKSPACECTL_INSTALL_PREFIX",
  "WORKSPACECTL_LAUNCHER",
  "WORKSPACECTL_RUNTIME_PATH",
]) delete env[key];
const run = (bin, args, cwd = root) =>
  execFileSync(bin, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const probe = (bin, args, cwd = root) =>
  spawnSync(bin, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const meta = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(meta.private, true);
  assert.equal(meta.version, "0.2.0");
  for (const key of ["preinstall", "install", "postinstall", "prepare"])
    assert.equal(meta.scripts[key], undefined);
  assert.deepEqual(meta.dependencies, { yaml: "2.9.1" });
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].dependencies.yaml, "2.9.1");
  assert.equal(lock.packages["node_modules/yaml"].version, "2.9.1");
  const packed = JSON.parse(
    run("npm", [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temp,
    ]),
  );
  assert.equal(packed.length, 1);
  const members = packed[0].files.map((f) => f.path);
  for (const f of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli.js",
    "dist/doctor.js",
    "dist/doctor.d.ts",
    "dist/report.js",
    "dist/report.d.ts",
    "dist/report-html.js",
    "dist/v2-model.js",
    "dist/v2-model.d.ts",
    "dist/document-stores.js",
    "dist/document-stores.d.ts",
    "dist/registry-plans.js",
    "dist/registry-plans.d.ts",
    "dist/v1-import.js",
    "dist/v1-import.d.ts",
    "dist/catalog-readback.js",
    "dist/catalog-readback.d.ts",
    "dist/overview.js",
    "dist/overview.d.ts",
    "dist/overview-runtime.js",
    "dist/overview-runtime.d.ts",
    "dist/v2-rules.js",
    "dist/v2-rules.d.ts",
    "dist/v2-context.js",
    "dist/v2-context.d.ts",
    "dist/relevant-context.js",
    "dist/relevant-context.d.ts",
    "dist/open.js",
    "dist/open.d.ts",
    "dist/coordination.js",
    "dist/coordination.d.ts",
    "dist/checkout-operations.js",
    "dist/checkout-operations.d.ts",
    "dist/worktree-operations.js",
    "dist/worktree-operations.d.ts",
    "dist/workflow-execution.js",
    "dist/workflow-execution.d.ts",
    "schemas/manifest.schema.json",
    "schemas/v2/config.schema.json",
    "schemas/v2/catalog.schema.json",
    "schemas/v2/local-state.schema.json",
    "schemas/v2/workspace-plan.schema.json",
    "schemas/v2/resolved-context.schema.json",
    "schemas/v2/open-result.schema.json",
    "schemas/v2/host-action.schema.json",
    "schemas/v2/host-result.schema.json",
    "schemas/v2/operation.schema.json",
    "examples/example.json",
    "docs/m2-a03-contract.md",
    "docs/m2-a04-contract.md",
    "docs/m2-a05-contract.md",
    "docs/m2-a06-contract.md",
    "docs/m3-a07-contract.md",
    "docs/m3-a08-contract.md",
    "docs/m4-a09-contract.md",
    "docs/m5-a11-contract.md",
    "docs/m5-a12-contract.md",
    "docs/m6-a13-contract.md",
    "docs/m6-a14-contract.md",
    "docs/m6-a15-contract.md",
    "docs/m3-a17-contract.md",
    "README.md",
    "LICENSE",
  ])
    assert.ok(members.includes(f), f);
  for (const retired of ["dist/setup/", "native/setup-helper/", "mutation-status", "manifest-init"])
    assert.equal(members.some((member) => member.includes(retired)), false, retired);
  const tar = join(temp, `candidate-${process.pid}.tgz`);
  await copyFile(join(temp, packed[0].filename), tar);
  const consumer = join(temp, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "synthetic-consumer",
      private: true,
      type: "module",
    }),
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(temp, "cache"),
      tar,
    ],
    consumer,
  );
  const bin = join(consumer, "node_modules", ".bin", "workspacectl");
  const help = run(bin, ["--help"], consumer);
  assert.match(help, /^workspacectl 0\.2\.0 — Workspaces M2\/A05–A06/m);
  assert.match(help, /M3\/A07–A08/);
  assert.match(help, /doctor \[--standalone\] \[--config FILE\] \[--skill FILE\] \[--json\]/);
  assert.match(help, /--load knowledge:ID\|skill:ID/);
  assert.match(help, /--approve-content TARGET=sha256:DIGEST/);
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
    "repo classify",
    "where REPOSITORY",
    "workspace select-primary",
    "adopt --repo ID",
    "checkout --repo ID",
    "worktree list --repo ID",
    "worktree create --repo ID",
    "worktree remove --workspace ID",
    "operation show ID",
    "workflow run --repo ID",
    "workflow run --coordination ID",
    "workflow submit --run ID",
    "workflow approve --run ID",
    "workflow interrupt --run ID",
    "workflow resume --run ID",
    "context REPOSITORY",
    "explain REPOSITORY",
    "open TARGET",
    "host acknowledge",
    "coordination create",
    "coordination open",
  ])
    assert.match(help, new RegExp(command.replace(" ", "\\s+")));
  assert.match(help, /Legacy read-only engine:/);
  assert.match(help, /advisory/);
  assert.equal(help.includes("manifest-init-plan"), false);
  assert.equal(run(bin, [], consumer), help);
  assert.equal(run(bin, ["--version"], consumer).trim(), "0.2.0");
  const installed = join(
    consumer,
    "node_modules",
    "@crissmoldovan",
    "workspace-governance",
  );
  assert.equal((await stat(installed)).isSymbolicLink(), false);
  const installedApi = await import(pathToFileURL(join(installed, "dist", "index.js")).href);
  const installedYaml = JSON.parse(
    await readFile(join(consumer, "node_modules", "yaml", "package.json"), "utf8"),
  );
  assert.equal(installedYaml.version, "2.9.1");
  const selectedConfig = join(temp, "selected config.yaml");
  const selectedSkill = join(temp, "selected SKILL.md");
  const dataDirectory = join(temp, "registry data");
  const stateDirectory = join(temp, "registry state");
  const plansDirectory = join(temp, "registry plans");
  const trustedRoot = join(temp, "trusted workspaces");
  for (const directory of [dataDirectory, stateDirectory, plansDirectory, trustedRoot])
    await mkdir(directory, { recursive: true });
  const catalogPath = join(dataDirectory, "catalog.json");
  const localStatePath = join(stateDirectory, "local-state.json");
  const initPlanPath = join(plansDirectory, "init.json");
  const initPreview = JSON.parse(
    run(
      bin,
      [
        "init",
        "--config",
        selectedConfig,
        "--catalog",
        catalogPath,
        "--state",
        localStatePath,
        "--plans-dir",
        plansDirectory,
        "--trusted-root",
        trustedRoot,
        "--plan",
        initPlanPath,
        "--json",
      ],
      consumer,
    ),
  );
  assert.equal(initPreview.command, "init");
  assert.equal(initPreview.applied, false);
  assert.equal(
    JSON.parse(
      run(
        bin,
        [
          "apply",
          "--config",
          selectedConfig,
          "--plan",
          initPlanPath,
          "--approve",
          initPreview.plan.id,
          "--json",
        ],
        consumer,
      ),
    ).applied,
    true,
  );
  await writeFile(
    selectedSkill,
    "---\nname: workspace-governance\nversion: 0.2.0\n---\n# Workspaces\n",
  );
  const migrationDirectory = join(temp, "migration inputs");
  await mkdir(migrationDirectory);
  const classifiedPath = join(migrationDirectory, "classified.json");
  const unclassifiedPath = join(migrationDirectory, "unclassified.json");
  const classifiedSource = {
    apiVersion: "workspace-governance/v1",
    authorityId: "user-synthetic",
    nodes: [
      {
        id: "user-synthetic",
        kind: "user",
        parentId: null,
        slug: "synthetic",
        visibility: { mode: "public", readers: [] },
        metadata: { provenance: "synthetic verifier" },
      },
      { id: "domain-synthetic", kind: "domain", parentId: "user-synthetic", slug: "work" },
      {
        id: "namespace-synthetic",
        kind: "namespace",
        parentId: "domain-synthetic",
        slug: "synthetic",
      },
      {
        id: "repo-synthetic-one",
        kind: "repository",
        parentId: "namespace-synthetic",
        slug: "one",
        remote: "https://github.com/synthetic/one",
        metadata: { classification: { confidence: 1, reason: "synthetic" } },
      },
    ],
    policies: [],
    workflows: [],
    metadata: { approved: true, synthetic: true },
  };
  const unclassifiedSource = {
    apiVersion: "workspace-governance/unclassified-repositories-v1",
    count: 1,
    repositories: [
      {
        repository: "Synthetic/Two",
        status: "unclassified",
        reason: "No approved group",
        withheldSuggestion: { groupId: "domain-synthetic" },
      },
    ],
  };
  await writeFile(classifiedPath, `${JSON.stringify(classifiedSource, null, 2)}\n`, { mode: 0o600 });
  await writeFile(unclassifiedPath, `${JSON.stringify(unclassifiedSource, null, 2)}\n`, { mode: 0o600 });
  const importPlanPath = join(plansDirectory, "import.json");
  const importPreview = JSON.parse(
    run(
      bin,
      [
        "import-v1",
        "--config",
        selectedConfig,
        "--manifest",
        classifiedPath,
        "--unclassified",
        unclassifiedPath,
        "--plan",
        importPlanPath,
        "--json",
      ],
      consumer,
    ),
  );
  assert.deepEqual(importPreview.counts, { classified: 1, unclassified: 1, total: 2 });
  const absentApproval = probe(
    bin,
    ["apply", "--config", selectedConfig, "--plan", importPlanPath, "--json"],
    consumer,
  );
  assert.equal(absentApproval.status, 4, absentApproval.stdout);
  assert.equal(JSON.parse(absentApproval.stderr).error.code, "APPROVAL_REQUIRED");
  const importApply = JSON.parse(
    run(
      bin,
      [
        "apply",
        "--config",
        selectedConfig,
        "--plan",
        importPlanPath,
        "--approve",
        importPreview.plan.id,
        "--json",
      ],
      consumer,
    ),
  );
  assert.deepEqual(importApply.counts, { classified: 1, unclassified: 1, total: 2 });
  const installedList = JSON.parse(run(bin, ["list", "--config", selectedConfig, "--json"], consumer));
  assert.deepEqual(installedList.counts, { classified: 1, unclassified: 1, total: 2 });
  assert.deepEqual(
    installedList.repositories.map((repository) => repository.workspaceState),
    ["unknown", "unknown"],
  );
  const exported = JSON.parse(
    run(bin, ["config", "export", "--target", "catalog", "--config", selectedConfig], consumer),
  );
  assert.equal(exported.format, "workspacectl-edit/1");
  assert.equal(exported.target, "catalog");
  assert.equal(exported.document.repositories.length, 2);

  const a05DraftDirectory = join(temp, "a05 drafts");
  await mkdir(a05DraftDirectory);
  exported.document.groups = [];
  exported.document.repositories = exported.document.repositories.map((repository) => ({
    ...repository,
    primaryGroupId: null,
    memberOf: [],
    classification: "suggested",
  }));
  const a05DraftPath = join(a05DraftDirectory, "seed.json");
  const a05DraftPlan = join(plansDirectory, "a05-seed.json");
  await writeFile(a05DraftPath, JSON.stringify(exported, null, 2) + "\n");
  assert.equal(
    JSON.parse(run(bin, ["config", "validate", a05DraftPath, "--config", selectedConfig, "--json"], consumer)).valid,
    true,
  );
  const a05DraftPreview = JSON.parse(run(
    bin,
    ["config", "plan", a05DraftPath, "--config", selectedConfig, "--plan", a05DraftPlan, "--json"],
    consumer,
  ));
  assert.equal(a05DraftPreview.plan.kind, "catalog-edit");
  run(bin, ["apply", "--config", selectedConfig, "--plan", a05DraftPlan, "--approve", a05DraftPreview.plan.id, "--json"], consumer);

  const syntheticCheckoutFact = join(trustedRoot, "a05-synthetic-checkout.fact");
  await writeFile(syntheticCheckoutFact, "installed A05 checkout bytes remain unchanged\n");
  const installedState = JSON.parse(await readFile(localStatePath, "utf8"));
  installedState.metadata.syntheticCheckoutPath = syntheticCheckoutFact;
  await writeFile(localStatePath, JSON.stringify(installedState, null, 2) + "\n");
  const immutableA05Paths = [selectedConfig, localStatePath, syntheticCheckoutFact];
  const immutableA05Before = await Promise.all(immutableA05Paths.map((path) => readFile(path)));
  let a05Sequence = 0;
  const applyA05 = (args) => {
    const planPath = join(plansDirectory, `a05-operation-${++a05Sequence}.json`);
    const preview = JSON.parse(run(bin, [...args, "--config", selectedConfig, "--plan", planPath, "--json"], consumer));
    assert.equal(preview.plan.kind, "catalog-edit");
    return JSON.parse(run(bin, ["apply", "--config", selectedConfig, "--plan", planPath, "--approve", preview.plan.id, "--json"], consumer));
  };
  applyA05(["group", "create", "--kind", "organization", "--id", "org-a05", "--name", "A05", "--slug", "a05"]);
  applyA05(["group", "create", "--kind", "area", "--id", "area-a05", "--name", "Products", "--slug", "products", "--parent", "org-a05"]);
  applyA05(["group", "create", "--kind", "project", "--id", "project-a05", "--name", "Project", "--slug", "project", "--parent", "org-a05"]);
  const [installedRepoOne, installedRepoTwo] = exported.document.repositories.map((repository) => repository.id);
  applyA05(["repo", "membership", "--id", installedRepoTwo, "--project", "project-a05", "--action", "add"]);
  applyA05(["repo", "classify", "--id", installedRepoOne, "--decision", "accept", "--group", "project-a05"]);
  const installedRejected = applyA05(["repo", "classify", "--id", installedRepoTwo, "--decision", "reject"]);
  assert.equal(installedRejected.transition.decision, "rejected");
  applyA05(["group", "update", "--id", "project-a05", "--name", "Project renamed", "--slug", "project-renamed"]);
  applyA05(["group", "reparent", "--id", "project-a05", "--parent", "area-a05"]);
  const installedA05Group = JSON.parse(run(bin, ["group", "show", "--id", "project-a05", "--config", selectedConfig, "--json"], consumer));
  assert.equal(installedA05Group.group.name, "Project renamed");
  assert.equal(installedA05Group.group.parentId, "area-a05");
  assert.deepEqual(installedA05Group.repositories.map((repository) => repository.id).sort(), [installedRepoOne, installedRepoTwo].sort());
  assert.equal(JSON.parse(run(bin, ["repo", "show", "--id", installedRepoOne, "--config", selectedConfig, "--json"], consumer)).repository.classification, "confirmed");
  assert.equal(JSON.parse(run(bin, ["repo", "show", "--id", installedRepoTwo, "--config", selectedConfig, "--json"], consumer)).repository.classification, "unclassified");

  const a17Directory = join(temp, "a17 async test adapter");
  await mkdir(a17Directory);
  const a17ConfigPath = join(a17Directory, "config.json");
  const a17CatalogPath = join(a17Directory, "catalog.json");
  const a17StatePath = join(a17Directory, "state.json");
  const a17PlanPath = join(a17Directory, "plan.json");
  const a17Config = {
    schemaVersion: 2,
    documentType: "workspacectl/config",
    catalog: { adapter: "test-async-file", path: a17CatalogPath },
    localState: { adapter: "test-async-file", path: a17StatePath },
    plans: { directory: a17Directory },
    trustedRoots: [trustedRoot],
  };
  await writeFile(a17ConfigPath, JSON.stringify(a17Config, null, 2) + "\n", { mode: 0o600 });
  await copyFile(catalogPath, a17CatalogPath);
  const a17State = installedApi.emptyLocalStateDocument(
    a17ConfigPath,
    installedApi.documentRevision(a17Config),
  );
  a17State.repositoryWorkspaces.push({
    id: "a17-workspace",
    kind: "primary",
    repositoryId: installedRepoOne,
    path: join(trustedRoot, "a17-workspace"),
    branch: "main",
    primarySelected: true,
    hostLinks: {},
  });
  await writeFile(
    a17StatePath,
    JSON.stringify(a17State, null, 2) + "\n",
    { mode: 0o600 },
  );
  const fileList = JSON.parse(run(bin, ["list", "--config", selectedConfig, "--json"], consumer));
  const asyncList = JSON.parse(run(bin, ["list", "--config", a17ConfigPath, "--json"], consumer));
  assert.deepEqual(
    { counts: asyncList.counts, repositories: asyncList.repositories },
    { counts: fileList.counts, repositories: fileList.repositories },
  );
  const fileContext = JSON.parse(run(bin, ["context", installedRepoOne, "--config", selectedConfig, "--json"], consumer));
  const asyncContext = JSON.parse(run(bin, ["context", installedRepoOne, "--config", a17ConfigPath, "--json"], consumer));
  const semanticContext = ({ context }) => {
    const copy = structuredClone(context);
    delete copy.revisions;
    return copy;
  };
  assert.deepEqual(semanticContext(asyncContext), semanticContext(fileContext));
  const a17Preview = JSON.parse(run(bin, [
    "group", "update", "--id", "project-a05", "--name", "A17 async adapter",
    "--config", a17ConfigPath, "--plan", a17PlanPath, "--json",
  ], consumer));
  const a17Apply = JSON.parse(run(bin, [
    "apply", "--config", a17ConfigPath, "--plan", a17PlanPath,
    "--approve", a17Preview.plan.id, "--json",
  ], consumer));
  assert.equal(a17Apply.readback.catalog.groups.find((group) => group.id === "project-a05").name, "A17 async adapter");

  const a17WorkspaceDraft = JSON.parse(run(bin, [
    "config", "export", "--target", "workspace", "--workspace", "a17-workspace",
    "--config", a17ConfigPath,
  ], consumer));
  a17WorkspaceDraft.document.workspacePolicyOverlays = [{
    scope: { kind: "workspace", id: "a17-workspace" },
    settings: { "commands.test": "npm run packed-a17" },
    operations: [],
    constraints: [],
    instructions: [],
    knowledge: [],
    skills: [],
  }];
  const a17WorkspaceDraftPath = join(a17Directory, "workspace-draft.json");
  const a17WorkspacePlanPath = join(a17Directory, "workspace-plan.json");
  await writeFile(
    a17WorkspaceDraftPath,
    JSON.stringify(a17WorkspaceDraft, null, 2) + "\n",
    { mode: 0o600 },
  );
  const a17WorkspacePreview = JSON.parse(run(bin, [
    "config", "plan", a17WorkspaceDraftPath, "--config", a17ConfigPath,
    "--plan", a17WorkspacePlanPath, "--json",
  ], consumer));
  assert.equal(a17WorkspacePreview.plan.kind, "workspace-edit");
  const a17WorkspaceApply = JSON.parse(run(bin, [
    "apply", "--config", a17ConfigPath, "--plan", a17WorkspacePlanPath,
    "--approve", a17WorkspacePreview.plan.id, "--json",
  ], consumer));
  const a17WorkspaceReadback = JSON.parse(run(bin, [
    "config", "export", "--target", "workspace", "--workspace", "a17-workspace",
    "--config", a17ConfigPath,
  ], consumer));
  assert.deepEqual(a17WorkspaceApply.readback.localState, a17WorkspaceReadback.document);
  assert.deepEqual(a17WorkspaceReadback.document, JSON.parse(await readFile(a17StatePath, "utf8")));
  assert.equal(
    a17WorkspaceReadback.document.workspacePolicyOverlays[0].settings["commands.test"],
    "npm run packed-a17",
  );
  const fakeAuth = probe(bin, ["list", "--config", a17ConfigPath, "--authenticated", "true", "--json"], consumer);
  assert.equal(fakeAuth.status, 2);
  assert.equal(JSON.parse(fakeAuth.stderr).error.code, "INVALID_CONFIG");
  assert.deepEqual(await Promise.all(immutableA05Paths.map((path) => readFile(path))), immutableA05Before);

  const strictFlagBefore = await Promise.all(
    [selectedConfig, catalogPath, localStatePath, syntheticCheckoutFact].map((path) => readFile(path)),
  );
  const irrelevantFlagCases = [
    ["group", "show", "--id", "project-a05", "--kind", "project"],
    ["group", "show", "--id", "project-a05", "--plan", join(plansDirectory, "ignored-show.json")],
    ["group", "list", "--plan", join(plansDirectory, "ignored-list.json")],
    ["group", "create", "--kind", "organization", "--id", "org-ignored", "--name", "Ignored", "--slug", "ignored", "--action", "add", "--plan", join(plansDirectory, "ignored-create.json")],
    ["group", "update", "--id", "project-a05", "--name", "Ignored", "--kind", "project", "--plan", join(plansDirectory, "ignored-update-kind.json")],
    ["group", "update", "--id", "project-a05", "--slug", "ignored", "--parent", "org-a05", "--plan", join(plansDirectory, "ignored-update-parent.json")],
    ["group", "reparent", "--id", "project-a05", "--parent", "org-a05", "--name", "Ignored", "--plan", join(plansDirectory, "ignored-reparent-name.json")],
    ["group", "reparent", "--id", "project-a05", "--parent", "org-a05", "--slug", "ignored", "--plan", join(plansDirectory, "ignored-reparent-slug.json")],
    ["repo", "show", "--id", installedRepoOne, "--action", "add"],
    ["repo", "show", "--id", installedRepoOne, "--plan", join(plansDirectory, "ignored-repo-show.json")],
    ["repo", "list", "--plan", join(plansDirectory, "ignored-repo-list.json")],
    ["repo", "membership", "--id", installedRepoTwo, "--project", "project-a05", "--action", "add", "--decision", "accept", "--plan", join(plansDirectory, "ignored-membership-decision.json")],
    ["repo", "membership", "--id", installedRepoTwo, "--project", "project-a05", "--action", "add", "--group", "project-a05", "--plan", join(plansDirectory, "ignored-membership-group.json")],
    ["repo", "classify", "--id", installedRepoOne, "--decision", "accept", "--group", "project-a05", "--project", "project-a05", "--plan", join(plansDirectory, "ignored-classify-project.json")],
    ["repo", "classify", "--id", installedRepoTwo, "--decision", "reject", "--action", "remove", "--plan", join(plansDirectory, "ignored-classify-action.json")],
  ];
  for (const args of irrelevantFlagCases) {
    const refused = probe(bin, [...args, "--config", selectedConfig, "--json"], consumer);
    assert.notEqual(refused.status, 0, args.join(" "));
    assert.equal(JSON.parse(refused.stderr).error.code, "INVALID_CONFIG", args.join(" "));
  }
  assert.deepEqual(
    await Promise.all([selectedConfig, catalogPath, localStatePath, syntheticCheckoutFact].map((path) => readFile(path))),
    strictFlagBefore,
  );

  const refusalPlanPath = join(plansDirectory, "a05-refusal.json");
  const refusalPreview = JSON.parse(run(bin, [
    "group", "create", "--kind", "organization", "--id", "org-refusal", "--name", "Refusal", "--slug", "refusal",
    "--config", selectedConfig, "--plan", refusalPlanPath, "--json",
  ], consumer));
  const refusalBefore = await Promise.all([selectedConfig, catalogPath, localStatePath, syntheticCheckoutFact].map((path) => readFile(path)));
  const wrongApproval = probe(bin, ["apply", "--config", selectedConfig, "--plan", refusalPlanPath, "--approve", "plan-wrong", "--json"], consumer);
  assert.equal(wrongApproval.status, 4);
  assert.equal(JSON.parse(wrongApproval.stderr).error.code, "APPROVAL_REQUIRED");
  assert.deepEqual(await Promise.all([selectedConfig, catalogPath, localStatePath, syntheticCheckoutFact].map((path) => readFile(path))), refusalBefore);
  const invalidHierarchy = probe(bin, [
    "group", "create", "--kind", "project", "--id", "project-invalid", "--name", "Invalid", "--slug", "invalid",
    "--parent", "missing", "--config", selectedConfig, "--plan", join(plansDirectory, "a05-invalid.json"), "--json",
  ], consumer);
  assert.notEqual(invalidHierarchy.status, 0);
  assert.deepEqual(await Promise.all([selectedConfig, catalogPath, localStatePath, syntheticCheckoutFact].map((path) => readFile(path))), refusalBefore);
  const changedDraft = JSON.parse(run(bin, ["config", "export", "--target", "catalog", "--config", selectedConfig], consumer));
  changedDraft.document.groups.push({ id: "org-draft-refusal", kind: "organization", name: "Draft", slug: "draft-refusal", parentId: null, metadata: {} });
  const changedDraftPath = join(a05DraftDirectory, "changed.json");
  const changedDraftPlan = join(plansDirectory, "changed.json");
  await writeFile(changedDraftPath, JSON.stringify(changedDraft, null, 2) + "\n");
  const changedDraftPreview = JSON.parse(run(bin, ["config", "plan", changedDraftPath, "--config", selectedConfig, "--plan", changedDraftPlan, "--json"], consumer));
  changedDraft.document.groups.at(-1).name = "Changed after preview";
  await writeFile(changedDraftPath, JSON.stringify(changedDraft, null, 2) + "\n");
  const changedDraftRefusal = probe(bin, ["apply", "--config", selectedConfig, "--plan", changedDraftPlan, "--approve", changedDraftPreview.plan.id, "--json"], consumer);
  assert.notEqual(changedDraftRefusal.status, 0);
  assert.equal(JSON.parse(changedDraftRefusal.stderr).error.code, "STALE_PLAN");
  assert.deepEqual(await Promise.all([selectedConfig, catalogPath, localStatePath, syntheticCheckoutFact].map((path) => readFile(path))), refusalBefore);
  void refusalPreview;

  const configuredDoctor = probe(
    bin,
    ["doctor", "--config", selectedConfig, "--skill", selectedSkill, "--json"],
    consumer,
  );
  assert.equal(configuredDoctor.status, 0, configuredDoctor.stderr);
  assert.equal(configuredDoctor.stderr, "");
  const configuredDiagnosis = JSON.parse(configuredDoctor.stdout);
  assert.equal(configuredDiagnosis.ready, true);
  assert.equal(configuredDiagnosis.checks.find((check) => check.id === "install").status, "source");
  assert.equal(configuredDiagnosis.checks.find((check) => check.id === "skill").status, "pass");
  assert.equal(configuredDiagnosis.checks.find((check) => check.id === "catalog").status, "pass");
  assert.equal(configuredDiagnosis.checks.find((check) => check.id === "local-state").status, "pass");
  const doctorInputs = [selectedConfig, catalogPath, localStatePath, selectedSkill];
  const doctorBefore = await Promise.all(doctorInputs.map((path) => readFile(path)));
  const standaloneDoctor = probe(
    bin,
    ["doctor", "--standalone", "--config", selectedConfig, "--json"],
    consumer,
  );
  assert.equal(standaloneDoctor.status, 0, standaloneDoctor.stderr);
  assert.equal(standaloneDoctor.stderr, "");
  const standaloneDiagnosis = JSON.parse(standaloneDoctor.stdout);
  assert.equal(standaloneDiagnosis.ready, true);
  assert.equal(standaloneDiagnosis.readinessScope, "standalone");
  assert.equal(standaloneDiagnosis.selected.skill, null);
  assert.deepEqual(standaloneDiagnosis.checks.find((check) => check.id === "skill"), {
    id: "skill",
    status: "skipped",
    required: false,
    reason: "Agent skill integration is not required in standalone mode.",
  });
  assert.deepEqual(await Promise.all(doctorInputs.map((path) => readFile(path))), doctorBefore);
  const unconfiguredDoctor = probe(
    bin,
    ["doctor", "--config", join(temp, "missing.yaml"), "--skill", selectedSkill, "--json"],
    consumer,
  );
  assert.equal(unconfiguredDoctor.status, 2, unconfiguredDoctor.stderr);
  assert.equal(JSON.parse(unconfiguredDoctor.stdout).error.code, "NOT_CONFIGURED");

  // Deterministic synthetic GitHub fixture; never real account data.
  const catalogForObservation = JSON.parse(await readFile(catalogPath, "utf8"));
  catalogForObservation.sources = [{
    id: "source-synthetic-org",
    provider: "github",
    owner: "Synthetic",
    ownerType: "organization",
    include: [],
    exclude: [],
    proposedDefaultGroupId: null,
    metadata: { fixture: "deterministic-synthetic-github" },
  }];
  await writeFile(catalogPath, `${JSON.stringify(catalogForObservation, null, 2)}\n`);
  const sourceCatalogControl = probe(
    bin,
    ["list", "--config", selectedConfig, "--json"],
    consumer,
  );
  assert.equal(sourceCatalogControl.status, 0, sourceCatalogControl.stdout + sourceCatalogControl.stderr);

  const observedCheckout = join(trustedRoot, "one");
  await mkdir(observedCheckout);
  run("git", ["init", "-b", "main"], observedCheckout);
  run("git", ["config", "user.email", "synthetic@example.invalid"], observedCheckout);
  run("git", ["config", "user.name", "Synthetic Verifier"], observedCheckout);
  await writeFile(join(observedCheckout, "README.md"), "# deterministic synthetic checkout\n");
  run("git", ["add", "README.md"], observedCheckout);
  run("git", ["commit", "-m", "synthetic fixture"], observedCheckout);
  run("git", ["remote", "add", "origin", "https://github.com/Synthetic/One.git"], observedCheckout);

  const fixtureBin = join(temp, "synthetic github fixture bin");
  await mkdir(fixtureBin);
  const ghLog = join(temp, "synthetic-gh-endpoints.log");
  const ghFixture = join(fixtureBin, "gh");
  await writeFile(
    ghFixture,
    `#!${process.execPath}\nconst fs=require('node:fs');\nconst endpoint=process.argv[5];\nfs.appendFileSync(process.env.SYNTHETIC_GH_LOG, endpoint+'\\n');\nif(process.argv[2]!=='api'||process.argv[3]!=='--hostname'||process.argv[4]!=='github.com'||!endpoint.startsWith('/orgs/Synthetic/repos?'))process.exit(41);\nprocess.stdout.write(JSON.stringify([{id:501,html_url:'https://github.com/Synthetic/One',archived:false,private:true}]));\n`,
  );
  await chmod(ghFixture, 0o755);
  env.PATH = `${fixtureBin}:${env.PATH}`;
  env.GH_HOST = "hostile.example.invalid";
  env.SYNTHETIC_GH_LOG = ghLog;

  const immutableObservationPaths = [
    selectedConfig,
    catalogPath,
    localStatePath,
    join(observedCheckout, ".git", "HEAD"),
    join(observedCheckout, ".git", "config"),
    join(observedCheckout, ".git", "index"),
    join(observedCheckout, ".git", "refs", "heads", "main"),
    join(observedCheckout, "README.md"),
  ];
  const beforeObservation = await Promise.all(
    immutableObservationPaths.map((path) => readFile(path)),
  );
  const selectedOverviewArgs = [
    "--config",
    selectedConfig,
    "--source",
    "source-synthetic-org",
    "--root",
    observedCheckout,
    "--depth",
    "1",
    "--max-pages",
    "2",
  ];
  const comparableOverview = (body) => {
    const copy = structuredClone(body);
    delete copy.ok;
    delete copy.command;
    delete copy.selectedConfig;
    delete copy.observedAt;
    for (const source of copy.coverage.sources) delete source.observedAt;
    for (const local of copy.coverage.local) delete local.observedAt;
    return copy;
  };
  let selectedReference;
  for (const command of ["discover", "list", "report", "audit"]) {
    const result = probe(bin, [command, ...selectedOverviewArgs, "--json"], consumer);
    assert.equal(result.status, command === "audit" ? 3 : 0, `${command}: ${result.stderr}`);
    assert.equal(result.stderr, "");
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.command, command);
    assert.equal(body.readOnly, true);
    assert.equal(body.selection.transient, true);
    assert.equal(body.coverage.status, "complete");
    assert.equal(body.coverage.sources[0].privateVisibility, "observed");
    assert.equal(body.coverage.sources[0].absenceAuthoritative, false);
    assert.deepEqual(body.coverage.sources[0].counts, {
      received: 1,
      selected: 1,
      private: 1,
      archived: 0,
      excluded: 0,
    });
    assert.equal(body.repositories.length, body.summary.repositories);
    assert.deepEqual(
      body.repositories.map((repository) => repository.checkout.state).sort(),
      ["missing", "present"],
    );
    assert.ok(body.findings.some((finding) => finding.code === "UNCLASSIFIED_REPOSITORY"));
    assert.ok(body.findings.some((finding) => finding.code === "MISSING_CHECKOUT"));
    const shared = comparableOverview(body);
    selectedReference ??= shared;
    assert.deepEqual(shared, selectedReference);
  }
  const installedHumanAudit = probe(bin, ["audit", ...selectedOverviewArgs], consumer);
  assert.equal(installedHumanAudit.status, 3);
  assert.equal(installedHumanAudit.stderr, "");
  assert.match(installedHumanAudit.stdout, /Coverage: complete/);
  assert.match(installedHumanAudit.stdout, /MISSING_CHECKOUT/);
  assert.deepEqual(
    await Promise.all(immutableObservationPaths.map((path) => readFile(path))),
    beforeObservation,
  );
  const requestedEndpoints = (await readFile(ghLog, "utf8")).trim().split("\n");
  assert.equal(requestedEndpoints.length, 5);
  assert.ok(requestedEndpoints.every((endpoint) =>
    endpoint === "/orgs/Synthetic/repos?per_page=100&page=1&type=all&sort=full_name&direction=asc"
  ));

  const a06Draft = JSON.parse(
    run(bin, ["config", "export", "--target", "catalog", "--config", selectedConfig], consumer),
  );
  const a06PrimaryRepository = a06Draft.document.repositories.find(
    (repository) => repository.id === installedRepoOne,
  );
  const a06OtherRepository = a06Draft.document.repositories.find(
    (repository) => repository.id === installedRepoTwo,
  );
  assert.ok(a06PrimaryRepository);
  assert.ok(a06OtherRepository);
  a06PrimaryRepository.aliases = ["one-alias", "shared-a06"];
  a06OtherRepository.aliases = ["shared-a06"];
  const a06DraftPath = join(a05DraftDirectory, "a06-aliases.json");
  const a06DraftPlan = join(plansDirectory, "a06-aliases.json");
  await writeFile(a06DraftPath, JSON.stringify(a06Draft, null, 2) + "\n");
  const a06DraftPreview = JSON.parse(run(
    bin,
    ["config", "plan", a06DraftPath, "--config", selectedConfig, "--plan", a06DraftPlan, "--json"],
    consumer,
  ));
  run(
    bin,
    ["apply", "--config", selectedConfig, "--plan", a06DraftPlan, "--approve", a06DraftPreview.plan.id, "--json"],
    consumer,
  );

  const linkedWorktree = join(trustedRoot, "one-feature");
  run("git", ["worktree", "add", "-b", "feature/a06", linkedWorktree], observedCheckout);
  await writeFile(join(observedCheckout, "README.md"), "dirty tracked A06\n");
  await writeFile(join(observedCheckout, "staged.txt"), "dirty staged A06\n");
  run("git", ["add", "staged.txt"], observedCheckout);
  await writeFile(join(observedCheckout, "untracked.txt"), "dirty untracked A06\n");
  const optionalBytes = async (path) => {
    try {
      return await readFile(path);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };
  const checkoutSnapshot = async (path) => {
    const gitDirectory = resolve(path, run("git", ["rev-parse", "--git-dir"], path).trim());
    const commonDirectory = resolve(path, run("git", ["rev-parse", "--git-common-dir"], path).trim());
    return {
      branch: run("git", ["symbolic-ref", "--short", "HEAD"], path),
      head: run("git", ["rev-parse", "HEAD"], path),
      index: await readFile(join(gitDirectory, "index")),
      headFile: await readFile(join(gitDirectory, "HEAD")),
      status: run("git", ["status", "--porcelain=v1", "--untracked-files=all"], path),
      config: await readFile(join(commonDirectory, "config")),
      tracked: await optionalBytes(join(path, "README.md")),
      staged: await optionalBytes(join(path, "staged.txt")),
      untracked: await optionalBytes(join(path, "untracked.txt")),
      worktrees: run("git", ["worktree", "list", "--porcelain"], path),
    };
  };
  const checkoutBefore = {
    primary: await checkoutSnapshot(observedCheckout),
    worktree: await checkoutSnapshot(linkedWorktree),
  };
  const registryBeforeAdopt = {
    config: await readFile(selectedConfig),
    catalog: await readFile(catalogPath),
    localState: await readFile(localStatePath),
  };
  const adoptPrimaryPlan = join(plansDirectory, "a06-adopt-primary.json");
  const adoptPrimaryPreview = JSON.parse(run(bin, [
    "adopt", "--repo", installedRepoOne, "--path", observedCheckout,
    "--config", selectedConfig, "--plan", adoptPrimaryPlan, "--json",
  ], consumer));
  assert.equal(adoptPrimaryPreview.plan.request.observation.dirty, true);
  assert.equal(adoptPrimaryPreview.plan.request.observation.branch, "main");
  const wrongAdoptApproval = probe(bin, [
    "apply", "--config", selectedConfig, "--plan", adoptPrimaryPlan,
    "--approve", "plan-wrong", "--json",
  ], consumer);
  assert.equal(wrongAdoptApproval.status, 4);
  assert.equal(JSON.parse(wrongAdoptApproval.stderr).error.code, "APPROVAL_REQUIRED");
  assert.deepEqual(await readFile(selectedConfig), registryBeforeAdopt.config);
  assert.deepEqual(await readFile(catalogPath), registryBeforeAdopt.catalog);
  assert.deepEqual(await readFile(localStatePath), registryBeforeAdopt.localState);
  assert.deepEqual(await checkoutSnapshot(observedCheckout), checkoutBefore.primary);
  assert.deepEqual(await checkoutSnapshot(linkedWorktree), checkoutBefore.worktree);
  const adoptPrimaryApply = JSON.parse(run(bin, [
    "apply", "--config", selectedConfig, "--plan", adoptPrimaryPlan,
    "--approve", adoptPrimaryPreview.plan.id, "--json",
  ], consumer));
  assert.deepEqual(adoptPrimaryApply.readback.localState, JSON.parse(await readFile(localStatePath, "utf8")));
  assert.deepEqual(await readFile(selectedConfig), registryBeforeAdopt.config);
  assert.deepEqual(await readFile(catalogPath), registryBeforeAdopt.catalog);
  assert.notDeepEqual(await readFile(localStatePath), registryBeforeAdopt.localState);
  assert.deepEqual(await checkoutSnapshot(observedCheckout), checkoutBefore.primary);
  assert.deepEqual(await checkoutSnapshot(linkedWorktree), checkoutBefore.worktree);

  const adoptWorktreePlan = join(plansDirectory, "a06-adopt-worktree.json");
  const adoptWorktreePreview = JSON.parse(run(bin, [
    "adopt", "--repo", installedRepoOne, "--path", linkedWorktree,
    "--config", selectedConfig, "--plan", adoptWorktreePlan, "--json",
  ], consumer));
  assert.equal(adoptWorktreePreview.plan.request.observation.worktree, true);
  run(bin, [
    "apply", "--config", selectedConfig, "--plan", adoptWorktreePlan,
    "--approve", adoptWorktreePreview.plan.id, "--json",
  ], consumer);
  assert.deepEqual(await checkoutSnapshot(observedCheckout), checkoutBefore.primary);
  assert.deepEqual(await checkoutSnapshot(linkedWorktree), checkoutBefore.worktree);

  const ambiguousAlias = probe(
    bin,
    ["where", "shared-a06", "--config", selectedConfig, "--json"],
    consumer,
  );
  assert.equal(ambiguousAlias.status, 2);
  assert.deepEqual(
    JSON.parse(ambiguousAlias.stderr).error.details.candidates.map((candidate) => candidate.id),
    [installedRepoOne, installedRepoTwo].sort(),
  );
  for (const target of [installedRepoOne, "https://github.com/synthetic/one", "ONE-ALIAS"]) {
    const located = JSON.parse(run(bin, ["where", target, "--config", selectedConfig, "--json"], consumer));
    assert.equal(located.repository.id, installedRepoOne);
    assert.equal(located.selectedWorkspace, null);
    assert.deepEqual(located.alternatives.map((workspace) => workspace.kind).sort(), ["primary", "worktree"]);
  }
  const primaryWorkspaceId = adoptPrimaryPreview.plan.request.workspaceId;
  const primarySelectionPlan = join(plansDirectory, "a06-select-primary.json");
  const primarySelectionPreview = JSON.parse(run(bin, [
    "workspace", "select-primary", "--repo", installedRepoOne,
    "--workspace", primaryWorkspaceId, "--config", selectedConfig,
    "--plan", primarySelectionPlan, "--json",
  ], consumer));
  const primarySelectionApply = JSON.parse(run(bin, [
    "apply", "--config", selectedConfig, "--plan", primarySelectionPlan,
    "--approve", primarySelectionPreview.plan.id, "--json",
  ], consumer));
  assert.equal(
    primarySelectionApply.readback.localState.repositoryWorkspaces
      .find((workspace) => workspace.id === primaryWorkspaceId).primarySelected,
    true,
  );
  const selectedPrimary = JSON.parse(
    run(bin, ["where", installedRepoOne, "--config", selectedConfig, "--json"], consumer),
  );
  assert.equal(selectedPrimary.selectedWorkspace.id, primaryWorkspaceId);
  assert.equal(selectedPrimary.alternatives[0].kind, "worktree");
  assert.deepEqual(await checkoutSnapshot(observedCheckout), checkoutBefore.primary);
  assert.deepEqual(await checkoutSnapshot(linkedWorktree), checkoutBefore.worktree);

  const installedOpen = JSON.parse(run(bin, ["open", installedRepoOne, "--host", "hermes", "--activate", "--config", selectedConfig, "--json"], consumer));
  assert.equal(installedOpen.open.path, observedCheckout);
  assert.equal(installedOpen.open.hostAction.type, "hermes-project");
  const actionPath = join(temp, "a09-action.json");
  const readbackPath = join(temp, "a09-readback.json");
  await writeFile(actionPath, JSON.stringify(installedOpen.open.hostAction));
  const installedCreatedId = "synthetic-hermes-project";
  const installedResults = installedOpen.open.hostAction.requests.map((request) => request.operation === "list"
    ? { requestId: request.id, operation: "list", projects: [] }
    : request.operation === "create"
      ? { requestId: request.id, operation: "create", project: { id: installedCreatedId, name: request.name, path: request.path } }
      : { requestId: request.id, operation: "switch", project: { id: request.projectId ?? installedCreatedId, name: installedOpen.open.hostAction.projectName, path: observedCheckout } });
  await writeFile(readbackPath, JSON.stringify({ actionId: installedOpen.open.hostAction.id, actionDigest: installedOpen.open.hostAction.digest, activation: "native-project", results: installedResults, project: { id: installedCreatedId, name: installedOpen.open.hostAction.projectName, path: observedCheckout }, effectiveToolCwd: observedCheckout }));
  const acknowledged = JSON.parse(run(bin, ["host", "acknowledge", "--action", actionPath, "--readback", readbackPath, "--config", selectedConfig, "--json"], consumer));
  assert.equal(acknowledged.result.readbackStatus, "exact");
  applyA05(["group", "create", "--kind", "project", "--id", "project-a09", "--name", "A09 Coordination", "--slug", "a09", "--parent", "org-a05"]);
  applyA05(["repo", "membership", "--id", installedRepoOne, "--project", "project-a09", "--action", "add"]);
  const coordinationPath = join(trustedRoot, "a09-coordination");
  const coordinationPlanPath = join(plansDirectory, "a09-coordination.json");
  const coordinationPreview = JSON.parse(run(bin, ["coordination", "create", "--group", "project-a09", "--path", coordinationPath, "--plan", coordinationPlanPath, "--config", selectedConfig, "--json"], consumer));
  const coordinationApply = JSON.parse(run(bin, ["apply", "--plan", coordinationPlanPath, "--approve", coordinationPreview.plan.id, "--config", selectedConfig, "--json"], consumer));
  const coordinationId = coordinationApply.readback.localState.coordinationWorkspaces[0].id;
  const coordinationOpen = JSON.parse(run(bin, ["coordination", "open", "--id", coordinationId, "--config", selectedConfig, "--json"], consumer));
  assert.equal(coordinationOpen.coordination.status, "exact");
  assert.deepEqual((await readdir(coordinationPath)).sort(), ["WORKSPACE.md", "members.json"]);
  assert.deepEqual(await checkoutSnapshot(observedCheckout), checkoutBefore.primary);

  const manifest = join(installed, "examples", "example.json");
  assert.equal(
    JSON.parse(run(bin, ["validate", "--json", "--manifest", manifest], consumer)).valid,
    true,
  );
  const scan = join(temp, "scan");
  await mkdir(scan);
  const flags = [
    "--manifest",
    manifest,
    "--node",
    "org",
    "--principal",
    "reader",
    "--root",
    scan,
    "--workflow",
    "feature",
  ];
  const jsonFlags = ["--json", ...flags];
  const plan = run(bin, ["plan", ...jsonFlags], consumer);
  assert.equal(JSON.parse(plan).entries[0].status, "missing-checkout");
  const report = JSON.parse(run(bin, ["report", ...jsonFlags], consumer));
  assert.equal(report.summary.missingCheckout, 1);
  assert.equal(report.repositories[0].resolution.workflow.executable, false);
  const reportHtml = run(bin, ["report", ...flags, "--format", "html"], consumer);
  assert.match(reportHtml, /^<!doctype html>/i);
  assert.match(reportHtml, /Missing checkout/);
  await writeFile(join(temp, "plan.json"), plan);
  assert.equal(
    JSON.parse(
      run(
        bin,
        ["verify-plan", ...jsonFlags, "--plan", join(temp, "plan.json")],
        consumer,
      ),
    ).valid,
    true,
  );
  assert.equal(
    JSON.parse(
      run(
        bin,
        [
          "explain",
          "--json",
          "--manifest",
          manifest,
          "--node",
          "repo",
          "--principal",
          "reader",
          "--workflow",
          "feature",
        ],
        consumer,
      ),
    ).workflow.executable,
    false,
  );
  await writeFile(
    join(consumer, "check.mjs"),
    `import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '@crissmoldovan/workspace-governance';
const m=G.parseJson(await readFile(${JSON.stringify(manifest)},'utf8'));
const s=await G.loadSnapshot(new G.MemorySnapshotStore(m));
assert.equal(G.resolvePolicy(s,'repo','reader').values['git.pullRequest'],true);
const inv=await G.discoverLocal(${JSON.stringify(scan)});const p=G.createPlan(s,inv,'org','reader');G.verifyPlan(p,s,inv,'org','reader');const report=G.createReport(s,inv,'org','reader',{workflowId:'feature'});assert.equal(report.summary.missingCheckout,1);
const yaml=G.parseDataText('schemaVersion: 2\\ndocumentType: workspacectl/catalog\\ngroups: []\\nrepositories: []\\nsources: []\\npolicies: []\\nworkflows: []\\nmetadata: {}\\n','yaml');
const validatedCatalog=G.validateCatalogDocument(yaml);assert.equal(validatedCatalog.documentType,'workspacectl/catalog');
const overview=G.buildWorkspaceOverview({catalog:validatedCatalog,revisions:{catalog:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',localState:'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},observedAt:'2026-09-14T00:00:00.000Z',selection:{sourceIds:[],roots:[],depth:2,maxPages:1,transient:true},remote:[],local:[]});
assert.equal(overview.coverage.status,'unknown');assert.match(G.renderWorkspaceOverview('report',overview),/Coverage: unknown/);assert.equal(typeof G.observeWorkspace,'function');assert.equal(typeof G.resolveCatalogContext,'function');assert.equal(typeof G.loadRelevantContext,'function');assert.equal(typeof G.resolveProjectContexts,'function');assert.equal(G.DEFAULT_CONTEXT_BUDGET_BYTES,16000);assert.equal(typeof G.compareCarriedRuleSet,'function');
for (const unsafe of ['x: 1\\nx: 2\\n','value: &shared [1]\\ncopy: *shared\\n','value: !<tag:yaml.org,2002:js/function> function(){}\\n']) assert.throws(()=>G.parseDataText(unsafe,'yaml'));
const catalogStore=new G.MemoryCatalogStore(G.emptyCatalogDocument());
assert.equal((await catalogStore.read()).revision,G.documentRevision(G.emptyCatalogDocument()));
const stateStore=new G.MemoryLocalStateStore();
assert.equal((await stateStore.read()).revision,G.ABSENT_REVISION);
console.log('isolated library resolution/discovery/plan/report and bounded YAML/stores OK');
`,
  );
  console.log(run(process.execPath, ["check.mjs"], consumer).trim());
  await writeFile(
    join(consumer, "check.ts"),
    `import {MemorySnapshotStore,MemoryCatalogStore,MemoryLocalStateStore,loadSnapshot,resolvePolicy,createPlan,createReport,emptyCatalogDocument,buildWorkspaceOverview,renderWorkspaceOverview,observeWorkspace,type Manifest,type Inventory,type SnapshotStore,type Report,type CatalogStore,type LocalStateStore,type WorkspaceOverview,type WorkspaceOverviewInput,type ObserveWorkspaceRequest} from '@crissmoldovan/workspace-governance';
declare const m:Manifest;declare const i:Inventory;declare const overviewInput:WorkspaceOverviewInput;const store:SnapshotStore=new MemorySnapshotStore(m);const s=await loadSnapshot(store);const r=resolvePolicy(s,'repo','reader',{defaults:[{key:'x',merge:'replace',value:true}]});createPlan(s,i,'org','reader');const report:Report=createReport(s,i,'org','reader');const catalog:CatalogStore=new MemoryCatalogStore(emptyCatalogDocument());const localState:LocalStateStore=new MemoryLocalStateStore();await catalog.read();await localState.read();const overview:WorkspaceOverview=buildWorkspaceOverview(overviewInput);renderWorkspaceOverview('audit',overview);const observationRequest:ObserveWorkspaceRequest={sourceIds:[],roots:[],depth:1,maxPages:1};void observeWorkspace('/tmp/config.json',observationRequest);console.log(r.values,report.summary);
`,
  );
  run(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--typeRoots",
      join(root, "node_modules/@types"),
      join(consumer, "check.ts"),
    ],
    consumer,
  );
  console.log(
    "A17 packed/installed named test-async-file list/context/edit/apply/readback parity PASS; A09 non-live open/host-readback/coordination PASS; A08 context and A07/A06/A05/A03/A04 regressions remain exercised; exact yaml@2.9.1 runtime dependency installed; parser refusals retained",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
