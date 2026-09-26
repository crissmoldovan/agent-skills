import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const installer = join(root, "scripts", "install-runtime.mjs");
const carried = fileURLToPath(new URL("../../../skills/workspace-governance/scripts/install-runtime.mjs", import.meta.url));
const assembler = join(root, "scripts", "assemble-runtime-artifact.mjs");
const nodeBin = process.execPath;
const npmBin = join(process.execPath.slice(0, process.execPath.lastIndexOf("/")), "npm");
function sha(bytes: Buffer | string) { return createHash("sha256").update(bytes).digest("hex"); }
function run(args: string[], env: Record<string,string> = {}) {
  return spawnSync(nodeBin, [installer, ...args], { cwd: root, env: { ...process.env, WORKSPACECTL_INSTALL_NPM: npmBin, ...env }, encoding: "utf8" });
}
async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "workspacectl-lifecycle-"));
  const bundle = join(scratch, "bundle");
  const assembled = spawnSync(nodeBin, [assembler, "--output", bundle], { cwd: root, env: process.env, encoding: "utf8" });
  assert.equal(assembled.status, 0, assembled.stderr);
  const manifest = await readFile(join(bundle, "runtime-manifest.json"));
  return { scratch, bundle, anchor: sha(manifest), root: join(scratch, "managed"), bins: join(scratch, "bin") };
}

