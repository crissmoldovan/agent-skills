import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createMcpFixture } from "./mcp-fixture.ts";

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

async function treeSnapshot(path: string, prefix = ""): Promise<unknown[]> {
  try {
    const entries: unknown[] = [];
    for (const name of (await readdir(path)).sort()) {
      const full = join(path, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const metadata = await lstat(full);
      if (metadata.isDirectory()) entries.push({ path: relativePath, type: "directory", mode: metadata.mode & 0o777 }, ...await treeSnapshot(full, relativePath));
      else if (metadata.isSymbolicLink()) entries.push({ path: relativePath, type: "symlink" });
      else entries.push({ path: relativePath, type: "file", mode: metadata.mode & 0o777, size: metadata.size, sha256: sha(await readFile(full)) });
    }
    return entries;
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function repackBundle(
  source: string,
  destination: string,
  mutate: (packageRoot: string, manifest: any) => Promise<void>,
  options: { refreshPackageJson?: boolean, tarTransform?: string } = {},
) {
  await cp(source, destination, { recursive: true });
  const manifestPath = join(destination, "runtime-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const archive = join(destination, manifest.archive.file);
  const extracted = join(destination, "extracted");
  await mkdir(extracted);
  const unpacked = spawnSync("tar", ["-xzf", archive, "-C", extracted], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const packageRoot = join(extracted, "package");
  const metadataPath = join(packageRoot, "package.json");

  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  metadata.version = "0.2.1";
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  manifest.package.version = "0.2.1";
  manifest.compatibility.packageVersion = "0.2.1";
  await mutate(packageRoot, manifest);

  if (options.refreshPackageJson !== false) {
    const bytes = await readFile(metadataPath);
    const metadataStat = await stat(metadataPath);
    const record = manifest.content.find((entry: any) => entry.path === "package/package.json");
    record.size = bytes.length;
    record.mode = metadataStat.mode & 0o777;
    record.sha256 = sha(bytes);
  }
  await rm(archive);
  const tarArgs = ["-czf", archive];
  if (options.tarTransform) tarArgs.push("--transform", options.tarTransform);
  const archiveEntries = (await treeSnapshot(extracted) as any[]).filter(entry => entry.type !== "directory").map(entry => entry.path);
  tarArgs.push("-C", extracted, ...archiveEntries);
  const packed = spawnSync("tar", tarArgs, { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const archiveBytes = await readFile(archive);
  manifest.archive.size = archiveBytes.length;
  manifest.archive.sha256 = sha(archiveBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(extracted, { recursive: true, force: true });
  return { anchor: sha(await readFile(manifestPath)), manifest, archive };
}

async function makeVersionBundle(source: string, destination: string, version: "0.2.1") {
  return repackBundle(source, destination, async (packageRoot, manifest) => {
    for (const relativePath of ["dist/cli.js", "dist/doctor.js"]) {
      const path = join(packageRoot, relativePath);
      const original = await readFile(path, "utf8");
      assert.match(original, /0\.2\.0/);
      await writeFile(path, original.replaceAll("0.2.0", version));
      const bytes = await readFile(path);
      const metadata = await stat(path);
      const record = manifest.content.find((entry: any) => entry.path === `package/${relativePath}`);
      record.size = bytes.length;
      record.mode = metadata.mode & 0o777;
      record.sha256 = sha(bytes);
    }
  });
}

async function consumeManagedLaunchers(bins: string, configPath: string, expectedVersion: string) {
  const cli = join(bins, "workspacectl");
  const mcp = join(bins, "workspacectl-mcp");
  const version = spawnSync(cli, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), expectedVersion);
  const transport = new StdioClientTransport({ command: mcp, args: ["--config", configPath], stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: "managed-version-consumer", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, expectedVersion);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === "workspace_list"));
    const listed = await client.callTool({ name: "workspace_list", arguments: { view: "catalog" } });
    assert.notEqual(listed.isError, true);
    assert.equal((listed.structuredContent as any).counts.total, 1);
  } finally {
    await client.close();
  }
  assert.equal(stderr, "");
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

test("P24 integrity matrix refuses anchored metadata and content mismatches while preserving the prior install", async () => {
  const f = await fixture();
  try {
    const installArgs = ["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    assert.equal(run(installArgs).status, 0);
    const before = { root: await treeSnapshot(f.root), bins: await treeSnapshot(f.bins) };
    const marker = join(f.scratch, "lifecycle-script-ran");
    const cases: Array<{ name: string, bundle: string, anchor: string, expected: RegExp }> = [];

    async function variant(name: string, expected: RegExp, mutate: (packageRoot: string, manifest: any) => Promise<void>, options = {}) {
      const bundle = join(f.scratch, `variant-${name}`);
      const result = await repackBundle(f.bundle, bundle, mutate, options);
      cases.push({ name, bundle, anchor: result.anchor, expected });
      return result;
    }

    await variant("unexpected-script", /archive package metadata differs/, async packageRoot => {
      const path = join(packageRoot, "package.json");
      const metadata = JSON.parse(await readFile(path, "utf8"));
      metadata.scripts = { ...(metadata.scripts ?? {}), postinstall: `node -e \"require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\"` };
      await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
    });
    await variant("wrong-name", /archive package metadata differs/, async packageRoot => {
      const path = join(packageRoot, "package.json");
      const metadata = JSON.parse(await readFile(path, "utf8"));
      metadata.name = "@attacker/replacement";
      await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
    });
    await variant("wrong-version", /archive package metadata differs/, async packageRoot => {
      const path = join(packageRoot, "package.json");
      const metadata = JSON.parse(await readFile(path, "utf8"));
      metadata.version = "9.9.9";
      await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
    });
    await variant("wrong-bin", /archive package metadata differs/, async packageRoot => {
      const path = join(packageRoot, "package.json");
      const metadata = JSON.parse(await readFile(path, "utf8"));
      metadata.bin.workspacectl = "dist/mcp-cli.js";
      await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
    });
    await variant("content-digest", /archive content bytes, sizes, or modes differ/, async packageRoot => {
      const path = join(packageRoot, "dist", "cli.js");
      await writeFile(path, `${await readFile(path, "utf8")}\n// unmanifested replacement\n`);
    });
    await variant("content-mode", /archive content bytes, sizes, or modes differ/, async packageRoot => {
      await chmod(join(packageRoot, "dist", "cli.js"), 0o755);
    });
    await variant("symlink", /unsafe path or link/, async packageRoot => {
      await symlink("/tmp", join(packageRoot, "escape-link"));
    });
    await variant("hardlink", /unsafe path or link/, async packageRoot => {
      await link(join(packageRoot, "package.json"), join(packageRoot, "escape-hardlink"));
    });
    await variant("traversal", /unsafe path or link/, async () => {}, { tarTransform: "s#^package/package.json$#package/../../escape#" });
    await variant("invalid-content-manifest", /content inventory is invalid/, async (_packageRoot, manifest) => {
      manifest.content.push({ ...manifest.content[0] });
    });

    await variant("partial-manifest", /manifest is invalid JSON/, async () => {});
    await writeFile(join(f.scratch, "variant-partial-manifest", "runtime-manifest.json"), "{\"schemaVersion\":1");
    cases.find(entry => entry.name === "partial-manifest")!.anchor = sha("{\"schemaVersion\":1");

    const missingManifest = await variant("missing-manifest", /manifest is missing/, async () => {});
    await rm(join(f.scratch, "variant-missing-manifest", "runtime-manifest.json"));
    cases.find(entry => entry.name === "missing-manifest")!.anchor = missingManifest.anchor;

    const missingArchive = await variant("missing-archive", /archive path is invalid/, async () => {});
    await rm(missingArchive.archive);
    const truncatedArchive = await variant("partial-archive", /archive digest or size differs/, async () => {});
    const archiveBytes = await readFile(truncatedArchive.archive);
    await writeFile(truncatedArchive.archive, archiveBytes.subarray(0, Math.floor(archiveBytes.length / 2)));
    const unanchored = await variant("unanchored-pair", /carried approved anchor/, async packageRoot => {
      await writeFile(join(packageRoot, "README.md"), "internally consistent alternate bytes\n");
    });
    const readme = unanchored.manifest.content.find((entry: any) => entry.path === "package/README.md");
    const alternateReadme = Buffer.from("internally consistent alternate bytes\n");
    readme.size = alternateReadme.length;
    readme.sha256 = sha(alternateReadme);
    await writeFile(join(f.scratch, "variant-unanchored-pair", "runtime-manifest.json"), `${JSON.stringify(unanchored.manifest, null, 2)}\n`);
    cases.find(entry => entry.name === "unanchored-pair")!.anchor = f.anchor;

    for (const entry of cases) {
      const refused = run(["update", "--bundle", entry.bundle, "--manifest-sha256", entry.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
      assert.notEqual(refused.status, 0, `${entry.name} unexpectedly installed: ${refused.stdout}`);
      assert.match(refused.stderr, entry.expected, `${entry.name} refused for the wrong boundary`);
      assert.deepEqual({ root: await treeSnapshot(f.root), bins: await treeSnapshot(f.bins) }, before, `${entry.name} changed the prior install`);
      await assert.rejects(lstat(marker), /ENOENT/, `${entry.name} executed a lifecycle script`);
    }
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("P26 updates and rolls back real different-version CLI and MCP consumers with coherent release identity", async () => {
  const f = await fixture();
  try {
    const governed = await createMcpFixture(join(f.scratch, "governed fixture"));
    const governedBefore = await governed.snapshot();
    const v2Bundle = join(f.scratch, "bundle-0.2.1");
    const v2 = await makeVersionBundle(f.bundle, v2Bundle, "0.2.1");
    assert.equal(run(["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]).status, 0);
    await consumeManagedLaunchers(f.bins, governed.configPath, "0.2.0");

    const updated = run(["update", "--bundle", v2Bundle, "--manifest-sha256", v2.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.equal(updated.status, 0, updated.stderr);
    await consumeManagedLaunchers(f.bins, governed.configPath, "0.2.1");
    let receipt = JSON.parse(await readFile(join(f.root, "manager-receipt.json"), "utf8"));
    assert.deepEqual(Object.keys(receipt.versions).sort(), ["0.2.0", "0.2.1"]);
    assert.equal(receipt.compatibility.packageVersion, "0.2.1");
    assert.equal(receipt.manifestSha256, v2.anchor);
    assert.equal(receipt.versions["0.2.1"].manifestSha256, v2.anchor);
    assert.equal(receipt.versions["0.2.0"].manifestSha256, f.anchor);

    // Synthetic identity only: this fixture tag is deliberately unpublished and does not claim release availability.
    receipt.versions["0.2.0"].release.tag = "workspace-governance-v0.2.0-fixture-unpublished";
    receipt.versions["0.2.0"].compatibility.skillRef = receipt.versions["0.2.0"].release.tag;
    receipt.versions["0.2.0"].compatibility.catalogVersion = "0.25.0";
    await writeFile(join(f.root, "manager-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });

    const rolledBack = run(["rollback", "--version", "0.2.0", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]);
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    const status = run(["status", "--root", f.root, "--bin-dir", f.bins, "--json"]);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).activeVersion, "0.2.0");
    await consumeManagedLaunchers(f.bins, governed.configPath, "0.2.0");
    receipt = JSON.parse(await readFile(join(f.root, "manager-receipt.json"), "utf8"));
    assert.equal(receipt.compatibility.packageVersion, "0.2.0");
    assert.equal(receipt.compatibility.skillRef, "workspace-governance-v0.2.0-fixture-unpublished");
    assert.equal(receipt.compatibility.catalogVersion, "0.25.0");
    assert.equal(receipt.release.tag, "workspace-governance-v0.2.0-fixture-unpublished");
    assert.equal(receipt.manifestSha256, f.anchor);
    assert.equal(receipt.archiveSha256, receipt.versions["0.2.0"].archiveSha256);
    assert.equal(await governed.snapshot(), governedBefore);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("P26 second-launcher switch failure restores the usable old version and removes private staging", async () => {
  const f = await fixture();
  try {
    const governed = await createMcpFixture(join(f.scratch, "governed"));
    const governedBefore = await governed.snapshot();
    const v2Bundle = join(f.scratch, "bundle-0.2.1");
    const v2 = await makeVersionBundle(f.bundle, v2Bundle, "0.2.1");
    assert.equal(run(["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]).status, 0);
    const receiptBefore = await readFile(join(f.root, "manager-receipt.json"));
    const failed = run(["update", "--bundle", v2Bundle, "--manifest-sha256", v2.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"], {
      WORKSPACECTL_TEST_FAIL_SWITCH: join(f.bins, "workspacectl-mcp"),
    });
    assert.equal(failed.status, 5, failed.stderr);
    assert.match(failed.stderr, /CONFLICT/);
    assert.deepEqual(await readFile(join(f.root, "manager-receipt.json")), receiptBefore);
    await assert.rejects(lstat(join(f.root, "versions", "0.2.1")), /ENOENT/);
    await consumeManagedLaunchers(f.bins, governed.configPath, "0.2.0");

    const receiptSwitchFailed = run(["update", "--bundle", v2Bundle, "--manifest-sha256", v2.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"], {
      WORKSPACECTL_TEST_FAIL_SWITCH: join(f.root, "manager-receipt.json"),
    });
    assert.equal(receiptSwitchFailed.status, 5, receiptSwitchFailed.stderr);
    assert.match(receiptSwitchFailed.stderr, /CONFLICT/);
    assert.deepEqual(await readFile(join(f.root, "manager-receipt.json")), receiptBefore);
    await assert.rejects(lstat(join(f.root, "versions", "0.2.1")), /ENOENT/);
    await consumeManagedLaunchers(f.bins, governed.configPath, "0.2.0");
    assert.equal(await governed.snapshot(), governedBefore);
    assert.deepEqual((await readdir(f.bins)).sort(), ["workspacectl", "workspacectl-mcp"]);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("P26 update refuses missing or corrupt receipts, modified versions, and concurrent launcher winners", async () => {
  const f = await fixture();
  try {
    const v2Bundle = join(f.scratch, "bundle-0.2.1");
    const v2 = await makeVersionBundle(f.bundle, v2Bundle, "0.2.1");
    const updateArgs = ["update", "--bundle", v2Bundle, "--manifest-sha256", v2.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"];
    assert.equal(run(["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]).status, 0);
    const receiptPath = join(f.root, "manager-receipt.json");
    const originalReceipt = await readFile(receiptPath);
    await rm(receiptPath);
    assert.equal(run(updateArgs).status, 5);
    assert.equal((await lstat(join(f.root, "versions", "0.2.0"))).isDirectory(), true);
    await writeFile(receiptPath, "not json\n", { mode: 0o600 });
    assert.equal(run(updateArgs).status, 5);
    await writeFile(receiptPath, originalReceipt, { mode: 0o600 });

    const receipt = JSON.parse(originalReceipt.toString("utf8"));
    const managedFile = join(receipt.versions["0.2.0"].root, receipt.versions["0.2.0"].files[0].relativePath);
    const managedBytes = await readFile(managedFile);
    await writeFile(managedFile, "modified\n");
    assert.equal(run(updateArgs).status, 5);
    assert.equal(await readFile(managedFile, "utf8"), "modified\n");
    await writeFile(managedFile, managedBytes);

    const racedPath = join(f.bins, "workspacectl-mcp");
    const cliBefore = await readFile(join(f.bins, "workspacectl"));
    const raced = run(updateArgs, { WORKSPACECTL_TEST_REPLACE_AFTER_UNLINK: racedPath });
    assert.equal(raced.status, 5);
    assert.equal(await readFile(racedPath, "utf8"), "concurrent replacement\n");
    assert.deepEqual(await readFile(join(f.bins, "workspacectl")), cliBefore);
    assert.deepEqual(await readFile(receiptPath), originalReceipt);
    await assert.rejects(lstat(join(f.root, "versions", "0.2.1")), /ENOENT/);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});

test("P26 rechecks receipt and managed payload ownership after staging and preserves rollback receipt winners", async () => {
  for (const boundary of ["receipt", "payload"] as const) {
    const f = await fixture();
    try {
      const v2Bundle = join(f.scratch, "bundle-0.2.1");
      const v2 = await makeVersionBundle(f.bundle, v2Bundle, "0.2.1");
      assert.equal(run(["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]).status, 0);
      const receiptPath = join(f.root, "manager-receipt.json");
      const receiptBefore = await readFile(receiptPath);
      const receipt = JSON.parse(receiptBefore.toString("utf8"));
      const managedPath = join(receipt.versions["0.2.0"].root, receipt.versions["0.2.0"].files[0].relativePath);
      const launchersBefore = await Promise.all(["workspacectl", "workspacectl-mcp"].map(name => readFile(join(f.bins, name))));
      const env: Record<string, string> = boundary === "receipt"
        ? { WORKSPACECTL_TEST_REPLACE_RECEIPT_AFTER_STAGE: receiptPath }
        : { WORKSPACECTL_TEST_MODIFY_MANAGED_AFTER_STAGE: managedPath };
      const refused = run(["update", "--bundle", v2Bundle, "--manifest-sha256", v2.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"], env);
      assert.equal(refused.status, 5, refused.stderr);
      assert.deepEqual(await Promise.all(["workspacectl", "workspacectl-mcp"].map(name => readFile(join(f.bins, name)))), launchersBefore);
      await assert.rejects(lstat(join(f.root, "versions", "0.2.1")), /ENOENT/);
      if (boundary === "receipt") assert.equal(await readFile(receiptPath, "utf8"), "concurrent receipt replacement\n");
      else { assert.deepEqual(await readFile(receiptPath), receiptBefore); assert.equal(await readFile(managedPath, "utf8"), "concurrent managed replacement\n"); }
      const cli = spawnSync(join(f.bins, "workspacectl"), ["--version"], { encoding: "utf8" });
      assert.equal(cli.stdout.trim(), "0.2.0");
    } finally { await rm(f.scratch, { recursive: true, force: true }); }
  }

  const f = await fixture();
  try {
    const v2Bundle = join(f.scratch, "bundle-0.2.1");
    const v2 = await makeVersionBundle(f.bundle, v2Bundle, "0.2.1");
    assert.equal(run(["install", "--bundle", f.bundle, "--manifest-sha256", f.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]).status, 0);
    assert.equal(run(["update", "--bundle", v2Bundle, "--manifest-sha256", v2.anchor, "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"]).status, 0);
    const receiptPath = join(f.root, "manager-receipt.json");
    const refused = run(["rollback", "--version", "0.2.0", "--root", f.root, "--bin-dir", f.bins, "--json", "--yes"], { WORKSPACECTL_TEST_REPLACE_BEFORE_UNLINK: receiptPath });
    assert.equal(refused.status, 5, refused.stderr);
    assert.equal(await readFile(receiptPath, "utf8"), "concurrent replacement\n");
    const cli = spawnSync(join(f.bins, "workspacectl"), ["--version"], { encoding: "utf8" });
    assert.equal(cli.stdout.trim(), "0.2.1");
    assert.equal((await lstat(join(f.root, "versions", "0.2.0"))).isDirectory(), true);
    assert.equal((await lstat(join(f.root, "versions", "0.2.1"))).isDirectory(), true);
  } finally { await rm(f.scratch, { recursive: true, force: true }); }
});
