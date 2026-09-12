import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
  stat,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
// Resolved: the consumer scan root is handed to discoverLocal, which refuses a
// root with symlink ancestors, and macOS `tmpdir()` sits under /var -> /private/var.
const temp = await realpath(await mkdtemp(join(tmpdir(), "governance-consumer-")));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !k.toLowerCase().startsWith("npm_"),
  ),
);
const run = (bin, args, cwd = root) =>
  execFileSync(bin, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const meta = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(meta.private, true);
  assert.equal(meta.version, "0.1.0");
  for (const key of ["preinstall", "install", "postinstall", "prepare"])
    assert.equal(meta.scripts[key], undefined);
  assert.equal(meta.dependencies, undefined);
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
    "dist/report.js",
    "dist/report.d.ts",
    "dist/report-html.js",
    "schemas/manifest.schema.json",
    "examples/example.json",
    "README.md",
    "LICENSE",
  ])
    assert.ok(members.includes(f), f);
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
  assert.match(run(bin, ["--help"], consumer), /advisory/);
  assert.equal(run(bin, ["--version"], consumer).trim(), "0.1.0");
  const installed = join(
    consumer,
    "node_modules",
    "@crissmoldovan",
    "workspace-governance",
  );
  assert.equal((await stat(installed)).isSymbolicLink(), false);
  const manifest = join(installed, "examples", "example.json");
  assert.equal(
    JSON.parse(run(bin, ["validate", "--manifest", manifest], consumer)).valid,
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
  const plan = run(bin, ["plan", ...flags], consumer);
  assert.equal(JSON.parse(plan).entries[0].status, "missing-checkout");
  const report = JSON.parse(run(bin, ["report", ...flags], consumer));
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
        ["verify-plan", ...flags, "--plan", join(temp, "plan.json")],
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
console.log('isolated library resolution/discovery/plan/report OK');
`,
  );
  console.log(run(process.execPath, ["check.mjs"], consumer).trim());
  await writeFile(
    join(consumer, "check.ts"),
    `import {MemorySnapshotStore,loadSnapshot,resolvePolicy,createPlan,createReport,type Manifest,type Inventory,type SnapshotStore,type Report} from '@crissmoldovan/workspace-governance';
declare const m:Manifest;declare const i:Inventory;const store:SnapshotStore=new MemorySnapshotStore(m);const s=await loadSnapshot(store);const r=resolvePolicy(s,'repo','reader',{defaults:[{key:'x',merge:'replace',value:true}]});createPlan(s,i,'org','reader');const report:Report=createReport(s,i,'org','reader');console.log(r.values,report.summary);
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
    "A9 packed isolated CLI/library/declaration consumer PASS; packaged schema/example/license; no runtime dependencies",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