test("canonical bootstrap is carried byte-for-byte and preview is inert", async () => {
  assert.deepEqual(await readFile(carried), await readFile(installer));
  const f = await fixture();
  try {
    const preview = run(["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json"]);
    assert.equal(preview.status, 0, preview.stderr);
    const result = JSON.parse(preview.stdout);
    assert.equal(result.action, "install");
    assert.equal(result.applied, false);
    await assert.rejects(lstat(f.root), /ENOENT/);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("anchored offline install owns both launchers, no-ops, and removal preserves unrelated data", async () => {
  const f = await fixture();
  try {
    const sentinel = join(f.scratch, "shell-injection-sentinel");
    f.root = join(f.scratch, `managed $(touch ${sentinel}) $HOME`);
    await mkdir(join(f.scratch, "governed"));
    await writeFile(join(f.scratch, "governed", "catalog.json"), "sentinel");
    const args = ["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    const installed = run(args);
    assert.equal(installed.status, 0, installed.stderr);
    const receipt = JSON.parse(await readFile(join(f.root, "manager-receipt.json"), "utf8"));
    assert.equal((await stat(join(f.root, "manager-receipt.json"))).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(receipt.launchers).sort(), ["workspacectl", "workspacectl-mcp"]);
    assert.ok(receipt.versions["0.2.0"].files.length > 100);
    assert.match(receipt.versions["0.2.0"].treeSha256, /^[0-9a-f]{64}$/);
    for (const name of ["workspacectl", "workspacectl-mcp"]) {
      const p = join(f.bins, name);
      assert.equal((await stat(p)).mode & 0o111, 0o111);
      const invoked = spawnSync(p, name === "workspacectl" ? ["--version"] : [], { encoding: "utf8", timeout: 10000 });
      if (name === "workspacectl") assert.equal(invoked.stdout.trim(), "0.2.0");
      else { assert.equal(invoked.status, 2); assert.match(invoked.stderr, /Usage:/); }
    }
    await assert.rejects(lstat(sentinel), /ENOENT/);
    const noop = run(args);
    assert.equal(noop.status, 0, noop.stderr);
    assert.equal(JSON.parse(noop.stdout).noOp, true);

    const preview = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json"]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).applied, false);
    const removed = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.equal(removed.status, 0, removed.stderr);
    await assert.rejects(lstat(join(f.bins, "workspacectl")), /ENOENT/);
    assert.equal(await readFile(join(f.scratch, "governed", "catalog.json"), "utf8"), "sentinel");

    assert.equal(run(args).status, 0);
    const preserved = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--preserve-version", "0.2.0", "--json", "--yes"]);
    assert.equal(preserved.status, 0, preserved.stderr);
    assert.equal(JSON.parse(preserved.stdout).preservedVersion, "0.2.0");
    assert.equal(JSON.parse(await readFile(join(f.root, "backup-receipt.json"), "utf8")).preservedVersion, "0.2.0");
    assert.equal((await lstat(join(f.root, "versions", "0.2.0"))).isDirectory(), true);
    await assert.rejects(lstat(join(f.bins, "workspacectl-mcp")), /ENOENT/);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("a receipt digest cannot bless launcher bytes that disagree with the fixed template", async () => {
  const f = await fixture();
  try {
    const installArgs = ["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    assert.equal(run(installArgs).status, 0);
    const receiptPath = join(f.root, "manager-receipt.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const launcherPath = join(f.bins, "workspacectl");
    const replacement = "#!/bin/sh\necho unrelated-replacement\n";
    await writeFile(launcherPath, replacement, { mode: 0o755 });
    receipt.launchers.workspacectl.sha256 = sha(replacement);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    const receiptBefore = await readFile(receiptPath);
    const versionRoot = receipt.versions[receipt.activeVersion].root;
    const versionBefore = receipt.versions[receipt.activeVersion].treeSha256;

    const refused = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.equal(refused.status, 5);
    assert.match(refused.stderr, /UNMANAGED|CONFLICT/);
    assert.equal(await readFile(launcherPath, "utf8"), replacement);
    assert.deepEqual(await readFile(receiptPath), receiptBefore);
    assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).versions[receipt.activeVersion].treeSha256, versionBefore);
    assert.equal((await lstat(versionRoot)).isDirectory(), true);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("a launcher replacement created after quarantine prevents removal", async () => {
  const f = await fixture();
  try {
    const installArgs = ["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    assert.equal(run(installArgs).status, 0);
    const receiptPath = join(f.root, "manager-receipt.json");
    const receiptBefore = await readFile(receiptPath);
    const versionRoot = join(f.root, "versions", "0.2.0");
    const target = join(f.bins, "workspacectl-mcp");

    const refused = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"], { WORKSPACECTL_TEST_REPLACE_AFTER_UNLINK: target });
    assert.equal(refused.status, 5);
    assert.match(refused.stderr, /CONFLICT/);
    assert.equal(await readFile(target, "utf8"), "concurrent replacement\n");
    assert.deepEqual(await readFile(receiptPath), receiptBefore);
    assert.equal((await lstat(versionRoot)).isDirectory(), true);
    assert.equal((await lstat(join(f.bins, "workspacectl"))).isFile(), true);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("an external launcher switch during quarantine preserves the replacement and restores the first launcher", { skip: process.platform !== "linux" }, async () => {
  const f = await fixture();
  try {
    const installArgs = ["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    assert.equal(run(installArgs).status, 0);
    const first = join(f.bins, "workspacectl");
    const target = join(f.bins, "workspacectl-mcp");
    const receiptPath = join(f.root, "manager-receipt.json");
    const firstBefore = await readFile(first);
    const receiptBefore = await readFile(receiptPath);
    const marker = join(f.scratch, "rename-entered");
    const displaced = join(f.scratch, "owned-displaced");
    const source = join(f.scratch, "rename-delay.c");
    const interposer = join(f.scratch, "rename-delay.so");
    await writeFile(source, `#define _GNU_SOURCE\n#include <dlfcn.h>\n#include <fcntl.h>\n#include <stdlib.h>\n#include <string.h>\n#include <time.h>\n#include <unistd.h>\nstatic int (*real_rename)(const char *, const char *) = 0;\nstatic int target_renames = 0;\nint rename(const char *oldpath, const char *newpath) {\n  if (!real_rename) real_rename = dlsym(RTLD_NEXT, "rename");\n  const char *target = getenv("P28_RACE_TARGET"), *marker = getenv("P28_RACE_MARKER");\n  if (target && marker && strcmp(oldpath, target) == 0 && ++target_renames == 2) { int fd = open(marker, O_WRONLY | O_CREAT | O_TRUNC, 0600); if (fd >= 0) close(fd); struct timespec delay = { .tv_sec = 0, .tv_nsec = 700000000 }; nanosleep(&delay, 0); }\n  return real_rename(oldpath, newpath);\n}\n`);
    const compiled = spawnSync("gcc", ["-shared", "-fPIC", "-O2", "-Wall", "-Wextra", "-o", interposer, source, "-ldl"], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr);
    const racerCode = `import os, pathlib, sys, time\nt=pathlib.Path(sys.argv[1]); m=pathlib.Path(sys.argv[2]); d=pathlib.Path(sys.argv[3])\ndeadline=time.time()+20\nwhile not m.exists():\n    if time.time()>deadline: raise SystemExit(3)\n    time.sleep(0.001)\nos.rename(t,d)\nt.write_bytes(b"#!/bin/sh\\necho external-replacement\\n")\nt.chmod(0o755)\n`;
    const racer = spawn("/usr/bin/python3", ["-c", racerCode, target, marker, displaced], { stdio: ["ignore", "pipe", "pipe"] });
    let racerStderr = ""; racer.stderr.setEncoding("utf8"); racer.stderr.on("data", chunk => { racerStderr += chunk; });
    const refused = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"], { LD_PRELOAD: interposer, P28_RACE_TARGET: target, P28_RACE_MARKER: marker });
    const racerExit = await new Promise<number | null>((resolveExit, reject) => { racer.once("error", reject); racer.once("close", resolveExit); });

    assert.equal(racerExit, 0, racerStderr);
    assert.equal(refused.status, 5, refused.stderr);
    assert.match(refused.stderr, /CONFLICT/);
    assert.equal(await readFile(target, "utf8"), "#!/bin/sh\necho external-replacement\n");
    assert.deepEqual(await readFile(first), firstBefore);
    assert.deepEqual(await readFile(receiptPath), receiptBefore);
    assert.equal((await lstat(join(f.root, "versions", "0.2.0"))).isDirectory(), true);
    const privateDirs = (await readdir(f.bins)).filter(name => name.startsWith(".workspacectl-private-"));
    for (const name of privateDirs) assert.equal((await stat(join(f.bins, name))).mode & 0o777, 0o700);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("anchor, archive links, modified payload, and concurrent launcher replacement refuse without deletion", async () => {
  const f = await fixture();
  try {
    const badAnchor = run(["install", "--bundle", f.bundle, "--manifest-sha256", "0".repeat(64), "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.notEqual(badAnchor.status, 0);
    await assert.rejects(lstat(f.root), /ENOENT/);

    const args = ["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    assert.equal(run(args).status, 0);
    const receipt = JSON.parse(await readFile(join(f.root, "manager-receipt.json"), "utf8"));
    const first = receipt.versions["0.2.0"].files[0].relativePath;
    await writeFile(join(f.root, "versions", "0.2.0", first), "modified");
    const refused = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.notEqual(refused.status, 0);
    assert.equal(await readFile(join(f.root, "versions", "0.2.0", first), "utf8"), "modified");

    await writeFile(join(f.root, "versions", "0.2.0", first), await readFile(join(f.bundle, "runtime-manifest.json"))); // remains mismatched
    const replacement = "#!/bin/sh\necho replacement\n";
    await writeFile(join(f.bins, "workspacectl"), replacement, { mode: 0o755 });
    const conflict = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.notEqual(conflict.status, 0);
    assert.equal(await readFile(join(f.bins, "workspacectl"), "utf8"), replacement);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("between-check launcher replacement and injected receipt paths refuse safely", async () => {
  const f = await fixture();
  try {
    const args = ["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    assert.equal(run(args).status, 0);
    const cliLauncher = join(f.bins, "workspacectl");
    const launcher = join(f.bins, "workspacectl-mcp");
    const cliBefore = await readFile(cliLauncher, "utf8");
    const raced = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"], { WORKSPACECTL_TEST_REPLACE_BEFORE_UNLINK: launcher });
    assert.notEqual(raced.status, 0);
    assert.equal(await readFile(launcher, "utf8"), "concurrent replacement\n");
    assert.equal(await readFile(cliLauncher, "utf8"), cliBefore);
    const receiptPath = join(f.root, "manager-receipt.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.versions[receipt.activeVersion].root = join(f.scratch, "outside");
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    const injected = run(["remove", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.notEqual(injected.status, 0);
    assert.match(injected.stderr, /ownership escapes/);
    await rm(receiptPath);
    const missingReceipt = run(args);
    assert.notEqual(missingReceipt.status, 0);
    assert.match(missingReceipt.stderr, /occupied without a valid receipt/);
    assert.equal(await readFile(launcher, "utf8"), "concurrent replacement\n");
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});
