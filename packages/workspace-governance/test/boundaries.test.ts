import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { resolvePolicy } from "../src/core.ts";
import { FileSnapshotStore, loadSnapshot } from "../src/stores.ts";
import { discoverLocal } from "../src/discovery.ts";
import { envelope, example, scratchRoot } from "./fixtures.ts";
test("A2 constraints themselves cannot introduce prefix-overlap logical fields", () => {
  const m: any = example();
  m.policies = [
    {
      nodeId: "org",
      settings: [],
      constraints: [
        { id: "a", key: "a", operator: "forbidden-values", value: [] },
        { id: "b", key: "a.b", operator: "forbidden-values", value: [] },
      ],
    },
  ];
  assert.throws(() => resolvePolicy(envelope(m), "repo", "reader"));
});
test("A5 UTF8 BOM is not silently removed before exact file parsing/revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "governance-bom-"));
  try {
    const file = join(root, "manifest.json");
    await writeFile(file, "\ufeff" + JSON.stringify(example()));
    await assert.rejects(() => loadSnapshot(new FileSnapshotStore(file)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("A6 local core.worktree cannot redirect status outside the explicit checkout", async () => {
  const root = await scratchRoot("governance-worktree-");
  const outside = await scratchRoot("governance-external-");
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync(
      "git",
      ["config", "remote.origin.url", "https://github.com/example/api"],
      { cwd: root },
    );
    execFileSync("git", ["config", "core.worktree", outside], { cwd: root });
    await writeFile(join(outside, "outside-canary"), "not observed");
    const i = await discoverLocal(root);
    assert.equal(i.complete, true);
    assert.equal(i.repositories[0].dirty, false, JSON.stringify(i));
    assert.equal(i.repositories[0].status.includes("outside-canary"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("A6 configured remote whitespace is not repaired by output trimming", async () => {
  const root = await scratchRoot("governance-remote-");
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync(
      "git",
      ["config", "remote.origin.url", "https://github.com/example/api "],
      { cwd: root },
    );
    assert.equal((await discoverLocal(root)).complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
