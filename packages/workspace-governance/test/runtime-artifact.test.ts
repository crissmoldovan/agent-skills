import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = fileURLToPath(new URL("..", import.meta.url));
const assembler = join(root, "scripts", "assemble-runtime-artifact.mjs");
const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

function run(args: string[]) {
  return spawnSync(process.execPath, [assembler, ...args], {
    cwd: root,
    env: { ...process.env },
    encoding: "utf8",
  });
}

test("runtime artifact assembler requires a new absolute output outside the repository", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "workspacectl-artifact-boundary-"));
  try {
    const relative = run(["--output", "relative-output"]);
    assert.notEqual(relative.status, 0);
    assert.match(relative.stderr, /absolute/i);

    const inside = run(["--output", join(root, "artifact-output")]);
    assert.notEqual(inside.status, 0);
    assert.match(inside.stderr, /outside the repository/i);

    const occupied = join(scratch, "occupied");
    await mkdir(occupied);
    const existing = run(["--output", occupied]);
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /already exists/i);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("assembler emits a bundled runtime and strict content manifest", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "workspacectl-artifact-assembly-"));
  const output = join(scratch, "runtime artifact");
  try {
    const assembled = run(["--output", output]);
    assert.equal(assembled.status, 0, assembled.stderr);
    const files = (await readdir(output)).sort();
    const archiveName = files.find(name => name.endsWith(".tgz"));
    assert.ok(archiveName);
    assert.deepEqual(files, [
      archiveName,
      "package-lock.json",
      "runtime-manifest.json",
      "runtime-manifest.sha256",
    ].sort());

    const manifestBytes = await readFile(join(output, "runtime-manifest.json"));
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    assert.deepEqual(Object.keys(manifest).sort(), [
      "archive", "artifactType", "compatibility", "content", "package", "packageLock",
      "prerequisites", "productionClosure", "release", "schemaVersion",
    ]);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.artifactType, "workspace-governance-offline-runtime");
    assert.deepEqual(manifest.package, {
      name: packageMetadata.name,
      version: packageMetadata.version,
      engines: packageMetadata.engines,
      bins: Object.fromEntries(Object.entries(packageMetadata.bin).map(([name, path]) => [name, String(path).replace(/^\.\//, "")])),
      lifecycleScripts: [],
    });
    assert.deepEqual(manifest.compatibility, {
      packageVersion: packageMetadata.version,
      skillRef: "workspace-governance-v0.3.0",
      catalogVersion: "0.26.0",
    });
    assert.deepEqual(manifest.release, {
      repository: "https://github.com/crissmoldovan/agent-skills",
      tag: "workspace-governance-v0.3.0",
      manifestAsset: "runtime-manifest.json",
    });
    assert.deepEqual(manifest.prerequisites, {
      node: packageMetadata.engines.node,
      npm: true,
      posixTar: true,
    });
    assert.deepEqual(
      manifest.productionClosure.map((entry: { name: string }) => entry.name),
      ["@modelcontextprotocol/core", "@modelcontextprotocol/server", "yaml", "zod"],
    );
    for (const dependency of manifest.productionClosure) {
      assert.deepEqual(Object.keys(dependency).sort(), ["direct", "integrity", "name", "version"]);
      assert.equal(dependency.direct, true);
      assert.match(dependency.integrity, /^sha512-/);
    }
    assert.deepEqual(Object.keys(manifest.archive).sort(), [
      "bundledDependencies", "file", "npmIntegrity", "npmShasum", "sha256", "size",
    ]);
    assert.deepEqual(manifest.archive.bundledDependencies, manifest.productionClosure.map((entry: { name: string }) => entry.name));
    const archiveBytes = await readFile(join(output, archiveName));
    assert.equal(manifest.archive.file, archiveName);
    assert.equal(manifest.archive.size, archiveBytes.length);
    assert.equal(manifest.archive.sha256, createHash("sha256").update(archiveBytes).digest("hex"));
    assert.match(manifest.archive.npmIntegrity, /^sha512-/);
    assert.match(manifest.archive.npmShasum, /^[0-9a-f]{40}$/);

    assert.deepEqual(Object.keys(manifest.packageLock).sort(), ["file", "sha256"]);
    assert.equal(manifest.packageLock.file, "package-lock.json");
    assert.equal(
      manifest.packageLock.sha256,
      createHash("sha256").update(await readFile(join(output, "package-lock.json"))).digest("hex"),
    );
    assert.ok(manifest.content.length > 100);
    for (const entry of manifest.content) {
      assert.deepEqual(Object.keys(entry).sort(), ["mode", "path", "sha256", "size"]);
      assert.match(entry.path, /^package\//);
      assert.equal(entry.path.includes(".."), false);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    }
    assert.ok(manifest.content.some((entry: { path: string }) => entry.path === "package/dist/cli.js"));
    assert.ok(manifest.content.some((entry: { path: string }) => entry.path === "package/node_modules/zod/package.json"));
    assert.equal(JSON.stringify(manifest).includes("sourceCommit"), false);
    assert.equal(JSON.stringify(manifest).includes(root), false);

    const digest = (await readFile(join(output, "runtime-manifest.sha256"), "utf8")).trim();
    assert.equal(digest, `${createHash("sha256").update(manifestBytes).digest("hex")}  runtime-manifest.json`);
    assert.equal(basename(output), "runtime artifact");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("offline empty-cache consumer runs both bins and an official MCP doctor call", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "workspacectl-offline-consumer-")));
  const artifact = join(scratch, "artifact");
  const consumer = join(scratch, "consumer");
  const cache = join(scratch, "empty npm cache");
  try {
    const assembled = run(["--output", artifact]);
    assert.equal(assembled.status, 0, assembled.stderr);
    const archive = join(artifact, (await readdir(artifact)).find(name => name.endsWith(".tgz"))!);
    await mkdir(consumer);
    await mkdir(cache);
    assert.deepEqual(await readdir(cache), []);
    await writeFile(join(consumer, "package.json"), `${JSON.stringify({ name: "offline-runtime-consumer", private: true })}\n`);

    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
      value !== undefined && !key.toLowerCase().startsWith("npm_") &&
      !["NODE_PATH", "WORKSPACECTL_CONFIG", "WORKSPACECTL_SKILL", "WORKSPACECTL_INSTALL_PREFIX", "WORKSPACECTL_LAUNCHER", "WORKSPACECTL_RUNTIME_PATH"].includes(key),
    )) as Record<string, string>;
    cleanEnv.HOME = join(scratch, "home");
    cleanEnv.XDG_CONFIG_HOME = join(scratch, "xdg config");
    cleanEnv.XDG_STATE_HOME = join(scratch, "xdg state");
    cleanEnv.npm_config_registry = "http://127.0.0.1:9/unreachable";
    cleanEnv.npm_config_cache = cache;

    const installed = spawnSync("npm", [
      "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache,
      "--registry", cleanEnv.npm_config_registry, archive,
    ], { cwd: consumer, env: cleanEnv, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
    await rm(artifact, { recursive: true, force: true });

    const packagePath = join(consumer, "node_modules", "@crissmoldovan", "workspace-governance");
    assert.equal((await lstat(packagePath)).isSymbolicLink(), false);
    for (const dependency of ["@modelcontextprotocol/core", "@modelcontextprotocol/server", "yaml", "zod"]) {
      const dependencyPath = join(packagePath, "node_modules", ...dependency.split("/"), "package.json");
      assert.ok((await realpath(dependencyPath)).startsWith(`${packagePath}/`));
    }
    const cli = join(consumer, "node_modules", ".bin", "workspacectl");
    const mcp = join(consumer, "node_modules", ".bin", "workspacectl-mcp");
    assert.ok((await realpath(cli)).startsWith(`${packagePath}/`));
    assert.ok((await realpath(mcp)).startsWith(`${packagePath}/`));

    const execute = (file: string, args: string[]) => spawnSync(file, args, {
      cwd: consumer, env: cleanEnv, encoding: "utf8",
    });
    const version = execute(cli, ["--version"]);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), packageMetadata.version);
    const directRegistrationRun = execute(cli, [
      "mcp", "config", "--client", "generic", "--destination", join(scratch, "generic registration.json"),
      "--config", join(scratch, "future config.json"), "--json",
    ]);
    assert.equal(directRegistrationRun.status, 0, directRegistrationRun.stderr);
    const directRegistration = JSON.parse(directRegistrationRun.stdout);
    assert.equal(directRegistration.command, join(packagePath, "dist", "mcp-cli.js"));
    assert.deepEqual(directRegistration.args, ["--config", join(scratch, "future config.json")]);
    const help = execute(cli, ["--help"]);
    assert.equal(help.status, 0, help.stderr);
    const escapedVersion = packageMetadata.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(help.stdout, new RegExp(`^workspacectl ${escapedVersion}`, "m"));

    const config = join(scratch, "synthetic config.json");
    const catalog = join(scratch, "synthetic catalog.json");
    const state = join(scratch, "synthetic state.json");
    const plans = join(scratch, "synthetic plans");
    const trusted = join(scratch, "synthetic trusted");
    await Promise.all([mkdir(plans), mkdir(trusted), mkdir(cleanEnv.HOME), mkdir(cleanEnv.XDG_CONFIG_HOME), mkdir(cleanEnv.XDG_STATE_HOME)]);
    const preview = execute(cli, [
      "init", "--config", config, "--catalog", catalog, "--state", state,
      "--plans-dir", plans, "--trusted-root", trusted, "--plan", join(plans, "init.json"), "--json",
    ]);
    assert.equal(preview.status, 0, preview.stderr);
    const plan = JSON.parse(preview.stdout);
    const applied = execute(cli, [
      "apply", "--config", config, "--plan", join(plans, "init.json"), "--approve", plan.plan.id, "--json",
    ]);
    assert.equal(applied.status, 0, applied.stderr);

    const transport = new StdioClientTransport({ command: mcp, args: ["--config", config], cwd: consumer, env: cleanEnv, stderr: "pipe" });
    let stderr = "";
    transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    const client = new Client(
      { name: "offline-runtime-consumer", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion()?.name, "workspace-governance");
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === "workspace_doctor"));
      const doctor = await client.callTool({ name: "workspace_doctor", arguments: {} });
      assert.notEqual(doctor.isError, true);
      assert.equal((doctor.structuredContent as any).checks.find((check: any) => check.id === "runtime").status, "pass");
    } finally {
      await client.close();
    }
    assert.equal(stderr, "");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
