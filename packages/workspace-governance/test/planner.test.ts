import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { discoverLocal } from "../src/discovery.ts";
import * as planner from "../src/planner.ts";
import { example, envelope } from "./fixtures.ts";
const inventory = () => ({
  root: resolve(tmpdir(), "synthetic-governance"),
  complete: true,
  errors: [],
  repositories: [] as any[],
  occupiedPaths: [] as string[],
  unsafePaths: [] as string[],
});
test("A8 deterministic scoped previews and exact rederivation reject every tamper", () => {
  const s = envelope();
  const inv = inventory();
  const target = join(inv.root, "example", "service", "api");
  let plan = planner.createPlan(s, inv, "org", "reader");
  assert.equal(plan.entries[0].status, "missing-checkout");
  assert.equal(plan.entries[0].target, target);
  assert.equal(plan.executable, false);
  planner.verifyPlan(plan, s, inv, "org", "reader");
  inv.repositories = [
    {
      path: target,
      remote: "https://github.com/example/api",
      head: null,
      dirty: false,
      worktree: false,
      status: "",
    },
  ];
  inv.occupiedPaths = [target];
  plan = planner.createPlan(s, inv, "org", "reader");
  assert.equal(plan.entries[0].status, "present");
  for (const edit of [
    (p: any) => (p.executable = true),
    (p: any) => (p.extra = true),
    (p: any) => (p.entries[0].target = inv.root),
    (p: any) => (p.principal = "other"),
    (p: any) => (p.entries = []),
  ]) {
    const altered = structuredClone(plan);
    edit(altered);
    assert.throws(() => planner.verifyPlan(altered, s, inv, "org", "reader"), {
      code: "STALE_PLAN",
    });
  }
  assert.throws(() => planner.verifyPlan(plan, s, inv, "org", "other"), {
    code: "STALE_PLAN",
  });
  inv.repositories[0].dirty = true;
  inv.repositories[0].status = " M hidden-filename";
  assert.equal(
    planner.createPlan(s, inv, "org", "reader").entries[0].status,
    "blocked",
  );
  assert.equal(
    JSON.stringify(planner.createPlan(s, inv, "org", "reader")).includes(
      "hidden-filename",
    ),
    false,
  );
  assert.throws(() => planner.verifyPlan(plan, s, inv, "org", "reader"), {
    code: "STALE_PLAN",
  });
  inv.repositories.push({
    ...inv.repositories[0],
    path: join(inv.root, "copy"),
  });
  assert.equal(
    planner.createPlan(s, inv, "org", "reader").entries[0].status,
    "duplicate",
  );
  inv.repositories = [
    {
      ...inv.repositories[0],
      path: join(inv.root, "elsewhere"),
      dirty: false,
      status: "",
    },
  ];
  inv.occupiedPaths = [];
  assert.equal(
    planner.createPlan(s, inv, "org", "reader").entries[0].status,
    "misplaced",
  );
  inv.occupiedPaths = [target];
  assert.equal(
    planner.createPlan(s, inv, "org", "reader").entries[0].status,
    "blocked",
  );
  inv.occupiedPaths = [];
  inv.unsafePaths = [join(inv.root, "example")];
  assert.equal(
    planner.createPlan(s, inv, "org", "reader").entries[0].status,
    "blocked",
  );
  inv.complete = false;
  assert.throws(() => planner.createPlan(s, inv, "org", "reader"), {
    code: "INCOMPLETE",
  });
});
for (const components of [["example"], ["example", "service"]]) {
  test(`A8 real filesystem ${components.join("/")} ancestor obstruction is blocked`, async () => {
    const root = await mkdtemp(join(tmpdir(), "governance-obstruction-"));
    try {
      const ancestor = join(root, ...components);
      await mkdir(join(root, ...components.slice(0, -1)), { recursive: true });
      await writeFile(ancestor, "synthetic obstruction");
      const blockedInventory = await discoverLocal(root);
      assert.equal(blockedInventory.complete, true);
      const blocked = planner.createPlan(envelope(), blockedInventory, "org", "reader");
      assert.equal(blocked.entries[0].status, "blocked");
      assert.equal(blocked.entries[0].target, join(root, "example", "service", "api"));
      await rm(ancestor);
      await mkdir(ancestor);
      const directoryInventory = await discoverLocal(root);
      assert.equal(directoryInventory.complete, true);
      const missing = planner.createPlan(envelope(), directoryInventory, "org", "reader");
      assert.equal(missing.entries[0].status, "missing-checkout");
      assert.notEqual(blocked.inventoryDigest, missing.inventoryDigest);
      assert.throws(() => planner.verifyPlan(blocked, envelope(), directoryInventory, "org", "reader"), {
        code: "STALE_PLAN",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("A8 bounded porcelain larger than manifest strings still produces a preview", () => {
  const inv = inventory();
  inv.repositories = [
    {
      path: join(inv.root, "checkout"),
      remote: "https://github.com/example/api",
      head: null,
      dirty: true,
      worktree: false,
      status: " M file\n".repeat(3000),
    },
  ];
  const plan = planner.createPlan(envelope(), inv, "org", "reader");
  assert.equal(plan.entries[0].status, "blocked");
  planner.verifyPlan(plan, envelope(), inv, "org", "reader");
  inv.repositories[0].status += "?? new\n";
  assert.throws(
    () => planner.verifyPlan(plan, envelope(), inv, "org", "reader"),
    { code: "STALE_PLAN" },
  );
});

test("A8 unreadable descendants refuse whole scope; workspace is explicitly unbound", () => {
  const m: any = example();
  m.nodes[2].visibility = { mode: "restricted", readers: ["alice"] };
  assert.throws(
    () => planner.createPlan(envelope(m), inventory(), "org", "reader"),
    { code: "UNAVAILABLE" },
  );
  m.nodes.push({
    id: "ws",
    kind: "workspace",
    slug: "primary",
    parentId: "repo",
  });
  assert.throws(
    () => planner.createPlan(envelope(m), inventory(), "ws", "alice"),
    { code: "UNSUPPORTED" },
  );
  const inv = inventory();
  inv.repositories = [
    {
      path: join(inv.root, "unmanaged"),
      remote: "https://github.com/example/hidden",
      head: null,
      dirty: false,
      worktree: false,
      status: "",
    },
  ];
  const text = JSON.stringify(
    planner.createPlan(envelope(), inv, "repo", "reader"),
  );
  assert.equal(text.includes("unmanaged"), false);
  assert.equal(text.includes("example/hidden"), false);
});
