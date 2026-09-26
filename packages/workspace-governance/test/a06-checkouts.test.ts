import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import {
  validateLocalStateDocument,
  validateWorkspacePlan,
} from "../src/v2-model.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const skillRoot = fileURLToPath(new URL("../../../skills/workspace-governance/", import.meta.url));
const tempRoot = join(tmpdir(), "workspacectl-a06-tests");
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

const git = (cwd: string, ...args: string[]) => execFileSync("git", [
  "-c", "user.name=Synthetic A06", "-c", "user.email=a06@example.invalid", ...args,
], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const fileHash = async (path: string) => {
  try {
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

async function dirtyRepository(path: string, remote: string) {
  await mkdir(path);
  git(path, "init", "--initial-branch=main");
  git(path, "remote", "add", "origin", remote);
  await writeFile(join(path, "tracked.txt"), "committed\n");
  git(path, "add", "tracked.txt");
  git(path, "commit", "-m", "synthetic");
  await writeFile(join(path, "tracked.txt"), "dirty tracked\n");
  await writeFile(join(path, "staged.txt"), "dirty staged\n");
  git(path, "add", "staged.txt");
  await writeFile(join(path, "untracked.txt"), "dirty untracked\n");
}

async function checkoutSnapshot(path: string) {
  const gitDir = git(path, "rev-parse", "--git-dir").trim();
  const commonDir = git(path, "rev-parse", "--git-common-dir").trim();
  const absoluteGitDir = gitDir.startsWith("/") ? gitDir : join(path, gitDir);
  const absoluteCommonDir = commonDir.startsWith("/") ? commonDir : join(path, commonDir);
  return {
    branch: git(path, "symbolic-ref", "--short", "HEAD"),
    head: git(path, "rev-parse", "HEAD"),
    index: sha256(await readFile(join(absoluteGitDir, "index"))),
    headFile: sha256(await readFile(join(absoluteGitDir, "HEAD"))),
    status: git(path, "status", "--porcelain=v1", "--untracked-files=all"),
    config: sha256(await readFile(join(absoluteCommonDir, "config"))),
    tracked: await fileHash(join(path, "tracked.txt")),
    staged: await fileHash(join(path, "staged.txt")),
    untracked: await fileHash(join(path, "untracked.txt")),
    worktrees: git(path, "worktree", "list", "--porcelain"),
  };
}

async function initializedFixture() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "fixture-"));
  const directories = Object.fromEntries(
    ["config", "data", "state", "plans", "workspaces", "drafts"].map((name) => [name, join(root, name)]),
  );
  await Promise.all(Object.values(directories).map((path) => mkdir(path, { mode: 0o700 })));
  const config = join(directories.config, "config.json");
  const catalog = join(directories.data, "catalog.json");
  const state = join(directories.state, "local-state.json");
  const initPlan = join(directories.plans, "init.json");
  let result = run([
    "init", "--config", config, "--catalog", catalog, "--state", state,
    "--plans-dir", directories.plans, "--trusted-root", directories.workspaces,
    "--plan", initPlan, "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const initId = JSON.parse(result.stdout).plan.id;
  result = run(["apply", "--config", config, "--plan", initPlan, "--approve", initId, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return { root, directories, config, catalog, state };
}

async function seedCatalog(
  fixture: Awaited<ReturnType<typeof initializedFixture>>,
  repositories: Array<Record<string, unknown>>,
  name = "seed",
) {
  const draft = JSON.parse(run([
    "config", "export", "--target", "catalog", "--config", fixture.config,
  ]).stdout);
  draft.document.repositories = repositories;
  const draftPath = join(fixture.directories.drafts, `${name}.json`);
  const planPath = join(fixture.directories.plans, `${name}.json`);
  await writeFile(draftPath, JSON.stringify(draft, null, 2) + "\n");
  let result = run(["config", "plan", draftPath, "--config", fixture.config, "--plan", planPath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const planId = JSON.parse(result.stdout).plan.id;
  result = run(["apply", "--config", fixture.config, "--plan", planPath, "--approve", planId, "--json"]);
  assert.equal(result.status, 0, result.stderr);
}

const repository = (id: string, remote: string, aliases: string[] = []) => ({
  id,
  remote,
  sourceId: null,
  primaryGroupId: null,
  memberOf: [],
  aliases,
  classification: "unclassified",
  metadata: {},
});

async function writeWorkspaceState(
  fixture: Awaited<ReturnType<typeof initializedFixture>>,
  repositoryWorkspaces: Array<Record<string, unknown>>,
) {
  const state = JSON.parse(await readFile(fixture.state, "utf8"));
  state.repositoryWorkspaces = repositoryWorkspaces;
  await writeFile(fixture.state, JSON.stringify(state, null, 2) + "\n");
}

test("A06 help schemas docs package verifier and portable skill expose the bounded routes", async () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  for (const command of [
    "where REPOSITORY", "workspace select-primary", "adopt --repo ID --path PATH --plan FILE",
  ]) assert.ok(help.stdout.includes(command), command);
  assert.match(help.stdout, /M2\/A06/);

  const readPackage = (path: string) => readFile(join(packageRoot, path), "utf8");
  const readme = await readPackage("README.md");
  const contract = await readPackage("docs/m2-a06-contract.md");
  const commands = await readFile(join(skillRoot, "references", "commands.md"), "utf8");
  const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
  for (const text of [readme, contract, commands, skill]) {
    assert.ok(text.includes("workspacectl where"));
    assert.ok(text.includes("workspacectl adopt"));
    assert.ok(text.includes("select-primary"));
  }
  const planSchema = JSON.parse(await readPackage("schemas/v2/workspace-plan.schema.json"));
  assert.ok(planSchema.properties.kind.enum.includes("adopt"));
  assert.ok(planSchema.properties.kind.enum.includes("workspace-primary"));
  assert.match(planSchema.definitions.adoptRequest.$comment, /observation\.path.*request\.path/);
  const stateSchema = JSON.parse(await readPackage("schemas/v2/local-state.schema.json"));
  assert.equal(stateSchema.properties.repositoryWorkspaces.maxItems, 10000);
  assert.equal(stateSchema.properties.repositoryWorkspaces.uniqueItems, true);
  assert.match(stateSchema.properties.repositoryWorkspaces.$comment, /duplicate repositoryWorkspace id or path/);
  assert.match(contract, /observation\.path == request\.path/);
  assert.match(contract, /duplicate\s+repositoryWorkspace IDs or paths/);
  const packageJson = JSON.parse(await readPackage("package.json"));
  assert.match(packageJson.description, /A06/);
  const verifier = await readPackage("scripts/verify-package.mjs");
  assert.ok(verifier.includes("docs/m2-a06-contract.md"));
});

test("A06 executable schemas align with runtime for local state and plan requests", async () => {
  const readPackage = (path: string) => readFile(join(packageRoot, path), "utf8");
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateStateSchema = ajv.compile(JSON.parse(await readPackage("schemas/v2/local-state.schema.json")));
  const validatePlanSchema = ajv.compile(JSON.parse(await readPackage("schemas/v2/workspace-plan.schema.json")));
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [repository("repo-reactor", "https://github.com/Acme/reactor")]);
    const checkout = join(fixture.directories.workspaces, "schema-reactor");
    await dirtyRepository(checkout, "https://github.com/Acme/reactor");

    const state = JSON.parse(await readFile(fixture.state, "utf8"));
    state.repositoryWorkspaces = [{
      id: "workspace-reactor",
      kind: "primary",
      repositoryId: "repo-reactor",
      path: checkout,
      branch: "feature/schema-alignment",
      primarySelected: true,
      hostLinks: {},
    }];
    assert.equal(validateStateSchema(state), true, JSON.stringify(validateStateSchema.errors));
    assert.deepEqual(validateLocalStateDocument(state), state);

    const exactDuplicateState = structuredClone(state);
    exactDuplicateState.repositoryWorkspaces.push(structuredClone(state.repositoryWorkspaces[0]));
    assert.equal(validateStateSchema(exactDuplicateState), false, "local-state schema accepted an exact duplicate workspace");
    assert.throws(() => validateLocalStateDocument(exactDuplicateState));

    for (const duplicateState of [
      {
        ...structuredClone(state),
        repositoryWorkspaces: [
          structuredClone(state.repositoryWorkspaces[0]),
          { ...structuredClone(state.repositoryWorkspaces[0]), path: `${checkout}-duplicate-id` },
        ],
      },
      {
        ...structuredClone(state),
        repositoryWorkspaces: [
          structuredClone(state.repositoryWorkspaces[0]),
          { ...structuredClone(state.repositoryWorkspaces[0]), id: "workspace-reactor-duplicate-path" },
        ],
      },
    ]) {
      assert.equal(
        validateStateSchema(duplicateState),
        true,
        "standard JSON Schema cannot enforce uniqueness by selected object properties",
      );
      assert.throws(
        () => validateLocalStateDocument(duplicateState),
        "runtime must reject duplicate repositoryWorkspace IDs and paths",
      );
    }

    const malformedStates = [
      { ...structuredClone(state), repositoryWorkspaces: [{ ...state.repositoryWorkspaces[0], id: "workspace/bad" }] },
      { ...structuredClone(state), repositoryWorkspaces: [{ ...state.repositoryWorkspaces[0], path: "relative/path" }] },
      { ...structuredClone(state), repositoryWorkspaces: [{ ...state.repositoryWorkspaces[0], branch: "main\nbad" }] },
      { ...structuredClone(state), repositoryWorkspaces: [{ ...state.repositoryWorkspaces[0], kind: "worktree", primarySelected: true }] },
      { ...structuredClone(state), repositoryWorkspaces: [{ ...state.repositoryWorkspaces[0], hostLinks: [] }] },
      { ...structuredClone(state), repositoryWorkspaces: [{ ...state.repositoryWorkspaces[0], hostLinks: { editor: "unsupported" } }] },
      { ...structuredClone(state), repositoryWorkspaces: [{ ...state.repositoryWorkspaces[0], unexpected: true }] },
    ];
    for (const malformed of malformedStates) {
      assert.equal(validateStateSchema(malformed), false, "local-state schema accepted malformed workspace");
      assert.throws(() => validateLocalStateDocument(malformed));
    }

    const adoptPlanPath = join(fixture.directories.plans, "schema-adopt.json");
    let result = run([
      "adopt", "--repo", "repo-reactor", "--path", checkout,
      "--config", fixture.config, "--plan", adoptPlanPath, "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const adoptPlan = JSON.parse(result.stdout).plan;
    assert.equal(validatePlanSchema(adoptPlan), true, JSON.stringify(validatePlanSchema.errors));
    assert.deepEqual(validateWorkspacePlan(adoptPlan), adoptPlan);

    result = run([
      "apply", "--config", fixture.config, "--plan", adoptPlanPath,
      "--approve", adoptPlan.id, "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const primaryPlanPath = join(fixture.directories.plans, "schema-primary.json");
    result = run([
      "workspace", "select-primary", "--repo", "repo-reactor",
      "--workspace", adoptPlan.request.workspaceId, "--config", fixture.config,
      "--plan", primaryPlanPath, "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const primaryPlan = JSON.parse(result.stdout).plan;
    assert.equal(validatePlanSchema(primaryPlan), true, JSON.stringify(validatePlanSchema.errors));
    assert.deepEqual(validateWorkspacePlan(primaryPlan), primaryPlan);

    for (const validPlan of [adoptPlan, primaryPlan]) {
      const malformed = structuredClone(validPlan);
      malformed.request = {};
      assert.equal(validatePlanSchema(malformed), false, `${validPlan.kind} schema accepted request:{}`);
      assert.throws(() => validateWorkspacePlan(malformed), `${validPlan.kind} runtime accepted request:{}`);
    }

    const malformedAdopt = structuredClone(adoptPlan);
    malformedAdopt.request.observation = {};
    assert.equal(validatePlanSchema(malformedAdopt), false, "adopt schema accepted empty observation");
    assert.throws(() => validateWorkspacePlan(malformedAdopt));

    for (const remote of [
      "https://github.com/a/a",
      `https://github.com/${`a${"-a".repeat(19)}`}/${"r".repeat(100)}`,
      "https://github.com/acme/.repo_name-1",
    ]) {
      const canonicalRemotePlan = structuredClone(adoptPlan);
      canonicalRemotePlan.request.observation.remote = remote;
      assert.equal(
        validatePlanSchema(canonicalRemotePlan),
        true,
        `adopt schema rejected runtime-valid canonical observation.remote ${remote}`,
      );
      assert.doesNotThrow(() => validateWorkspacePlan(canonicalRemotePlan));
    }

    for (const remote of [
      "https://github.com/ac_me/repo",
      "https://github.com/Acme/repo",
      `https://github.com/${"a".repeat(40)}/repo`,
      `https://github.com/acme/${"r".repeat(101)}`,
      "https://github.com/acme/repo.git",
      "https://github.com/acme/repo/",
      "https://github.com/acme/repo.",
    ]) {
      const malformedRemotePlan = structuredClone(adoptPlan);
      malformedRemotePlan.request.observation.remote = remote;
      assert.equal(
        validatePlanSchema(malformedRemotePlan),
        false,
        `adopt schema accepted noncanonical observation.remote ${remote}`,
      );
      assert.throws(() => validateWorkspacePlan(malformedRemotePlan));
    }

    const mismatchedObservationPath = structuredClone(adoptPlan);
    mismatchedObservationPath.request.observation.path = `${adoptPlan.request.path}-different`;
    assert.equal(
      validatePlanSchema(mismatchedObservationPath),
      true,
      "standard JSON Schema cannot require observation.path to equal request.path",
    );
    assert.throws(
      () => validateWorkspacePlan(mismatchedObservationPath),
      "runtime must reject observation.path != request.path",
    );

    const malformedPrimary = structuredClone(primaryPlan);
    malformedPrimary.request.localStateChange = {};
    assert.equal(validatePlanSchema(malformedPrimary), false, "workspace-primary schema accepted empty localStateChange");
    assert.throws(() => validateWorkspacePlan(malformedPrimary));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 adopt refusals preserve registry and checkout bytes", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [repository("repo-reactor", "https://github.com/Acme/reactor", ["reactor"])]);
    const checkout = join(fixture.directories.workspaces, "reactor-refusal");
    const wrongRemote = join(fixture.directories.workspaces, "wrong-remote");
    await dirtyRepository(checkout, "https://github.com/Acme/reactor");
    await dirtyRepository(wrongRemote, "https://github.com/Other/wrong");
    const checkoutBefore = await checkoutSnapshot(checkout);
    const registryBefore = async () => ({
      config: await readFile(fixture.config), catalog: await readFile(fixture.catalog), state: await readFile(fixture.state),
    });
    const assertUnchanged = async (before: Awaited<ReturnType<typeof registryBefore>>) => {
      assert.deepEqual(await registryBefore(), before);
      assert.deepEqual(await checkoutSnapshot(checkout), checkoutBefore);
    };

    const planPath = join(fixture.directories.plans, "guarded-adopt.json");
    let result = run([
      "adopt", "--repo", "repo-reactor", "--path", checkout,
      "--config", fixture.config, "--plan", planPath, "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout).plan;
    let before = await registryBefore();
    result = run(["apply", "--config", fixture.config, "--plan", planPath, "--approve", "wrong-plan", "--json"]);
    assert.equal(JSON.parse(result.stderr).error.code, "APPROVAL_REQUIRED");
    await assertUnchanged(before);

    const state = JSON.parse(await readFile(fixture.state, "utf8"));
    state.metadata.concurrent = "change";
    await writeFile(fixture.state, JSON.stringify(state, null, 2) + "\n");
    before = await registryBefore();
    result = run(["apply", "--config", fixture.config, "--plan", planPath, "--approve", plan.id, "--json"]);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    await assertUnchanged(before);

    for (const [name, args, codes] of [
      ["wrong-remote", ["adopt", "--repo", "repo-reactor", "--path", wrongRemote], ["CONFLICT"]],
      ["outside-root", ["adopt", "--repo", "repo-reactor", "--path", fixture.root], ["INVALID_CONFIG"]],
      ["absent-repo", ["adopt", "--repo", "repo-absent", "--path", checkout], ["NOT_FOUND"]],
    ] as const) {
      before = await registryBefore();
      result = run([...args, "--config", fixture.config, "--plan", join(fixture.directories.plans, `${name}.json`), "--json"]);
      assert.equal(JSON.parse(result.stderr).error.code, codes[0], `${name}: ${result.stderr}`);
      await assertUnchanged(before);
    }

    const linked = join(fixture.directories.workspaces, "linked-checkout");
    await symlink(checkout, linked, "dir");
    before = await registryBefore();
    result = run([
      "adopt", "--repo", "repo-reactor", "--path", linked,
      "--config", fixture.config, "--plan", join(fixture.directories.plans, "linked.json"), "--json",
    ]);
    assert.notEqual(result.status, 0);
    await assertUnchanged(before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 adopting an intentional linked worktree persists a separate worktree binding", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [repository("repo-reactor", "https://github.com/Acme/reactor", ["reactor"])]);
    const primary = join(fixture.directories.workspaces, "reactor-primary");
    const worktree = join(fixture.directories.workspaces, "reactor-feature");
    await dirtyRepository(primary, "https://github.com/Acme/reactor");
    git(primary, "worktree", "add", "-b", "feature/a06", worktree);
    const beforePrimary = await checkoutSnapshot(primary);
    const beforeWorktree = await checkoutSnapshot(worktree);

    for (const [name, path] of [["primary", primary], ["worktree", worktree]]) {
      const planPath = join(fixture.directories.plans, `adopt-${name}.json`);
      let result = run([
        "adopt", "--repo", "repo-reactor", "--path", path,
        "--config", fixture.config, "--plan", planPath, "--json",
      ]);
      assert.equal(result.status, 0, result.stderr);
      const plan = JSON.parse(result.stdout).plan;
      result = run([
        "apply", "--config", fixture.config, "--plan", planPath,
        "--approve", plan.id, "--json",
      ]);
      assert.equal(result.status, 0, result.stderr);
    }
    const located = run(["where", "repo-reactor", "--config", fixture.config, "--json"]);
    assert.equal(located.status, 0, located.stderr);
    assert.deepEqual(JSON.parse(located.stdout).alternatives.map((workspace: Record<string, unknown>) => ({
      kind: workspace.kind, path: workspace.path,
    })).sort((left: { path: unknown }, right: { path: unknown }) => String(left.path).localeCompare(String(right.path))), [
      { kind: "worktree", path: worktree },
      { kind: "primary", path: primary },
    ]);
    assert.deepEqual(await checkoutSnapshot(primary), beforePrimary);
    assert.deepEqual(await checkoutSnapshot(worktree), beforeWorktree);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 adopt registers a dirty verified checkout by local-state CAS without changing Git or files", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [repository("repo-reactor", "https://github.com/Acme/reactor", ["reactor"])]);
    const checkout = join(fixture.directories.workspaces, "reactor-dirty");
    await dirtyRepository(checkout, "git@github.com:Acme/Reactor.git");
    const beforeCheckout = await checkoutSnapshot(checkout);
    const beforeRegistry = {
      config: await readFile(fixture.config),
      catalog: await readFile(fixture.catalog),
      state: await readFile(fixture.state),
    };
    const planPath = join(fixture.directories.plans, "adopt.json");
    let result = run([
      "adopt", "--repo", "repo-reactor", "--path", checkout,
      "--config", fixture.config, "--plan", planPath, "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.plan.kind, "adopt");
    assert.equal(preview.plan.request.observation.dirty, true);
    assert.equal(preview.plan.request.observation.branch, "main");
    assert.deepEqual(await checkoutSnapshot(checkout), beforeCheckout);
    assert.deepEqual(await readFile(fixture.config), beforeRegistry.config);
    assert.deepEqual(await readFile(fixture.catalog), beforeRegistry.catalog);
    assert.deepEqual(await readFile(fixture.state), beforeRegistry.state);

    result = run([
      "apply", "--config", fixture.config, "--plan", planPath,
      "--approve", preview.plan.id, "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const applied = JSON.parse(result.stdout);
    assert.equal(applied.kind, "adopt");
    assert.deepEqual(applied.readback.localState.repositoryWorkspaces, [{
      id: preview.plan.request.workspaceId,
      kind: "primary",
      repositoryId: "repo-reactor",
      path: checkout,
      branch: "main",
      primarySelected: false,
      hostLinks: {},
    }]);
    assert.deepEqual(await checkoutSnapshot(checkout), beforeCheckout);
    assert.deepEqual(await readFile(fixture.config), beforeRegistry.config);
    assert.deepEqual(await readFile(fixture.catalog), beforeRegistry.catalog);
    assert.notDeepEqual(await readFile(fixture.state), beforeRegistry.state);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 duplicate selected primaries refuse with deterministic workspace candidates", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [repository("repo-reactor", "https://github.com/Acme/reactor", ["reactor"])]);
    await writeWorkspaceState(fixture, [
      {
        id: "workspace-zeta", kind: "primary", repositoryId: "repo-reactor",
        path: join(fixture.directories.workspaces, "zeta"), branch: "main",
        primarySelected: true, hostLinks: {},
      },
      {
        id: "workspace-alpha", kind: "primary", repositoryId: "repo-reactor",
        path: join(fixture.directories.workspaces, "alpha"), branch: "main",
        primarySelected: true, hostLinks: {},
      },
    ]);
    const result = run(["where", "reactor", "--config", fixture.config, "--json"]);
    assert.equal(result.status, 2);
    const error = JSON.parse(result.stderr).error;
    assert.equal(error.code, "AMBIGUOUS");
    assert.deepEqual(error.details.candidates.map((candidate: Record<string, unknown>) => candidate.id), [
      "workspace-alpha", "workspace-zeta",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 explicit primary selection persists while an intentional worktree remains distinct", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [repository("repo-reactor", "https://github.com/Acme/reactor", ["reactor"])]);
    const primaryPath = join(fixture.directories.workspaces, "reactor-primary");
    const worktreePath = join(fixture.directories.workspaces, "reactor-feature");
    await writeWorkspaceState(fixture, [
      {
        id: "workspace-reactor-primary", kind: "primary", repositoryId: "repo-reactor",
        path: primaryPath, branch: "main", primarySelected: false, hostLinks: {},
      },
      {
        id: "workspace-reactor-feature", kind: "worktree", repositoryId: "repo-reactor",
        path: worktreePath, branch: "feature/a06", primarySelected: false, hostLinks: {},
      },
    ]);
    let result = run(["where", "reactor", "--config", fixture.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    let body = JSON.parse(result.stdout);
    assert.equal(body.selectedWorkspace, null);
    assert.deepEqual(body.alternatives.map((workspace: Record<string, unknown>) => ({
      id: workspace.id, kind: workspace.kind, path: workspace.path,
    })), [
      { id: "workspace-reactor-feature", kind: "worktree", path: worktreePath },
      { id: "workspace-reactor-primary", kind: "primary", path: primaryPath },
    ]);

    const planPath = join(fixture.directories.plans, "select-primary.json");
    result = run([
      "workspace", "select-primary", "--repo", "repo-reactor",
      "--workspace", "workspace-reactor-primary", "--config", fixture.config,
      "--plan", planPath, "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    body = JSON.parse(result.stdout);
    assert.equal(body.plan.kind, "workspace-primary");
    const planId = body.plan.id;
    result = run(["apply", "--config", fixture.config, "--plan", planPath, "--approve", planId, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const appliedState = JSON.parse(result.stdout).readback.localState.repositoryWorkspaces;
    assert.equal(appliedState.find((workspace: Record<string, unknown>) => workspace.id === "workspace-reactor-feature").primarySelected, false);
    assert.equal(appliedState.find((workspace: Record<string, unknown>) => workspace.id === "workspace-reactor-primary").primarySelected, true);

    result = run(["where", "repo-reactor", "--config", fixture.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    body = JSON.parse(result.stdout);
    assert.equal(body.selectedWorkspace.id, "workspace-reactor-primary");
    assert.equal(body.alternatives[0].kind, "worktree");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 ambiguous alias refuses with a deterministic repository choice", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [
      repository("repo-alpha", "https://github.com/Acme/alpha", ["shared"]),
      repository("repo-zeta", "https://github.com/Acme/zeta", ["SHARED"]),
    ]);
    const result = run(["where", "shared", "--config", fixture.config, "--json"]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: {
        code: "AMBIGUOUS",
        message: "The requested identity is ambiguous.",
        details: {
          candidates: [
            { id: "repo-alpha", remote: "https://github.com/Acme/alpha" },
            { id: "repo-zeta", remote: "https://github.com/Acme/zeta" },
          ],
        },
      },
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 remote-shaped aliases fall back only when no canonical remote matches", async () => {
  const fixture = await initializedFixture();
  try {
    const remoteShapedAlias = "https://github.com/acme/alias-shaped";
    await seedCatalog(fixture, [
      repository("repo-alias", "https://github.com/Acme/actual", [remoteShapedAlias]),
      repository("repo-remote", remoteShapedAlias, []),
    ]);

    let result = run(["where", remoteShapedAlias, "--config", fixture.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    let body = JSON.parse(result.stdout);
    assert.equal(body.repository.id, "repo-remote");
    assert.equal(body.match.kind, "remote");

    await seedCatalog(fixture, [
      repository("repo-alias", "https://github.com/Acme/actual", [remoteShapedAlias]),
    ], "fallback");
    result = run(["where", remoteShapedAlias, "--config", fixture.config, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    body = JSON.parse(result.stdout);
    assert.equal(body.repository.id, "repo-alias");
    assert.equal(body.match.kind, "alias");

    await seedCatalog(fixture, [
      repository("repo-zeta", "https://github.com/Acme/zeta", [remoteShapedAlias.toUpperCase()]),
      repository("repo-alpha", "https://github.com/Acme/alpha", [remoteShapedAlias]),
    ], "ambiguous-fallback");
    result = run(["where", remoteShapedAlias, "--config", fixture.config, "--json"]);
    assert.equal(result.status, 2);
    assert.deepEqual(
      JSON.parse(result.stderr).error.details.candidates.map((candidate: Record<string, unknown>) => candidate.id),
      ["repo-alpha", "repo-zeta"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A06 where resolves stable ID, canonical remote, and unique alias to the persisted primary", async () => {
  const fixture = await initializedFixture();
  try {
    await seedCatalog(fixture, [
      repository("repo-reactor", "git@github.com:Acme/Reactor.git", ["Reactor", "core-api"]),
    ]);
    const primaryPath = join(fixture.directories.workspaces, "reactor-primary");
    await writeWorkspaceState(fixture, [{
      id: "workspace-reactor-primary",
      kind: "primary",
      repositoryId: "repo-reactor",
      path: primaryPath,
      branch: "main",
      primarySelected: true,
      hostLinks: {},
    }]);

    for (const target of [
      "repo-reactor",
      "https://github.com/acme/reactor",
      "CORE-API",
    ]) {
      const result = run(["where", target, "--config", fixture.config, "--json"]);
      assert.equal(result.status, 0, `${target}: ${result.stderr}`);
      const body = JSON.parse(result.stdout);
      assert.equal(body.repository.id, "repo-reactor");
      assert.equal(body.match.kind, target === "repo-reactor" ? "id" : target === "CORE-API" ? "alias" : "remote");
      assert.equal(body.selectedWorkspace.id, "workspace-reactor-primary");
      assert.equal(body.selectedWorkspace.path, primaryPath);
      assert.deepEqual(body.alternatives, []);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
