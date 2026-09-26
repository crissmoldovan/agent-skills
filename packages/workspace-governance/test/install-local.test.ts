import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("../scripts/install-local.sh", import.meta.url));

async function syntheticArchive(root: string): Promise<string> {
  const source = join(root, "candidate source");
  const artifacts = join(root, "packed artifacts");
  await mkdir(join(source, "dist"), { recursive: true });
  await mkdir(artifacts);
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "@crissmoldovan/workspace-governance",
      version: "0.2.0",
      private: true,
      type: "module",
      bin: { workspacectl: "dist/cli.js" },
      files: ["dist"],
    }),
  );
  await writeFile(
    join(source, "dist", "cli.js"),
    "#!/usr/bin/env node\nconsole.log(process.argv[2] === '--version' ? '0.2.0' : 'synthetic CLI');\n",
    { mode: 0o755 },
  );
  const packed = spawnSync("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    artifacts,
  ], { cwd: source, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  return join(artifacts, JSON.parse(packed.stdout)[0].filename);
}

test("local installer stops with an actionable error when Node is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl installer no node-"));
  try {
    const emptyPath = join(root, "empty path");
    await mkdir(emptyPath);
    const result = spawnSync("/bin/sh", [
      installer,
      "--archive",
      join(root, "candidate.tgz"),
      "--prefix",
      join(root, "versions", "0.2.0"),
      "--launcher",
      join(root, "bin", "workspacectl"),
    ], {
      encoding: "utf8",
      env: { HOME: root, PATH: emptyPath },
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Node\.js 24 or newer is required/);
    assert.match(result.stderr, /Install it separately/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local installer stops with an actionable error when Git is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl installer no git-"));
  try {
    const bin = join(root, "isolated bin");
    await mkdir(bin);
    await symlink(process.execPath, join(bin, "node"));
    const result = spawnSync("/bin/sh", [
      installer,
      "--archive",
      join(root, "candidate.tgz"),
      "--prefix",
      join(root, "versions", "0.2.0"),
      "--launcher",
      join(root, "bin", "workspacectl"),
    ], {
      encoding: "utf8",
      env: { HOME: root, PATH: bin },
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Git is required/);
    assert.match(result.stderr, /Install it separately/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local installer handles spaces and creates a versioned prefix plus stable launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl install with spaces-"));
  try {
    const archive = await syntheticArchive(root);
    const prefix = join(root, "local share", "workspacectl", "versions", "0.2.0");
    const launcher = join(root, "local bin", "workspacectl");
    const installed = spawnSync(installer, [
      "--archive",
      archive,
      "--prefix",
      prefix,
      "--launcher",
      launcher,
    ], { encoding: "utf8", env: process.env });
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(installed.stderr, "");
    assert.match(installed.stdout, /Installed workspacectl 0\.2\.0/);
    assert.match(installed.stdout, /No config, skill, credential, provider, or Hermes settings were changed/);
    assert.equal((await stat(launcher)).isFile(), true);
    const marker = JSON.parse(await readFile(join(prefix, ".workspacectl-install.json"), "utf8"));
    assert.equal(marker.package, "@crissmoldovan/workspace-governance");
    assert.equal(marker.version, "0.2.0");
    assert.equal(marker.prefix, prefix);
    assert.equal(marker.launcher, launcher);
    assert.equal(marker.runtime, process.execPath);
    const invoked = spawnSync(launcher, ["--version"], {
      encoding: "utf8",
      env: { HOME: root, PATH: join(root, "empty runtime path") },
    });
    assert.equal(invoked.status, 0, invoked.stderr);
    assert.equal(invoked.stdout.trim(), "0.2.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local installer replaces only an installer-managed regular launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl managed launcher-"));
  try {
    const archive = await syntheticArchive(root);
    const prefix = join(root, "versions", "0.2.0");
    const launcherDirectory = join(root, "bin");
    const launcher = join(launcherDirectory, "workspacectl");
    await mkdir(launcherDirectory);
    await writeFile(
      launcher,
      "#!/bin/sh\n# workspacectl-managed-launcher-v1\nexit 99\n",
      { mode: 0o700 },
    );
    const result = spawnSync(installer, [
      "--archive",
      archive,
      "--prefix",
      prefix,
      "--launcher",
      launcher,
    ], { encoding: "utf8", env: process.env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(await readFile(launcher, "utf8"), /^#!\/bin\/sh\n# workspacectl-managed-launcher-v1\n/);
    const invoked = spawnSync(launcher, ["--version"], { encoding: "utf8", env: process.env });
    assert.equal(invoked.status, 0, invoked.stderr);
    assert.equal(invoked.stdout.trim(), "0.2.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local installer refuses an unrelated occupied launcher before installing", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl occupied launcher-"));
  try {
    const archive = await syntheticArchive(root);
    const prefix = join(root, "versions", "0.2.0");
    const launcherDirectory = join(root, "bin");
    const launcher = join(launcherDirectory, "workspacectl");
    await mkdir(launcherDirectory);
    await writeFile(launcher, "foreign launcher\n", { mode: 0o700 });
    const result = spawnSync(installer, [
      "--archive",
      archive,
      "--prefix",
      prefix,
      "--launcher",
      launcher,
    ], { encoding: "utf8", env: process.env });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /launcher path is already occupied/i);
    assert.equal(await readFile(launcher, "utf8"), "foreign launcher\n");
    await assert.rejects(stat(prefix), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
