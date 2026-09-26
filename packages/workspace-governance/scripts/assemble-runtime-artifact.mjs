#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(packageRoot, "../..");
const compatibleSkillRef = "workspace-governance-v0.3.0";
const releaseRepository = "https://github.com/crissmoldovan/agent-skills";
const catalogVersion = "0.26.0";
const lifecycleNames = ["preinstall", "install", "postinstall", "prepare"];

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout;
}

function inside(parent, target) {
  const fromParent = relative(parent, target);
  return fromParent === "" || (!fromParent.startsWith(`..${sep}`) && fromParent !== ".." && !isAbsolute(fromParent));
}

async function inventory(directory, prefix = "") {
  const records = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) fail(`archive contains a link: ${relativePath}`);
    if (metadata.isDirectory()) records.push(...await inventory(path, relativePath));
    else if (metadata.isFile()) {
      records.push({
        path: relativePath,
        mode: metadata.mode & 0o777,
        size: metadata.size,
        sha256: sha256(await readFile(path)),
      });
    } else fail(`archive contains an unsupported entry: ${relativePath}`);
  }
  return records;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    fail("usage: assemble-runtime-artifact.mjs --output ABSOLUTE_NEW_DIRECTORY");
  }
  if (!isAbsolute(args[1])) fail("output must be an absolute path");

  const requestedOutput = resolve(args[1]);
  const parent = dirname(requestedOutput);
  let realParent;
  try {
    realParent = await realpath(parent);
  } catch {
    fail("output parent must already exist");
  }
  const output = join(realParent, basename(requestedOutput));
  const realRepository = await realpath(repositoryRoot);
  if (inside(realRepository, output)) fail("output must be outside the repository");
  if (existsSync(output)) fail(`output already exists: ${output}`);

  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const lockBytes = await readFile(join(packageRoot, "package-lock.json"));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  if (metadata.name !== lock.name || metadata.version !== lock.version) fail("package and lock identities differ");
  if (metadata.engines?.node !== ">=24.0.0") fail("runtime artifact requires package engines.node >=24.0.0");
  const lifecycleScripts = lifecycleNames.filter(name => metadata.scripts?.[name] !== undefined);
  if (lifecycleScripts.length > 0) fail(`package has lifecycle scripts: ${lifecycleScripts.join(", ")}`);

  const dependencies = Object.keys(metadata.dependencies ?? {}).sort();
  const bundled = [...(metadata.bundleDependencies ?? metadata.bundledDependencies ?? [])].sort();
  if (JSON.stringify(bundled) !== JSON.stringify(dependencies)) {
    fail("bundleDependencies must equal the complete direct production dependency set");
  }
  const productionClosure = dependencies.map(name => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || entry.dev === true || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
      fail(`lockfile lacks a production identity/integrity for ${name}`);
    }
    return { name, version: entry.version, integrity: entry.integrity, direct: true };
  });

  const work = await mkdtemp(join(realParent, ".workspacectl-runtime-assembly-"));
  const stagedOutput = join(work, "artifact");
  const extracted = join(work, "extracted");
  let outputCreated = false;
  try {
    await mkdir(stagedOutput, { mode: 0o700 });
    await mkdir(extracted, { mode: 0o700 });
    run("npm", ["run", "build", "--ignore-scripts"]);
    const packedResult = JSON.parse(run("npm", [
      "pack", "--ignore-scripts", "--json", "--pack-destination", stagedOutput,
    ]));
    if (!Array.isArray(packedResult) || packedResult.length !== 1) fail("npm pack returned an unexpected result");
    const packed = packedResult[0];
    if (packed.name !== metadata.name || packed.version !== metadata.version) fail("packed package identity differs from metadata");
    const packedBundled = [...(packed.bundled ?? [])].sort();
    if (JSON.stringify(packedBundled) !== JSON.stringify(bundled)) fail("packed archive does not contain the complete production closure");
    const archivePath = join(stagedOutput, packed.filename);
    const archiveBytes = await readFile(archivePath);

    const listed = run("tar", ["-tzf", archivePath]).split("\n").filter(Boolean);
    if (listed.length === 0) fail("packed archive is empty");
    for (const member of listed) {
      if (member.startsWith("/") || member.split("/").includes("..") || !(member === "package" || member.startsWith("package/"))) {
        fail(`unsafe packed archive member: ${member}`);
      }
    }
    run("tar", ["-xzf", archivePath, "-C", extracted]);
    const content = await inventory(extracted);
    if (!content.some(entry => entry.path === "package/dist/cli.js") ||
        !content.some(entry => entry.path === "package/dist/mcp-cli.js")) {
      fail("packed archive lacks required CLI bins");
    }
    for (const name of bundled) {
      const packagePath = `package/node_modules/${name}/package.json`;
      if (!content.some(entry => entry.path === packagePath)) fail(`packed archive lacks bundled dependency ${name}`);
    }

    await copyFile(join(packageRoot, "package-lock.json"), join(stagedOutput, "package-lock.json"));
    const bins = Object.fromEntries(Object.entries(metadata.bin ?? {}).sort().map(([name, path]) => [name, String(path).replace(/^\.\//, "")]));
    const manifest = {
      schemaVersion: 1,
      artifactType: "workspace-governance-offline-runtime",
      package: {
        name: metadata.name,
        version: metadata.version,
        engines: { node: metadata.engines.node },
        bins,
        lifecycleScripts,
      },
      compatibility: {
        packageVersion: metadata.version,
        skillRef: compatibleSkillRef,
        catalogVersion,
      },
      release: {
        repository: releaseRepository,
        tag: compatibleSkillRef,
        manifestAsset: "runtime-manifest.json",
      },
      prerequisites: {
        node: metadata.engines.node,
        npm: true,
        posixTar: true,
      },
      archive: {
        file: packed.filename,
        size: archiveBytes.length,
        sha256: sha256(archiveBytes),
        npmShasum: packed.shasum,
        npmIntegrity: packed.integrity,
        bundledDependencies: bundled,
      },
      packageLock: {
        file: "package-lock.json",
        sha256: sha256(lockBytes),
      },
      productionClosure,
      content,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(stagedOutput, "runtime-manifest.json"), manifestBytes, { mode: 0o600 });
    await writeFile(
      join(stagedOutput, "runtime-manifest.sha256"),
      `${sha256(manifestBytes)}  runtime-manifest.json\n`,
      { mode: 0o600 },
    );

    await mkdir(output, { mode: 0o700 });
    outputCreated = true;
    for (const name of await readdir(stagedOutput)) await rename(join(stagedOutput, name), join(output, name));
    process.stdout.write(`${JSON.stringify({ output, archive: manifest.archive, manifestSha256: sha256(manifestBytes) }, null, 2)}\n`);
  } catch (error) {
    if (outputCreated) await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`assemble-runtime-artifact: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
