import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
const manifest = {
  apiVersion: "workspace-governance/v1",
  authorityId: "report-authority",
  nodes: [
    { id: "person", kind: "user", slug: "criss", parentId: null, visibility: { mode: "public", readers: [] } },
    { id: "cue", kind: "organization", slug: "cueplusplus", parentId: "person" },
    { id: "project", kind: "project", slug: "platform", parentId: "cue" },
    { id: "repo", kind: "repository", slug: "app", parentId: "project", remote: "https://github.com/cueplusplus/app" },
  ],
  policies: [{ nodeId: "person", settings: [{ key: "git.pullRequest", merge: "replace", value: true }], constraints: [] }],
  workflows: [{ nodeId: "person", id: "feature", settings: [], constraints: [], steps: [
    { id: "test", action: "repository.test", inputs: {} },
  ] }],
  metadata: {},
};

async function withFixture(
  runTest: (manifestPath: string, scan: string) => void | Promise<void>,
  source: unknown = manifest,
) {
  const root = await mkdtemp(join(tmpdir(), "governance-report-cli-"));
  try {
    const manifestPath = join(root, "manifest.json");
    const scan = join(root, "scan");
    await writeFile(manifestPath, JSON.stringify(source));
    await mkdir(scan);
    await runTest(manifestPath, scan);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("report command emits one combined JSON view for a user scope", async () => {
  await withFixture((manifestPath, scan) => {
    const result = run(
      "report",
      "--manifest", manifestPath,
      "--node", "person",
      "--principal", "cristian",
      "--root", scan,
      "--workflow", "feature",
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.apiVersion, "workspace-governance/report-v1");
    assert.deepEqual(report.summary, {
      repositories: 1,
      present: 0,
      misplaced: 0,
      missingCheckout: 1,
      duplicate: 0,
      blocked: 0,
      needsAttention: 1,
      drift: true,
    });
    assert.equal(report.repositories[0].resolution.values["git.pullRequest"], true);
    assert.deepEqual(report.repositories[0].resolution.workflow.steps.map((step: { action: string }) => step.action), ["repository.test"]);
  });
});

test("report command emits a self-contained HTML view and escapes policy text", async () => {
  const source = structuredClone(manifest) as any;
  const policyText = "</script><img src=x onerror=alert(1)>";
  const workflowInput = "</code><script>alert(2)</script>";
  const constraintSource = 'project<&"';
  const principal = 'cristian<&"';
  source.nodes[2].id = constraintSource;
  source.nodes[3].parentId = constraintSource;
  source.policies[0].settings.push({
    key: "report.note",
    merge: "replace",
    value: policyText,
  });
  source.policies.push({
    nodeId: constraintSource,
    settings: [],
    constraints: [{
      id: 'note-required<&"',
      key: "report.note",
      operator: "equals",
      value: policyText,
    }],
  });
  source.workflows[0].steps[0] = {
    id: 'test-step<&"',
    action: 'repository.test<&"',
    inputs: { command: workflowInput },
  };
  await withFixture(async (manifestPath, scan) => {
    const checkout = join(scan, "cueplusplus", "platform", "app");
    await mkdir(checkout, { recursive: true });
    const initialized = spawnSync("git", ["init", "--quiet", checkout], { encoding: "utf8" });
    assert.equal(initialized.status, 0, initialized.stderr);
    const remote = spawnSync(
      "git",
      ["-C", checkout, "remote", "add", "origin", "https://github.com/cueplusplus/app"],
      { encoding: "utf8" },
    );
    assert.equal(remote.status, 0, remote.stderr);
    await writeFile(join(checkout, "dirty.txt"), "dirty\n");
    const result = run(
      "report",
      "--manifest", manifestPath,
      "--node", "person",
      "--principal", principal,
      "--root", scan,
      "--workflow", "feature",
      "--format", "html",
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^<!doctype html>/i);
    assert.match(result.stdout, /Workspace governance report/);
    assert.match(result.stdout, /cueplusplus/);
    assert.match(result.stdout, /Blocked/);
    assert.match(result.stdout, /Principal/);
    assert.match(result.stdout, /cristian&lt;&amp;&quot;/);
    assert.match(result.stdout, /Authorization/);
    assert.match(result.stdout, /advisory/);
    assert.match(result.stdout, /<strong>Dirty<\/strong> Yes/);
    assert.match(result.stdout, /Provenance/);
    assert.match(result.stdout, /Merge <code>replace<\/code>/);
    assert.match(result.stdout, /Resolved constraints/);
    assert.match(result.stdout, /note-required&lt;&amp;&quot;/);
    assert.match(result.stdout, /Operator <code>equals<\/code>/);
    assert.match(result.stdout, /Source <strong>project&lt;&amp;&quot;<\/strong>/);
    assert.match(result.stdout, /Step <code>test-step&lt;&amp;&quot;<\/code>/);
    assert.match(result.stdout, /Action <code>repository\.test&lt;&amp;&quot;<\/code>/);
    assert.match(result.stdout, /Inputs/);
    assert.equal(result.stdout.includes(policyText), false);
    assert.match(result.stdout, /&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(result.stdout.includes(workflowInput), false);
    assert.match(result.stdout, /&lt;\/code&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
    assert.doesNotMatch(result.stdout, /<script\b/i);
    assert.equal(result.stdout.includes("innerHTML"), false);
  }, source);
});

test("invalid report format is rejected before local discovery", {
  skip: process.platform === "win32",
}, async () => {
  await withFixture(async (manifestPath, scan) => {
    const bin = join(scan, "bin");
    const checkout = join(scan, "repository");
    const sentinel = join(scan, "git-ran");
    await mkdir(bin);
    await mkdir(join(checkout, ".git"), { recursive: true });
    await writeFile(join(bin, "git"), "#!/bin/sh\n: > \"$WG_SENTINEL\"\nexit 1\n", { mode: 0o755 });

    const result = spawnSync(process.execPath, [
      cli,
      "report",
      "--manifest", manifestPath,
      "--node", "person",
      "--principal", "cristian",
      "--root", scan,
      "--format", "xml",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        WG_SENTINEL: sentinel,
      },
    });

    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      error: { code: "INVALID", message: "Invalid input." },
    });
    await assert.rejects(access(sentinel), { code: "ENOENT" });
  });
});
