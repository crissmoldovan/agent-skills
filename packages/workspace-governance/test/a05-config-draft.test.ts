import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const tempRoot = join(process.env.TMPDIR ?? tmpdir(), "workspacectl-a05-tests");
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

async function initializedFixture() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(tempRoot, "draft-"));
  const directories = Object.fromEntries(
    ["config", "data", "state", "plans", "workspaces", "drafts"].map((name) => [name, join(root, name)]),
  );
  await Promise.all(Object.values(directories).map((path) => mkdir(path, { mode: 0o700 })));
  const config = join(directories.config, "config.yaml");
  const catalog = join(directories.data, "catalog.json");
  const state = join(directories.state, "local-state.json");
  const initPlan = join(directories.plans, "init.json");
  let result = run([
    "init", "--config", config, "--catalog", catalog, "--state", state,
    "--plans-dir", directories.plans, "--trusted-root", directories.workspaces,
    "--plan", initPlan, "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const planId = JSON.parse(result.stdout).plan.id;
  result = run(["apply", "--config", config, "--plan", initPlan, "--approve", planId, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const checkout = join(directories.workspaces, "synthetic-checkout.fact");
  await writeFile(checkout, "synthetic checkout must remain byte-identical\n");
  const stateDocument = JSON.parse(await readFile(state, "utf8"));
  stateDocument.metadata.syntheticCheckoutPath = checkout;
  await writeFile(state, JSON.stringify(stateDocument, null, 2) + "\n");
  return { root, directories, config, catalog, state, checkout };
}

async function activeBytes(fixture: Awaited<ReturnType<typeof initializedFixture>>) {
  const [config, catalog, state, checkout] = await Promise.all([
    readFile(fixture.config),
    readFile(fixture.catalog),
    readFile(fixture.state),
    readFile(fixture.checkout),
  ]);
  assert.equal(JSON.parse(state.toString("utf8")).metadata.syntheticCheckoutPath, fixture.checkout);
  return { config, catalog, state, checkout };
}

async function assertActiveBytes(
  fixture: Awaited<ReturnType<typeof initializedFixture>>,
  expected: Awaited<ReturnType<typeof activeBytes>>,
) {
  assert.deepEqual(await activeBytes(fixture), expected);
}

test("A05 cross-owner membership and classification acceptance or rejection retain repository rows", async () => {
  const fixture = await initializedFixture();
  try {
    const exported = JSON.parse(run(["config", "export", "--target", "catalog", "--config", fixture.config]).stdout);
    exported.document.groups = [
      { id: "org-rgc", kind: "organization", name: "RGC", slug: "rgc", parentId: null, metadata: {} },
      { id: "project-wherefrom", kind: "project", name: "Wherefrom", slug: "wherefrom", parentId: "org-rgc", metadata: {} },
    ];
    exported.document.sources = [
      { id: "source-alpha", provider: "github", owner: "AlphaOwner", ownerType: "organization", include: [], exclude: [], proposedDefaultGroupId: null, metadata: {} },
      { id: "source-beta", provider: "github", owner: "BetaOwner", ownerType: "organization", include: [], exclude: [], proposedDefaultGroupId: null, metadata: {} },
    ];
    exported.document.repositories = [
      { id: "repo-alpha", remote: "https://github.com/AlphaOwner/service", sourceId: "source-alpha", primaryGroupId: null, memberOf: [], aliases: [], classification: "suggested", metadata: {} },
      { id: "repo-beta", remote: "git@github.com:BetaOwner/client.git", sourceId: "source-beta", primaryGroupId: null, memberOf: [], aliases: [], classification: "suggested", metadata: {} },
    ];
    const seedDraft = join(fixture.directories.drafts, "seed.json");
    const seedPlan = join(fixture.directories.plans, "seed.json");
    await writeFile(seedDraft, JSON.stringify(exported, null, 2) + "\n");
    let preview = run(["config", "plan", seedDraft, "--config", fixture.config, "--plan", seedPlan, "--json"]);
    assert.equal(preview.status, 0, preview.stderr);
    let planId = JSON.parse(preview.stdout).plan.id;
    assert.equal(run(["apply", "--config", fixture.config, "--plan", seedPlan, "--approve", planId]).status, 0);

    const mutate = (name: string, args: string[]) => {
      const plan = join(fixture.directories.plans, `${name}.json`);
      const result = run([...args, "--config", fixture.config, "--plan", plan, "--json"]);
      assert.equal(result.status, 0, result.stderr);
      planId = JSON.parse(result.stdout).plan.id;
      const applied = run(["apply", "--config", fixture.config, "--plan", plan, "--approve", planId, "--json"]);
      assert.equal(applied.status, 0, applied.stderr);
      return JSON.parse(applied.stdout);
    };
    mutate("membership", ["repo", "membership", "--id", "repo-beta", "--project", "project-wherefrom", "--action", "add"]);
    mutate("accept", ["repo", "classify", "--id", "repo-alpha", "--decision", "accept", "--group", "project-wherefrom"]);
    const rejected = mutate("reject", ["repo", "classify", "--id", "repo-beta", "--decision", "reject"]);
    assert.deepEqual(rejected.transition, {
      type: "classification",
      repositoryId: "repo-beta",
      decision: "rejected",
      primaryGroupId: null,
    });

    const alpha = run(["repo", "show", "--id", "repo-alpha", "--config", fixture.config, "--json"]);
    const beta = run(["repo", "show", "--id", "repo-beta", "--config", fixture.config, "--json"]);
    assert.equal(alpha.status, 0, alpha.stderr);
    assert.equal(beta.status, 0, beta.stderr);
    assert.deepEqual(JSON.parse(alpha.stdout).repository, {
      ...exported.document.repositories[0],
      primaryGroupId: "project-wherefrom",
      classification: "confirmed",
    });
    assert.deepEqual(JSON.parse(beta.stdout).repository, {
      ...exported.document.repositories[1],
      primaryGroupId: null,
      memberOf: ["project-wherefrom"],
      classification: "unclassified",
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 help docs schema and package surface list the shipped commands and plan kind", async () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  for (const command of [
    "config validate FILE",
    "config plan FILE --config FILE --plan FILE",
    "group create",
    "group update",
    "group reparent",
    "repo membership",
    "repo classify",
    "repo show",
  ]) assert.match(help.stdout, new RegExp(command.replaceAll(" ", "\\s+")), command);

  const read = async (path: string) => readFile(join(packageRoot, path), "utf8");
  const readme = await read("README.md");
  for (const command of ["config validate FILE", "config plan FILE", "group create", "repo classify"])
    assert.ok(readme.includes(command), command);
  const contract = await read("docs/m2-a05-contract.md");
  assert.ok(contract.includes("config plan FILE --config FILE --plan FILE"));
  const schema = JSON.parse(await read("schemas/v2/workspace-plan.schema.json"));
  assert.ok(schema.properties.kind.enum.includes("catalog-edit"));
  const packageJson = JSON.parse(await read("package.json"));
  assert.match(packageJson.description, /A05/);
  const verifier = await read("scripts/verify-package.mjs");
  assert.ok(verifier.includes("docs/m2-a05-contract.md"));
  const api = await import("../src/index.ts");
  assert.equal(typeof (api as Record<string, unknown>).createCatalogOperationPlan, "function");
});

test("A05 tampered drafts and plans symlinks and locks refuse without mutation", async () => {
  const fixture = await initializedFixture();
  try {
    const original = await activeBytes(fixture);
    const draft = JSON.parse(run(["config", "export", "--target", "catalog", "--config", fixture.config]).stdout);
    draft.document.groups.push({ id: "org-rgc", kind: "organization", name: "RGC", slug: "rgc", parentId: null, metadata: {} });
    const draftPath = join(fixture.directories.drafts, "guarded.json");
    const draftPlan = join(fixture.directories.plans, "guarded.json");
    await writeFile(draftPath, JSON.stringify(draft, null, 2) + "\n");
    let result = run(["config", "plan", draftPath, "--config", fixture.config, "--plan", draftPlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const draftPlanId = JSON.parse(result.stdout).plan.id;
    draft.document.groups[0].name = "Tampered";
    await writeFile(draftPath, JSON.stringify(draft, null, 2) + "\n");
    result = run(["apply", "--config", fixture.config, "--plan", draftPlan, "--approve", draftPlanId, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    await assertActiveBytes(fixture, original);

    const realDraft = join(fixture.directories.drafts, "real.json");
    const linkedDraft = join(fixture.directories.drafts, "linked.json");
    await writeFile(realDraft, JSON.stringify(draft, null, 2) + "\n");
    await symlink(realDraft, linkedDraft);
    result = run(["config", "validate", linkedDraft, "--config", fixture.config, "--json"]);
    assert.notEqual(result.status, 0);
    await assertActiveBytes(fixture, original);

    const operationPlan = join(fixture.directories.plans, "operation.json");
    result = run(["group", "create", "--kind", "organization", "--id", "org-safe", "--name", "Safe", "--slug", "safe", "--config", fixture.config, "--plan", operationPlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const operationPlanId = JSON.parse(result.stdout).plan.id;
    const linkedPlan = join(fixture.directories.plans, "linked-plan.json");
    await symlink(operationPlan, linkedPlan);
    result = run(["apply", "--config", fixture.config, "--plan", linkedPlan, "--approve", operationPlanId, "--json"]);
    assert.notEqual(result.status, 0);
    await assertActiveBytes(fixture, original);

    const tamperedPlan = JSON.parse(await readFile(operationPlan, "utf8"));
    tamperedPlan.request.operation.group.name = "Tampered";
    await writeFile(operationPlan, JSON.stringify(tamperedPlan, null, 2) + "\n");
    result = run(["apply", "--config", fixture.config, "--plan", operationPlan, "--approve", operationPlanId, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    await assertActiveBytes(fixture, original);

    const draftAncestor = join(fixture.directories.drafts, "redirect-draft");
    const preservedDraftAncestor = join(fixture.directories.drafts, "redirect-draft-at-preview");
    const redirectedDraftAncestor = join(fixture.directories.drafts, "redirect-draft-target");
    await Promise.all([mkdir(draftAncestor), mkdir(redirectedDraftAncestor)]);
    const redirectDraft = join(draftAncestor, "draft.json");
    const redirectDraftPlan = join(fixture.directories.plans, "redirect-draft.json");
    const redirectDraftDocument = structuredClone(draft);
    redirectDraftDocument.document.groups = [{
      id: "org-redirect-draft", kind: "organization", name: "Redirect", slug: "redirect",
      parentId: null, metadata: {},
    }];
    await writeFile(redirectDraft, JSON.stringify(redirectDraftDocument, null, 2) + "\n");
    result = run(["config", "plan", redirectDraft, "--config", fixture.config, "--plan", redirectDraftPlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const redirectDraftPlanId = JSON.parse(result.stdout).plan.id;
    await rename(draftAncestor, preservedDraftAncestor);
    await writeFile(join(redirectedDraftAncestor, "draft.json"), await readFile(join(preservedDraftAncestor, "draft.json")));
    await symlink(redirectedDraftAncestor, draftAncestor, "dir");
    result = run(["apply", "--config", fixture.config, "--plan", redirectDraftPlan, "--approve", redirectDraftPlanId, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, "STALE_PLAN");
    await assertActiveBytes(fixture, original);

    const lockPlan = join(fixture.directories.plans, "lock.json");
    result = run(["group", "create", "--kind", "organization", "--id", "org-lock", "--name", "Lock", "--slug", "lock", "--config", fixture.config, "--plan", lockPlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const lockPlanId = JSON.parse(result.stdout).plan.id;
    const lockPath = `${fixture.catalog}.lock`;
    await writeFile(lockPath, "unknown lock owner\n");
    result = run(["apply", "--config", fixture.config, "--plan", lockPlan, "--approve", lockPlanId, "--json"]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, "BUSY");
    assert.equal(await readFile(lockPath, "utf8"), "unknown lock owner\n");
    await assertActiveBytes(fixture, original);

    await rm(lockPath);
    const redirectOperationPlan = join(fixture.directories.plans, "redirect-operation.json");
    result = run(["group", "create", "--kind", "organization", "--id", "org-redirect-plan", "--name", "Redirect", "--slug", "redirect-plan", "--config", fixture.config, "--plan", redirectOperationPlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const redirectOperationPlanId = JSON.parse(result.stdout).plan.id;
    const preservedPlansDirectory = join(fixture.root, "plans-at-preview");
    const redirectedPlansDirectory = join(fixture.root, "plans-redirect-target");
    await rename(fixture.directories.plans, preservedPlansDirectory);
    await mkdir(redirectedPlansDirectory);
    await writeFile(
      join(redirectedPlansDirectory, "redirect-operation.json"),
      await readFile(join(preservedPlansDirectory, "redirect-operation.json")),
    );
    await symlink(redirectedPlansDirectory, fixture.directories.plans, "dir");
    result = run(["apply", "--config", fixture.config, "--plan", redirectOperationPlan, "--approve", redirectOperationPlanId, "--json"]);
    assert.notEqual(result.status, 0);
    await assertActiveBytes(fixture, original);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 invalid parent cycle and duplicate sibling slug refuse before write", async () => {
  const fixture = await initializedFixture();
  try {
    const applyCreate = (name: string, args: string[]) => {
      const plan = join(fixture.directories.plans, `${name}.json`);
      const preview = run([...args, "--config", fixture.config, "--plan", plan, "--json"]);
      assert.equal(preview.status, 0, preview.stderr);
      const id = JSON.parse(preview.stdout).plan.id;
      const applied = run(["apply", "--config", fixture.config, "--plan", plan, "--approve", id, "--json"]);
      assert.equal(applied.status, 0, applied.stderr);
    };
    applyCreate("hierarchy-org", ["group", "create", "--kind", "organization", "--id", "org-rgc", "--name", "RGC", "--slug", "rgc"]);
    applyCreate("hierarchy-area-a", ["group", "create", "--kind", "area", "--id", "area-a", "--name", "Area A", "--slug", "area-a", "--parent", "org-rgc"]);
    applyCreate("hierarchy-area-b", ["group", "create", "--kind", "area", "--id", "area-b", "--name", "Area B", "--slug", "area-b", "--parent", "area-a"]);
    const before = await activeBytes(fixture);
    const refusals = [
      ["group", "reparent", "--id", "area-a", "--parent", "area-b"],
      ["group", "create", "--kind", "project", "--id", "bad-parent", "--name", "Bad Parent", "--slug", "bad-parent", "--parent", "missing"],
      ["group", "create", "--kind", "area", "--id", "duplicate", "--name", "Duplicate", "--slug", "area-b", "--parent", "area-a"],
      ["group", "create", "--kind", "organization", "--id", "nested-org", "--name", "Nested", "--slug", "nested", "--parent", "org-rgc"],
    ];
    for (const [index, args] of refusals.entries()) {
      const plan = join(fixture.directories.plans, `invalid-${index}.json`);
      const refused = run([...args, "--config", fixture.config, "--plan", plan, "--json"]);
      assert.notEqual(refused.status, 0);
      await assertActiveBytes(fixture, before);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 stale catalog plans and wrong approval refuse without mutation", async () => {
  const fixture = await initializedFixture();
  try {
    const before = await activeBytes(fixture);
    const planA = join(fixture.directories.plans, "approval-a.json");
    const planB = join(fixture.directories.plans, "approval-b.json");
    const args = ["group", "create", "--kind", "organization", "--id", "org-rgc", "--name", "RGC", "--slug", "rgc", "--config", fixture.config];
    const first = run([...args, "--plan", planA, "--json"]);
    const second = run([...args, "--plan", planB, "--json"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const firstId = JSON.parse(first.stdout).plan.id;
    const secondId = JSON.parse(second.stdout).plan.id;

    for (const approval of [undefined, "plan-wrong"]) {
      const applyArgs = ["apply", "--config", fixture.config, "--plan", planA];
      if (approval !== undefined) applyArgs.push("--approve", approval);
      applyArgs.push("--json");
      const refused = run(applyArgs);
      assert.equal(refused.status, 4, refused.stderr);
      assert.equal(JSON.parse(refused.stderr).error.code, "APPROVAL_REQUIRED");
      await assertActiveBytes(fixture, before);
    }

    const applied = run(["apply", "--config", fixture.config, "--plan", planA, "--approve", firstId, "--json"]);
    assert.equal(applied.status, 0, applied.stderr);
    const afterApplied = await activeBytes(fixture);
    const stale = run(["apply", "--config", fixture.config, "--plan", planB, "--approve", secondId, "--json"]);
    assert.notEqual(stale.status, 0);
    assert.equal(JSON.parse(stale.stderr).error.code, "STALE_PLAN");
    await assertActiveBytes(fixture, afterApplied);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 rename and regroup preserve stable repository identity and local checkout bytes", async () => {
  const fixture = await initializedFixture();
  const checkoutFact = fixture.checkout;
  try {
    const exported = JSON.parse(run(["config", "export", "--target", "catalog", "--config", fixture.config]).stdout);
    exported.document.groups = [
      { id: "org-rgc", kind: "organization", name: "RGC", slug: "rgc", parentId: null, metadata: {} },
      { id: "area-products", kind: "area", name: "Products", slug: "products", parentId: "org-rgc", metadata: {} },
      { id: "project-wherefrom", kind: "project", name: "Wherefrom", slug: "wherefrom", parentId: "org-rgc", metadata: {} },
    ];
    exported.document.repositories = [{
      id: "repo-stable", remote: "https://github.com/AlphaOwner/service", sourceId: null,
      primaryGroupId: "project-wherefrom", memberOf: [], aliases: [], classification: "confirmed", metadata: {},
    }];
    const seedDraft = join(fixture.directories.drafts, "identity-seed.json");
    const seedPlan = join(fixture.directories.plans, "identity-seed.json");
    await writeFile(seedDraft, JSON.stringify(exported, null, 2) + "\n");
    let result = run(["config", "plan", seedDraft, "--config", fixture.config, "--plan", seedPlan, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    let planId = JSON.parse(result.stdout).plan.id;
    result = run(["apply", "--config", fixture.config, "--plan", seedPlan, "--approve", planId, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const configBefore = await readFile(fixture.config);
    const stateBefore = await readFile(fixture.state);
    const checkoutBefore = await readFile(checkoutFact);
    assert.equal(JSON.parse(stateBefore.toString("utf8")).metadata.syntheticCheckoutPath, checkoutFact);

    const applyOperation = (name: string, args: string[]) => {
      const plan = join(fixture.directories.plans, `${name}.json`);
      const preview = run([...args, "--config", fixture.config, "--plan", plan, "--json"]);
      assert.equal(preview.status, 0, preview.stderr);
      planId = JSON.parse(preview.stdout).plan.id;
      const applied = run(["apply", "--config", fixture.config, "--plan", plan, "--approve", planId, "--json"]);
      assert.equal(applied.status, 0, applied.stderr);
    };
    applyOperation("identity-rename", ["group", "update", "--id", "project-wherefrom", "--name", "Wherefrom Platform", "--slug", "wherefrom-platform"]);
    applyOperation("identity-reparent", ["group", "reparent", "--id", "project-wherefrom", "--parent", "area-products"]);

    const shown = run(["group", "show", "--id", "project-wherefrom", "--config", fixture.config, "--json"]);
    assert.equal(shown.status, 0, shown.stderr);
    const body = JSON.parse(shown.stdout);
    assert.deepEqual(body.repositories, [exported.document.repositories[0]]);
    assert.equal(body.group.id, "project-wherefrom");
    assert.equal(body.group.name, "Wherefrom Platform");
    assert.equal(body.group.parentId, "area-products");
    assert.deepEqual(await readFile(fixture.config), configBefore);
    assert.deepEqual(await readFile(fixture.state), stateBefore);
    assert.deepEqual(await readFile(checkoutFact), checkoutBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 group convenience create update and reparent use catalog-edit plans", async () => {
  const fixture = await initializedFixture();
  try {
    const invoke = (name: string, args: string[]) => {
      const planPath = join(fixture.directories.plans, `${name}.json`);
      const preview = run([...args, "--config", fixture.config, "--plan", planPath, "--json"]);
      assert.equal(preview.status, 0, preview.stderr);
      const body = JSON.parse(preview.stdout);
      assert.equal(body.plan.kind, "catalog-edit");
      const applied = run([
        "apply", "--config", fixture.config, "--plan", planPath, "--approve", body.plan.id, "--json",
      ]);
      assert.equal(applied.status, 0, applied.stderr);
      return JSON.parse(applied.stdout);
    };
    invoke("org", ["group", "create", "--kind", "organization", "--id", "org-rgc", "--name", "RGC", "--slug", "rgc"]);
    invoke("area", ["group", "create", "--kind", "area", "--id", "area-products", "--name", "Products", "--slug", "products", "--parent", "org-rgc"]);
    invoke("project", ["group", "create", "--kind", "project", "--id", "project-wherefrom", "--name", "Wherefrom", "--slug", "wherefrom", "--parent", "org-rgc"]);
    invoke("rename", ["group", "update", "--id", "project-wherefrom", "--name", "Wherefrom Platform", "--slug", "wherefrom-platform"]);
    invoke("reparent", ["group", "reparent", "--id", "project-wherefrom", "--parent", "area-products"]);

    const shown = run(["group", "show", "--id", "project-wherefrom", "--config", fixture.config, "--json"]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.deepEqual(JSON.parse(shown.stdout).group, {
      id: "project-wherefrom",
      kind: "project",
      name: "Wherefrom Platform",
      slug: "wherefrom-platform",
      parentId: "area-products",
      metadata: {},
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A05 complete catalog draft validates, plans, applies, and reads back", async () => {
  const fixture = await initializedFixture();
  try {
    const exported = run(["config", "export", "--target", "catalog", "--config", fixture.config]);
    assert.equal(exported.status, 0, exported.stderr);
    const draft = JSON.parse(exported.stdout);
    draft.document.groups.push(
      { id: "org-rgc", kind: "organization", name: "RGC", slug: "rgc", parentId: null, metadata: {} },
      { id: "project-wherefrom", kind: "project", name: "Wherefrom", slug: "wherefrom", parentId: "org-rgc", metadata: {} },
    );
    const draftPath = join(fixture.directories.drafts, "catalog-edit.json");
    const planPath = join(fixture.directories.plans, "catalog-edit.json");
    await writeFile(draftPath, JSON.stringify(draft, null, 2) + "\n", { mode: 0o600 });

    const validated = run(["config", "validate", draftPath, "--config", fixture.config, "--json"]);
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).valid, true);

    const preview = run([
      "config", "plan", draftPath, "--config", fixture.config, "--plan", planPath, "--json",
    ]);
    assert.equal(preview.status, 0, preview.stderr);
    const previewBody = JSON.parse(preview.stdout);
    assert.equal(previewBody.applied, false);
    assert.equal(previewBody.plan.kind, "catalog-edit");
    assert.equal(previewBody.plan.actions.length, 1);
    assert.equal(previewBody.plan.actions[0].target, "catalog");

    const applied = run([
      "apply", "--config", fixture.config, "--plan", planPath,
      "--approve", previewBody.plan.id, "--json",
    ]);
    assert.equal(applied.status, 0, applied.stderr);
    const appliedBody = JSON.parse(applied.stdout);
    assert.equal(appliedBody.kind, "catalog-edit");
    assert.deepEqual(appliedBody.readback.catalog.groups, draft.document.groups);

    const fresh = run(["group", "list", "--config", fixture.config, "--json"]);
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.deepEqual(JSON.parse(fresh.stdout).groups, draft.document.groups);
    assert.deepEqual(JSON.parse(await readFile(fixture.catalog, "utf8")).groups, draft.document.groups);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
