#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function fail(message) { throw new Error(message); }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!["--bundle", "--helper", "--output", "--npm", "--tar", "--git"].includes(flag) || !value) fail("usage: m4-consumer.mjs --bundle DIR --helper FILE --output FILE --npm FILE --tar FILE --git FILE");
    out[flag.slice(2)] = value;
  }
  for (const key of ["bundle", "helper", "output", "npm", "tar", "git"])
    if (!isAbsolute(out[key] ?? "")) fail(`${key} must be absolute`);
  return out;
}
async function snapshot(root, prefix = "") {
  const rows = [];
  for (const name of (await readdir(root)).sort()) {
    const full = join(root, name), path = prefix ? `${prefix}/${name}` : name;
    const meta = await lstat(full);
    if (meta.isDirectory()) rows.push({ path, type: "directory", mode: meta.mode & 0o777 }, ...await snapshot(full, path));
    else if (meta.isFile()) rows.push({ path, type: "file", mode: meta.mode & 0o777, size: meta.size, sha256: sha(await readFile(full)) });
    else rows.push({ path, type: "other" });
  }
  return rows;
}
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${basename(file)} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}
function jsonRun(file, args, options) { return JSON.parse(run(file, args, options).stdout); }
async function mcpSession(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", stderr = "", nextId = 1;
  const queue = [], waiters = [];
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  child.stdout.on("data", chunk => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail(`non-JSON MCP stdout: ${line}`); }
      const waiter = waiters.shift(); if (waiter) waiter(message); else queue.push(message);
    }
  });
  const receive = () => new Promise((accept, reject) => {
    const queued = queue.shift();
    if (queued) return accept(queued);
    const timer = setTimeout(() => reject(new Error("MCP response timeout")), 15000);
    waiters.push(message => { clearTimeout(timer); accept(message); });
  });
  const request = async (method, params) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const response = await receive();
    assert.equal(response.id, id);
    if (response.error) fail(`MCP ${method} error: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "p31-clean-consumer", version: "1.0.0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await request("tools/list", {});
    const called = await request("tools/call", { name: "workspace_list", arguments: { view: "catalog" } });
    return { initialized, listed, called, stderr };
  } finally {
    const exited = new Promise(resolveExit => child.once("exit", resolveExit));
    child.stdin.end();
    const delay = milliseconds => new Promise(resolveDelay => {
      const timer = setTimeout(resolveDelay, milliseconds);
      timer.unref?.();
    });
    await Promise.race([exited, delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited, delay(2000)]);
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const caseRoot = await realpath(await mkdtemp(join(tmpdir(), "M4 Consumer ")));
const home = join(caseRoot, "home");
const toolBin = join(caseRoot, "clean tools");
const managed = join(caseRoot, "runtime root");
const bins = join(caseRoot, "bin with spaces");
const governed = join(caseRoot, "governed data");
const config = join(governed, "config", "workspace.json");
const catalog = join(governed, "catalog", "catalog.json");
const state = join(governed, "state", "local-state.json");
const plans = join(governed, "plans");
const repository = join(governed, "repositories", "synthetic repo");
const result = { schemaVersion: 1, platform: process.platform, architecture: process.arch, caseRoot, sourceImports: [], commands: {}, hashes: {} };
try {
  await Promise.all([mkdir(home, { recursive: true }), mkdir(toolBin), mkdir(governed, { recursive: true })]);
  await Promise.all([mkdir(dirname(config), { recursive: true }), mkdir(dirname(catalog), { recursive: true }), mkdir(dirname(state), { recursive: true }), mkdir(plans), mkdir(repository, { recursive: true })]);
  await writeFile(join(repository, "README.md"), "synthetic clean consumer repository\n");
  const tools = { node: process.execPath, npm: await realpath(options.npm), tar: await realpath(options.tar), git: await realpath(options.git) };
  for (const [name, target] of Object.entries(tools)) {
    if (name === "tar") {
      const quote = value => `'${value.replaceAll("'", `'\\''`)}'`;
      await writeFile(join(toolBin, name), `#!/bin/sh\nPATH=${quote(`${dirname(target)}:/usr/bin:/bin`)} exec ${quote(target)} "$@"\n`, { mode: 0o755 });
      await chmod(join(toolBin, name), 0o755);
    } else await symlink(target, join(toolBin, name));
  }
  const cleanEnv = {
    HOME: home,
    PATH: `${toolBin}${delimiter}${bins}`,
    NODE_PATH: "",
    npm_config_cache: join(caseRoot, "empty npm cache"),
    npm_config_registry: "http://127.0.0.1:9/unreachable",
    npm_config_offline: "true",
    WORKSPACECTL_INSTALL_NPM: join(toolBin, "npm"),
  };
  await mkdir(cleanEnv.npm_config_cache);
  const harnessSource = await readFile(new URL(import.meta.url), "utf8");
  const helperSource = await readFile(options.helper, "utf8");
  const forbiddenSourceReferences = [
    ["packages", "workspace-governance"].join("/"),
    ["..", "src"].join("/"),
    ["", "dist", ""].join("/"),
  ];
  for (const [name, text] of [["harness", harnessSource], ["helper", helperSource]]) {
    for (const forbidden of forbiddenSourceReferences)
      if (text.includes(forbidden)) result.sourceImports.push({ name, forbidden });
  }
  assert.deepEqual(result.sourceImports, []);
  const manifestBytes = await readFile(join(options.bundle, "runtime-manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const manifestSha256 = sha(manifestBytes);
  const archive = join(options.bundle, manifest.archive.file);
  assert.equal(sha(await readFile(archive)), manifest.archive.sha256);
  result.prerequisites = {
    declared: manifest.prerequisites,
    node: run(join(toolBin, "node"), ["--version"], { env: cleanEnv }).stdout.trim(),
    npm: run(join(toolBin, "npm"), ["--version"], { env: cleanEnv }).stdout.trim(),
    tar: run(join(toolBin, "tar"), ["--version"], { env: cleanEnv }).stdout.split("\n")[0],
    git: run(join(toolBin, "git"), ["--version"], { env: cleanEnv }).stdout.trim(),
  };
  result.artifact = { manifestSha256, archiveSha256: manifest.archive.sha256, packageVersion: manifest.package.version };
  const helperArgs = [options.helper];
  result.commands.install = jsonRun(process.execPath, [...helperArgs, "install", "--bundle", options.bundle, "--manifest-sha256", manifestSha256, "--root", managed, "--bin-dir", bins, "--json", "--yes"], { cwd: caseRoot, env: cleanEnv });
  const cli = join(bins, "workspacectl"), mcp = join(bins, "workspacectl-mcp");
  result.commands.version = run(cli, ["--version"], { cwd: caseRoot, env: cleanEnv }).stdout.trim();
  run(join(toolBin, "git"), ["init", repository], { cwd: caseRoot, env: cleanEnv });
  run(join(toolBin, "git"), ["-C", repository, "remote", "add", "origin", "https://github.com/synthetic/p31-clean-consumer.git"], { cwd: caseRoot, env: cleanEnv });
  const preview = jsonRun(cli, ["init", "--config", config, "--catalog", catalog, "--state", state, "--plans-dir", plans, "--trusted-root", governed, "--plan", join(plans, "init.json"), "--json"], { cwd: caseRoot, env: cleanEnv });
  result.commands.init = preview;
  result.commands.apply = jsonRun(cli, ["apply", "--config", config, "--plan", join(plans, "init.json"), "--approve", preview.plan.id, "--json"], { cwd: caseRoot, env: cleanEnv });
  const draft = jsonRun(cli, ["config", "export", "--target", "catalog", "--config", config], { cwd: caseRoot, env: cleanEnv });
  draft.document.repositories.push({
    id: "repo-p31-clean-consumer",
    remote: "https://github.com/synthetic/p31-clean-consumer",
    sourceId: null,
    primaryGroupId: null,
    memberOf: [],
    aliases: ["p31-clean"],
    classification: "unclassified",
    metadata: { fixture: "P31 clean bundled consumer" },
  });
  const draftPath = join(governed, "catalog", "p31-draft.json");
  await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
  result.commands.validateCatalog = jsonRun(cli, ["config", "validate", draftPath, "--config", config, "--json"], { cwd: caseRoot, env: cleanEnv });
  const catalogPreview = jsonRun(cli, ["config", "plan", draftPath, "--config", config, "--plan", join(plans, "catalog.json"), "--json"], { cwd: caseRoot, env: cleanEnv });
  result.commands.catalogApply = jsonRun(cli, ["apply", "--config", config, "--plan", join(plans, "catalog.json"), "--approve", catalogPreview.plan.id, "--json"], { cwd: caseRoot, env: cleanEnv });
  const adoptPreview = jsonRun(cli, ["adopt", "--repo", "repo-p31-clean-consumer", "--path", repository, "--config", config, "--plan", join(plans, "adopt.json"), "--json"], { cwd: caseRoot, env: cleanEnv });
  result.commands.adopt = jsonRun(cli, ["apply", "--config", config, "--plan", join(plans, "adopt.json"), "--approve", adoptPreview.plan.id, "--json"], { cwd: caseRoot, env: cleanEnv });
  const workspaceId = result.commands.adopt.readback.localState.repositoryWorkspaces[0].id;
  const selectPreview = jsonRun(cli, ["workspace", "select-primary", "--repo", "repo-p31-clean-consumer", "--workspace", workspaceId, "--config", config, "--plan", join(plans, "select-primary.json"), "--json"], { cwd: caseRoot, env: cleanEnv });
  result.commands.selectPrimary = jsonRun(cli, ["apply", "--config", config, "--plan", join(plans, "select-primary.json"), "--approve", selectPreview.plan.id, "--json"], { cwd: caseRoot, env: cleanEnv });
  result.commands.doctor = jsonRun(cli, ["doctor", "--standalone", "--config", config, "--json"], { cwd: caseRoot, env: cleanEnv });
  result.commands.list = jsonRun(cli, ["list", "--config", config, "--json"], { cwd: caseRoot, env: cleanEnv });
  assert.equal(result.commands.list.counts.total, 1);
  assert.equal(result.commands.list.repositories[0].id, "repo-p31-clean-consumer");
  assert.equal(result.commands.list.repositories[0].remote, "https://github.com/synthetic/p31-clean-consumer");
  result.commands.where = jsonRun(cli, ["where", "repo-p31-clean-consumer", "--config", config, "--json"], { cwd: caseRoot, env: cleanEnv });
  assert.equal(result.commands.where.selectedWorkspace.path, repository);
  result.hashes.governedBefore = await snapshot(governed);
  result.commands.mcp = await mcpSession(mcp, ["--config", config], { cwd: caseRoot, env: cleanEnv });
  assert.equal(result.commands.mcp.stderr, "");
  assert.deepEqual(result.commands.mcp.listed.tools.map(tool => tool.name).sort(), ["workspace_context", "workspace_doctor", "workspace_explain", "workspace_list", "workspace_open", "workspace_operation", "workspace_where", "workspace_workflow"]);
  assert.equal(result.commands.mcp.called.isError, undefined);
  assert.equal(result.commands.mcp.called.structuredContent.counts.total, 1);
  assert.equal(result.commands.mcp.called.structuredContent.repositories[0].id, "repo-p31-clean-consumer");
  assert.equal(result.commands.mcp.called.structuredContent.repositories[0].remote, "https://github.com/synthetic/p31-clean-consumer");
  result.commands.status = jsonRun(process.execPath, [...helperArgs, "status", "--root", managed, "--bin-dir", bins, "--json"], { cwd: caseRoot, env: cleanEnv });
  result.commands.removePreview = jsonRun(process.execPath, [...helperArgs, "remove", "--root", managed, "--bin-dir", bins, "--json"], { cwd: caseRoot, env: cleanEnv });
  assert.equal(result.commands.removePreview.applied, false);
  result.commands.remove = jsonRun(process.execPath, [...helperArgs, "remove", "--root", managed, "--bin-dir", bins, "--json", "--yes"], { cwd: caseRoot, env: cleanEnv });
  result.hashes.governedAfter = await snapshot(governed);
  assert.deepEqual(result.hashes.governedAfter, result.hashes.governedBefore);
  assert.equal(existsSync(cli), false);
  assert.equal(existsSync(mcp), false);
  assert.equal(existsSync(join(managed, "versions", manifest.package.version)), false);
  result.removalReadback = { cliAbsent: true, mcpAbsent: true, packageAbsent: true, governedPreserved: true };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  result.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  await mkdir(dirname(options.output), { recursive: true }).catch(() => {});
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`).catch(() => {});
  throw error;
} finally {
  await rm(caseRoot, { recursive: true, force: true });
}
