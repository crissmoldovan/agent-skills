import test from "node:test";
import assert from "node:assert/strict";
import {
  writeFile,
  mkdir,
  rm,
  readFile,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { example, scratchRoot } from "./fixtures.ts";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
test("A8 CLI JSON outputs, strict flags, exit codes, reobserve verify and no writes", async () => {
  const root = await scratchRoot("governance-cli-");
  try {
    const manifest = join(root, "manifest.json");
    await writeFile(manifest, JSON.stringify(example()));
    const scan = join(root, "scan");
    await mkdir(scan);
    const prefixed = example();
    prefixed.nodes[2].id = "--repo";
    const prefixedFile = join(root, "prefixed.json");
    await writeFile(prefixedFile, JSON.stringify(prefixed));
    assert.equal(
      run(
        "explain",
        "--manifest",
        prefixedFile,
        "--node",
        "--repo",
        "--principal",
        "reader",
      ).status,
      0,
    );
    const common = [
      "--manifest",
      manifest,
      "--node",
      "org",
      "--principal",
      "reader",
      "--root",
      scan,
    ];
    assert.match(run("--help").stdout, /advisory/);
    assert.equal(run("--version").stdout.trim(), "0.1.0");
    assert.equal(run("validate", "--manifest", manifest).status, 0);
    assert.equal(
      JSON.parse(
        run("catalog", "--manifest", manifest, "--principal", "reader").stdout,
      ).nodes.length,
      3,
    );
    assert.equal(
      JSON.parse(
        run(
          "explain",
          "--manifest",
          manifest,
          "--node",
          "repo",
          "--principal",
          "reader",
        ).stdout,
      ).authorization,
      "advisory",
    );
    const planned = run("plan", ...common);
    assert.equal(planned.status, 0, planned.stderr);
    const plan = JSON.parse(planned.stdout);
    assert.equal(plan.entries[0].status, "missing-checkout");
    const audit = run("audit", ...common);
    assert.equal(audit.status, 3);
    assert.equal(JSON.parse(audit.stdout).drift, true);
    const planFile = join(root, "plan.json");
    await writeFile(planFile, planned.stdout);
    assert.equal(run("verify-plan", ...common, "--plan", planFile).status, 0);
    plan.extra = true;
    await writeFile(planFile, JSON.stringify(plan));
    assert.equal(run("verify-plan", ...common, "--plan", planFile).status, 3);
    for (const args of [
      ["apply"],
      ["plan", ...common, "--human"],
      ["validate", "--manifest", manifest, "--manifest", manifest],
      [
        "explain",
        "--manifest",
        manifest,
        "--node",
        "unknown",
        "--principal",
        "reader",
      ],
      [
        "workflow",
        "--manifest",
        manifest,
        "--node",
        "repo",
        "--principal",
        "reader",
        "--workflow",
        "missing",
      ],
    ]) {
      const result = run(...args);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.deepEqual(Object.keys(JSON.parse(result.stderr)), ["error"]);
      assert.equal(result.stderr.includes(root), false);
    }
    await mkdir(join(scan, "child"));
    const incomplete = run("plan", ...common, "--depth", "0");
    assert.equal(incomplete.status, 3);
    assert.equal(incomplete.stdout, "");
    assert.equal(JSON.parse(incomplete.stderr).error.code, "INCOMPLETE");
    assert.deepEqual(await readdir(scan), ["child"]);
    assert.equal(await readFile(manifest, "utf8"), JSON.stringify(example()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
