#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const EXPECTED = Object.freeze({
  repository: "https://github.com/crissmoldovan/agent-skills",
  tag: "workspace-governance-v0.3.0",
  manifestAsset: "runtime-manifest.json",
  manifestSha256: "2c875a6f6c192d8e2555f48ed2d6c5e6628fc6938d39fc060f7e405a2e8d47af",
  package: "@crissmoldovan/workspace-governance",
  packageVersion: "0.3.0",
  catalogVersion: "0.26.0",
  skillsCliVersion: "1.7.0",
  agent: "hermes-agent",
});
const MAX_MANIFEST = 2 * 1024 * 1024;
const MAX_ARCHIVE = 128 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
class Refusal extends Error { constructor(code, message) { super(message); this.name = "Refusal"; this.code = code; } }
const refuse = (code, message) => { throw new Refusal(code, message); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const delay = ms => new Promise(resolveDelay => { const timer = setTimeout(resolveDelay, ms); timer.unref?.(); });

function parse(argv) {
  const values = {};
  const allowed = new Set(["--mode", "--repository", "--tag", "--manifest-sha256", "--bundle", "--skill-source", "--output", "--npx", "--npm", "--tar", "--git"]);
  while (argv.length) {
    const flag = argv.shift();
    if (!allowed.has(flag) || argv.length === 0) refuse("INVALID_ARGUMENT", `unknown or valueless argument: ${flag ?? "<missing>"}`);
    if (values[flag] !== undefined) refuse("INVALID_ARGUMENT", `duplicate argument: ${flag}`);
    values[flag] = argv.shift();
  }
  const mode = values["--mode"] ?? "release";
  if (!new Set(["release", "local-fixture"]).has(mode)) refuse("INVALID_ARGUMENT", "--mode must be release or local-fixture");
  const repository = values["--repository"] ?? EXPECTED.repository;
  const tag = values["--tag"] ?? EXPECTED.tag;
  const manifestSha256 = values["--manifest-sha256"] ?? EXPECTED.manifestSha256;
  if (repository !== EXPECTED.repository) refuse("INVALID_ARGUMENT", `--repository must be the reviewed official HTTPS repository ${EXPECTED.repository}`);
  let repositoryUrl; try { repositoryUrl = new URL(repository); } catch { refuse("INVALID_ARGUMENT", "--repository must be a valid URL"); }
  if (repositoryUrl.protocol !== "https:" || repositoryUrl.hostname !== "github.com") refuse("INVALID_ARGUMENT", "--repository must use the reviewed official HTTPS GitHub URL");
  if (!/^workspace-governance-v\d+\.\d+\.\d+$/.test(tag) || tag !== EXPECTED.tag) refuse("INVALID_ARGUMENT", `--tag must be the reviewed immutable tag ${EXPECTED.tag}`);
  if (!/^[0-9a-f]{64}$/.test(manifestSha256)) refuse("INVALID_ARGUMENT", "--manifest-sha256 must be a lowercase SHA-256 digest");
  if (manifestSha256 !== EXPECTED.manifestSha256) refuse("INVALID_ARGUMENT", `--manifest-sha256 must equal the carried reviewed anchor ${EXPECTED.manifestSha256}`);
  const absolute = name => {
    const value = values[name];
    if (value !== undefined && !isAbsolute(value)) refuse("INVALID_ARGUMENT", `${name} must be absolute`);
    return value;
  };
  const options = {
    mode, repository, tag, manifestSha256,
    bundle: absolute("--bundle"), skillSource: absolute("--skill-source"), output: absolute("--output"),
    npx: absolute("--npx") ?? "npx", npm: absolute("--npm") ?? "npm", tar: absolute("--tar") ?? "tar", git: absolute("--git") ?? "git",
  };
  if (mode === "release" && (options.bundle || options.skillSource)) refuse("INVALID_ARGUMENT", "release mode refuses local --bundle and --skill-source substitutes");
  if (mode === "local-fixture" && (!options.bundle || !options.skillSource)) refuse("INVALID_ARGUMENT", "local-fixture mode requires absolute --bundle and --skill-source");
  return options;
}

function run(command, args, options = {}) {
  const outcome = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000, ...options });
  if (outcome.error || outcome.status !== 0) refuse("COMMAND_FAILED", `${basename(command)} ${args.join(" ")} failed (${outcome.status ?? outcome.error?.code}): ${(outcome.stderr || outcome.stdout || outcome.error?.message || "").trim()}`);
  return outcome;
}
function jsonRun(command, args, options) {
  const outcome = run(command, args, options);
  try { return JSON.parse(outcome.stdout); } catch { refuse("INVALID_OUTPUT", `${basename(command)} did not return JSON: ${outcome.stdout.slice(0, 1000)}`); }
}
async function kind(path) { try { const s = await lstat(path); return s.isDirectory() ? "directory" : s.isFile() ? "file" : s.isSymbolicLink() ? "symlink" : "other"; } catch (error) { if (error?.code === "ENOENT") return "absent"; throw error; } }
async function inventory(root, prefix = "") {
  const rows = [];
  for (const name of (await readdir(root)).sort()) {
    if (name === "metadata.json" || name === "__pycache__") continue;
    const path = join(root, name), rel = prefix ? `${prefix}/${name}` : name, metadata = await lstat(path);
    if (metadata.isDirectory()) rows.push({ path: rel, type: "directory", mode: metadata.mode & 0o777 }, ...await inventory(path, rel));
    else if (metadata.isFile()) rows.push({ path: rel, type: "file", mode: metadata.mode & 0o777, size: metadata.size, sha256: sha256(await readFile(path)) });
    else if (metadata.isSymbolicLink()) rows.push({ path: rel, type: "symlink", target: await realpath(path) });
    else rows.push({ path: rel, type: "other" });
  }
  return rows;
}
async function treeFingerprint(root) {
  const rows = [];
  const walk = async directory => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name), name = relative(root, path).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) { rows.push(`L\0${name}\0${await readlink(path)}`); continue; }
      if (entry.isDirectory()) { rows.push(`D\0${name}`); await walk(path); continue; }
      if (!entry.isFile()) { rows.push(`O\0${name}`); continue; }
      const bytes = await readFile(path); rows.push(`F\0${name}\0${bytes.length}\0${sha256(bytes)}`);
    }
  };
  await walk(root);
  return sha256(Buffer.from(rows.join("\n")));
}
async function snapshot(paths) {
  const out = {};
  for (const [name, path] of Object.entries(paths)) out[name] = await kind(path) === "absent" ? null : await inventory(path);
  return out;
}
async function download(url, maximumBytes) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (current.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(current.hostname)) refuse("NETWORK_UNAVAILABLE", `download left approved HTTPS hosts: ${current.hostname}`);
    let response;
    try { response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "workspace-governance-release-consumer/0.3.0" } }); }
    catch (error) { refuse("NETWORK_UNAVAILABLE", `public release download failed: ${error.message}`); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) refuse("NETWORK_UNAVAILABLE", "public release download exceeded bounded redirect policy");
      current = new URL(location, current); continue;
    }
    if (!response.ok) refuse("PUBLIC_RELEASE_UNAVAILABLE", `public release asset ${url} returned HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximumBytes) refuse("INVALID_ARTIFACT", "public release asset exceeds size limit");
    if (!response.body) refuse("NETWORK_UNAVAILABLE", "public release response has no body");
    const chunks = []; let size = 0; const reader = response.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximumBytes) { await reader.cancel(); refuse("INVALID_ARTIFACT", "public release asset exceeds size limit"); } chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks, size);
  }
  refuse("NETWORK_UNAVAILABLE", "public release download exceeded bounded redirect policy");
}
function validateManifest(bytes, expectedAnchor) {
  if (sha256(bytes) !== expectedAnchor) refuse("ANCHOR_MISMATCH", "downloaded/runtime fixture manifest does not match the reviewed anchor");
  let manifest; try { manifest = JSON.parse(bytes); } catch { refuse("INVALID_ARTIFACT", "runtime manifest is not JSON"); }
  if (manifest?.schemaVersion !== 1 || manifest.artifactType !== "workspace-governance-offline-runtime" || manifest.package?.name !== EXPECTED.package || manifest.package?.version !== EXPECTED.packageVersion || manifest.package?.engines?.node !== ">=24.0.0" || manifest.compatibility?.packageVersion !== EXPECTED.packageVersion || manifest.compatibility?.skillRef !== EXPECTED.tag || manifest.compatibility?.catalogVersion !== EXPECTED.catalogVersion || manifest.release?.repository !== EXPECTED.repository || manifest.release?.tag !== EXPECTED.tag || manifest.release?.manifestAsset !== EXPECTED.manifestAsset || manifest.package?.lifecycleScripts?.length !== 0 || !/^[0-9a-f]{64}$/.test(manifest.archive?.sha256 ?? "") || !Number.isSafeInteger(manifest.archive?.size) || manifest.archive.size <= 0 || basename(manifest.archive?.file ?? "") !== manifest.archive?.file || !manifest.archive.file.endsWith(".tgz")) refuse("INVALID_ARTIFACT", "runtime manifest identity or safety contract differs");
  return manifest;
}
async function acquireBundle(options, root) {
  const bundle = join(root, "public release bundle"); await mkdir(bundle);
  if (options.mode === "local-fixture") {
    const manifestBytes = await readFile(join(options.bundle, EXPECTED.manifestAsset));
    const manifest = validateManifest(manifestBytes, options.manifestSha256);
    const archiveBytes = await readFile(join(options.bundle, manifest.archive.file));
    if (archiveBytes.length !== manifest.archive.size || sha256(archiveBytes) !== manifest.archive.sha256) refuse("INVALID_ARTIFACT", "local fixture archive bytes differ from anchored manifest");
    await writeFile(join(bundle, EXPECTED.manifestAsset), manifestBytes); await writeFile(join(bundle, manifest.archive.file), archiveBytes);
    return { bundle, manifest, manifestBytes, archiveBytes, transport: "local-fixture-prepublication" };
  }
  const base = `${options.repository}/releases/download/${options.tag}`;
  const manifestBytes = await download(`${base}/${EXPECTED.manifestAsset}`, MAX_MANIFEST);
  const manifest = validateManifest(manifestBytes, options.manifestSha256);
  const archiveBytes = await download(`${base}/${manifest.archive.file}`, MAX_ARCHIVE);
  if (archiveBytes.length !== manifest.archive.size || sha256(archiveBytes) !== manifest.archive.sha256) refuse("INVALID_ARTIFACT", "downloaded archive bytes differ from anchored manifest");
  await writeFile(join(bundle, EXPECTED.manifestAsset), manifestBytes); await writeFile(join(bundle, manifest.archive.file), archiveBytes);
  return { bundle, manifest, manifestBytes, archiveBytes, transport: "public-https-release" };
}
async function resolveTagCommit(options, env) {
  if (options.mode === "local-fixture") return { mode: "local-fixture", tag: options.tag, commit: null };
  const output = run(options.git, ["ls-remote", "--tags", `${options.repository}.git`, `refs/tags/${options.tag}`, `refs/tags/${options.tag}^{}`], { env }).stdout.trim().split("\n").filter(Boolean);
  const rows = output.map(line => line.split(/\s+/)).filter(parts => parts.length === 2 && /^[0-9a-f]{40}$/.test(parts[0]));
  const peeled = rows.find(([, ref]) => ref.endsWith("^{}"));
  const selected = peeled ?? rows.find(([, ref]) => ref === `refs/tags/${options.tag}`);
  if (!selected) refuse("INVALID_ARTIFACT", "public tag did not resolve to an immutable commit");
  return { mode: "public-tag", tag: options.tag, commit: selected[0], annotated: Boolean(peeled) };
}
async function expectedPublicSkillTree(options, root, tagReadback, env) {
  if (options.mode === "local-fixture") return inventory(join(options.skillSource, "skills", "workspace-governance"));
  const clone = join(root, "immutable public tag source");
  run(options.git, ["clone", "--quiet", "--filter=blob:none", "--no-checkout", `${options.repository}.git`, clone], { cwd: root, env });
  run(options.git, ["-C", clone, "sparse-checkout", "set", "skills/workspace-governance"], { cwd: root, env });
  run(options.git, ["-C", clone, "checkout", "--quiet", "--detach", tagReadback.commit], { cwd: root, env });
  const checkedOut = run(options.git, ["-C", clone, "rev-parse", "HEAD"], { cwd: root, env }).stdout.trim();
  if (checkedOut !== tagReadback.commit) refuse("READBACK_FAILED", "public skill source checkout did not resolve to the tag commit");
  return inventory(join(clone, "skills", "workspace-governance"));
}
function npxArgs(...skillsArgs) { return ["--yes", `skills@${EXPECTED.skillsCliVersion}`, ...skillsArgs]; }
function scopeArgs(scope) { return scope === "global" ? ["--global"] : []; }
function skillPath(root, scope) { return scope === "global" ? join(root, "home", ".hermes", "skills", "workspace-governance") : join(root, "project with spaces", ".hermes", "skills", "workspace-governance"); }
async function exerciseSkill(options, context, scope, action) {
  const source = options.mode === "release" ? `${options.repository}#${options.tag}` : options.skillSource;
  const common = { cwd: context.project, env: context.env };
  const discovery = run(options.npx, npxArgs("add", source, "--list"), common);
  if (!discovery.stdout.includes("workspace-governance")) refuse("INVALID_OUTPUT", "pinned Skills CLI discovery did not list workspace-governance");
  run(options.npx, npxArgs("add", source, "--skill", "workspace-governance", "--agent", EXPECTED.agent, "--copy", "--yes", ...scopeArgs(scope)), common);
  const installed = skillPath(context.root, scope);
  if (await kind(installed) !== "directory") refuse("READBACK_FAILED", `${scope} Hermes skill projection is absent after add`);
  const skillBytes = await readFile(join(installed, "SKILL.md"));
  const helper = join(installed, "scripts", "install-runtime.mjs");
  const helperBytes = await readFile(helper);
  if (!skillBytes.toString("utf8").includes("version: 0.3.0") || !helperBytes.toString("utf8").includes(options.manifestSha256) || !helperBytes.toString("utf8").includes(options.tag)) refuse("READBACK_FAILED", "installed skill/helper compatibility identity differs");
  const list = jsonRun(options.npx, npxArgs("list", "--agent", EXPECTED.agent, "--json", ...scopeArgs(scope)), common);
  const tree = await inventory(installed);
  assert.deepEqual(tree, context.expectedSkillTree, "Skills CLI installed bytes differ from exact immutable source skill tree");
  context.result.skills[action] = { scope, source, discovery: discovery.stdout, list, installedTree: tree, installedTreeSha256: sha256(Buffer.from(JSON.stringify(tree))), helperSha256: sha256(helperBytes), skillSha256: sha256(skillBytes) };
  return helper;
}
async function cliFirstGlobal(options, context) {
  const source = options.mode === "release" ? options.repository : options.skillSource;
  const ref = options.mode === "release" ? options.tag : `local-sha256:${await treeFingerprint(join(options.skillSource, "skills", "workspace-governance"))}`;
  const common = { cwd: context.project, env: context.env };
  const setup = jsonRun(context.cli, ["setup", "--install-skill", "--source", source, "--ref", ref, "--agent", EXPECTED.agent, "--scope", "global", "--yes", "--json"], common);
  if (setup.ok !== true || setup.action !== "add" || setup.scope !== "global" || setup.provenance?.source !== source || setup.provenance?.ref !== ref || !setup.projections?.every(projection => projection.readback === "matching")) refuse("READBACK_FAILED", `CLI-first global setup result differs: ${JSON.stringify(setup)}`);
  const list = jsonRun(options.npx, npxArgs("list", "--agent", EXPECTED.agent, "--json", "--global"), common);
  const installed = skillPath(context.root, "global"), tree = await inventory(installed);
  const listed = list.find?.(entry => entry.name === "workspace-governance" && entry.scope === "global");
  if (!listed) refuse("READBACK_FAILED", "Skills CLI global list did not read back CLI-first installation");
  assert.deepEqual(tree, context.expectedSkillTree, "CLI-first installed bytes differ from exact immutable source skill tree");
  context.result.skills.cliFirstGlobal = { scope: "global", source, ref, setup, list, installedTree: tree, installedTreeSha256: sha256(Buffer.from(JSON.stringify(tree))) };
}
async function removeCliFirstGlobal(options, context) {
  const prior = context.result.skills.cliFirstGlobal;
  const common = { cwd: context.project, env: context.env };
  const setup = jsonRun(context.cli, ["setup", "--remove-skill", "--source", prior.source, "--ref", prior.ref, "--agent", EXPECTED.agent, "--scope", "global", "--yes", "--json"], common);
  if (setup.ok !== true || setup.action !== "remove" || !setup.projections?.every(projection => projection.readback === "absent")) refuse("READBACK_FAILED", `CLI-first global removal result differs: ${JSON.stringify(setup)}`);
  const list = jsonRun(options.npx, npxArgs("list", "--agent", EXPECTED.agent, "--json", "--global"), common);
  if (list.some?.(entry => entry.name === "workspace-governance") || await kind(skillPath(context.root, "global")) !== "absent") refuse("READBACK_FAILED", "global skill remained after CLI-first remove");
  context.result.skills.cliFirstGlobal = { ...prior, removal: setup, removalList: list, removed: true };
}
async function removeSkill(options, context, scope, action) {
  const common = { cwd: context.project, env: context.env };
  run(options.npx, npxArgs("remove", "workspace-governance", "--agent", EXPECTED.agent, "--yes", ...scopeArgs(scope)), common);
  const absent = await kind(skillPath(context.root, scope)) === "absent";
  if (!absent) refuse("READBACK_FAILED", `${scope} skill remained after remove`);
  context.result.skills[action] = { ...context.result.skills[action], removed: absent };
}
export async function mcpCall(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", nextId = 1, fatalError = null, closed = false; const pending = new Map();
  const fail = error => { fatalError ??= error; for (const waiter of pending.values()) waiter.reject(fatalError); pending.clear(); };
  const exited = new Promise(resolveExit => child.once("close", (code, signal) => { closed = true; if (pending.size) fail(new Error(`MCP process closed before response (${code ?? signal})`)); resolveExit({ code, signal }); }));
  child.once("error", error => fail(new Error(`MCP process error: ${error.message}`)));
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf("\n"); if (newline < 0) break;
      const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1); if (!line.trim()) continue;
      let message; try { message = JSON.parse(line); } catch { fail(new Refusal("INVALID_OUTPUT", `non-JSON MCP stdout: ${line.slice(0, 1000)}`)); continue; }
      const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); waiter.resolve(message); }
    }
  });
  const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
    if (fatalError) { rejectRequest(fatalError); return; }
    const id = nextId++; const timer = setTimeout(() => { pending.delete(id); rejectRequest(new Error(`MCP ${method} timeout`)); }, 15_000);
    pending.set(id, { reject: error => { clearTimeout(timer); rejectRequest(error); }, resolve: message => { clearTimeout(timer); if (message.error) rejectRequest(new Error(JSON.stringify(message.error))); else resolveRequest(message.result); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, error => { if (error) fail(new Error(`MCP stdin error: ${error.message}`)); });
  });
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "p32-p36-release-consumer", version: "1.0.0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = await request("tools/list", {});
    const called = await request("tools/call", { name: "workspace_list", arguments: { view: "catalog" } });
    if (stdout.trim()) refuse("INVALID_OUTPUT", `non-JSON MCP stdout without framing terminator: ${stdout.slice(0, 1000)}`);
    if (called.isError === true || called.structuredContent?.counts?.total !== 1) refuse("READBACK_FAILED", "MCP workspace_list call returned unexpected readback");
    return { protocolHarness: "direct JSON-RPC stdio framing against the packaged MCP executable", initialized, toolNames: tools.tools.map(tool => tool.name).sort(), called, stderr };
  } finally {
    if (!child.stdin.destroyed) child.stdin.end();
    await Promise.race([exited, delay(2000)]);
    if (!closed) child.kill("SIGTERM");
    await Promise.race([exited, delay(2000)]);
    if (!closed) { child.kill("SIGKILL"); await exited; }
  }
}
async function configureAndExercise(context, options) {
  const { cli, mcp, config, catalog, state, plans, repo } = context;
  run(options.git, ["init", "-q", "-b", "main", repo], { cwd: context.root, env: context.env });
  run(options.git, ["-C", repo, "remote", "add", "origin", "https://github.com/synthetic/p32-p36-ephemeral.git"], { cwd: context.root, env: context.env });
  const preview = jsonRun(cli, ["init", "--config", config, "--catalog", catalog, "--state", state, "--plans-dir", plans, "--trusted-root", context.synthetic, "--plan", join(plans, "init.json"), "--json"], { cwd: context.root, env: context.env });
  jsonRun(cli, ["apply", "--config", config, "--plan", join(plans, "init.json"), "--approve", preview.plan.id, "--json"], { cwd: context.root, env: context.env });
  const draft = jsonRun(cli, ["config", "export", "--target", "catalog", "--config", config], { cwd: context.root, env: context.env });
  draft.document.repositories.push({ id: "repo-p32-p36", remote: "https://github.com/synthetic/p32-p36-ephemeral", sourceId: null, primaryGroupId: null, memberOf: [], aliases: ["release-consumer"], classification: "unclassified", metadata: { fixture: context.secondHost ? "ephemeral CI second host" : options.mode === "release" ? "published-source same-host verification" : "same-host local fixture" } });
  const draftPath = join(context.synthetic, "catalog-draft.json"); await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
  const catalogPreview = jsonRun(cli, ["config", "plan", draftPath, "--config", config, "--plan", join(plans, "catalog.json"), "--json"], { cwd: context.root, env: context.env });
  jsonRun(cli, ["apply", "--config", config, "--plan", join(plans, "catalog.json"), "--approve", catalogPreview.plan.id, "--json"], { cwd: context.root, env: context.env });
  const adoptPreview = jsonRun(cli, ["adopt", "--repo", "repo-p32-p36", "--path", repo, "--config", config, "--plan", join(plans, "adopt.json"), "--json"], { cwd: context.root, env: context.env });
  jsonRun(cli, ["apply", "--config", config, "--plan", join(plans, "adopt.json"), "--approve", adoptPreview.plan.id, "--json"], { cwd: context.root, env: context.env });
  const list = jsonRun(cli, ["list", "--config", config, "--json"], { cwd: context.root, env: context.env });
  const contextReadback = jsonRun(cli, ["context", "repo-p32-p36", "--config", config, "--json"], { cwd: context.root, env: context.env });
  if (list.counts?.total !== 1 || list.repositories?.[0]?.id !== "repo-p32-p36" || contextReadback.context?.repositoryId !== "repo-p32-p36") refuse("READBACK_FAILED", `CLI list/context exact readback differs: ${JSON.stringify({ list, contextReadback })}`);
  const mcpReadback = await mcpCall(mcp, ["--config", config], { cwd: context.root, env: context.env });
  return { version: run(cli, ["--version"], { cwd: context.root, env: context.env }).stdout.trim(), list, context: contextReadback, mcp: mcpReadback };
}
async function main(options) {
  const root = await realpath(await mkdtemp(join(tmpdir(), `workspace-governance-${options.mode}-`)));
  const home = join(root, "home"), project = join(root, "project with spaces"), managed = join(root, "managed runtime"), bin = join(root, "bin with spaces"), synthetic = join(root, "synthetic governed data"), plans = join(synthetic, "plans"), repo = join(synthetic, "repo"), config = join(synthetic, "config.json"), catalog = join(synthetic, "catalog.json"), state = join(synthetic, "state.json");
  const runnerIdentity = process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_NAME && process.env.RUNNER_OS && process.env.RUNNER_ARCH && process.env.GITHUB_RUN_ID ? { runnerName: process.env.RUNNER_NAME, runnerOs: process.env.RUNNER_OS, runnerArch: process.env.RUNNER_ARCH, githubRunId: process.env.GITHUB_RUN_ID } : null;
  const secondHost = options.mode === "release" && runnerIdentity !== null;
  const result = { schemaVersion: 1, evidenceClass: options.mode === "local-fixture" ? "same-host isolated local-fixture selftest; not public-release or second-host evidence" : secondHost ? "ephemeral CI second host public-release consumer" : "published-source same-host verification; not second-host evidence", mode: options.mode, platform: process.platform, architecture: process.arch, runnerIdentity, expected: EXPECTED, publicReleaseVerified: false, skills: {}, commands: {}, preservation: {} };
  try {
    await Promise.all([mkdir(home, { recursive: true }), mkdir(project, { recursive: true }), mkdir(bin), mkdir(plans, { recursive: true }), mkdir(repo, { recursive: true })]);
    const unrelatedProject = join(project, ".hermes", "skills", "unrelated", "SKILL.md"), unrelatedGlobal = join(home, ".hermes", "skills", "unrelated", "SKILL.md");
    await mkdir(dirname(unrelatedProject), { recursive: true }); await mkdir(dirname(unrelatedGlobal), { recursive: true });
    await writeFile(unrelatedProject, "---\nname: unrelated\n---\nproject sentinel\n"); await writeFile(unrelatedGlobal, "---\nname: unrelated\n---\nglobal sentinel\n");
    const emptyGitConfig = join(root, "empty.gitconfig"); await writeFile(emptyGitConfig, "");
    const env = { HOME: home, HERMES_HOME: join(home, ".hermes"), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, npm_config_cache: join(root, "npm cache"), DISABLE_TELEMETRY: "1", NO_COLOR: "1", CI: "true", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_TERMINAL_PROMPT: "0" };
    await mkdir(env.npm_config_cache);
    if (isAbsolute(options.npx)) await symlink(options.npx, join(bin, "npx"));
    const initialUnrelated = await snapshot({ projectUnrelated: dirname(unrelatedProject), globalUnrelated: dirname(unrelatedGlobal) });
    const acquired = await acquireBundle(options, root); const tagReadback = await resolveTagCommit(options, env);
    const expectedSkillTree = await expectedPublicSkillTree(options, root, tagReadback, env);
    result.release = { transport: acquired.transport, tagReadback, manifestSha256: sha256(acquired.manifestBytes), manifestSize: acquired.manifestBytes.length, archiveFile: acquired.manifest.archive.file, archiveSha256: sha256(acquired.archiveBytes), archiveSize: acquired.archiveBytes.length, manifestCompatibility: acquired.manifest.compatibility };
    result.publicReleaseVerified = options.mode === "release";
    const context = { root, home, project, managed, bin, synthetic, plans, repo, config, catalog, state, env, result, cli: join(bin, "workspacectl"), mcp: join(bin, "workspacectl-mcp"), expectedSkillTree, secondHost };
    const projectHelper = await exerciseSkill(options, context, "project", "skillFirstProject");
    const carriedHelper = join(root, "carried install-runtime.mjs");
    const carriedHelperBytes = await readFile(projectHelper);
    await writeFile(carriedHelper, carriedHelperBytes, { mode: 0o700 });
    result.carriedHelper = { source: "installed project skill", sha256: sha256(carriedHelperBytes) };
    const helperArgs = [carriedHelper, "install", "--root", managed, "--bin-dir", bin, "--json", "--yes"];
    if (options.mode === "local-fixture") helperArgs.push("--bundle", acquired.bundle, "--manifest-sha256", options.manifestSha256);
    result.commands.runtimeInstall = jsonRun(process.execPath, helperArgs, { cwd: project, env: { ...env, WORKSPACECTL_INSTALL_NPM: options.npm, WORKSPACECTL_INSTALL_TAR: options.tar } });
    if (run(context.cli, ["--version"], { cwd: root, env }).stdout.trim() !== EXPECTED.packageVersion) refuse("READBACK_FAILED", "installed runtime version differs");
    await removeSkill(options, context, "project", "skillFirstProject");
    if (run(context.cli, ["--version"], { cwd: root, env }).stdout.trim() !== EXPECTED.packageVersion) refuse("READBACK_FAILED", "project skill removal cascaded into runtime");
    await cliFirstGlobal(options, context);
    result.commands.consumer = await configureAndExercise(context, options);
    const receipt = JSON.parse(await readFile(join(managed, "manager-receipt.json"), "utf8"));
    if (receipt.manifestSha256 !== options.manifestSha256 || receipt.archiveSha256 !== acquired.manifest.archive.sha256 || receipt.release?.tag !== options.tag || receipt.compatibility?.runtimeManifestSha256 !== options.manifestSha256) refuse("READBACK_FAILED", "runtime receipt exact provenance differs");
    result.runtimeReadback = { receipt, receiptSha256: sha256(await readFile(join(managed, "manager-receipt.json"))) };
    await removeCliFirstGlobal(options, context);
    if (run(context.cli, ["--version"], { cwd: root, env }).stdout.trim() !== EXPECTED.packageVersion) refuse("READBACK_FAILED", "global skill removal cascaded into runtime");
    const governedBeforeRuntimeRemoval = await snapshot({ synthetic });
    result.commands.runtimeRemove = jsonRun(process.execPath, [carriedHelper, "remove", "--root", managed, "--bin-dir", bin, "--json", "--yes"], { cwd: project, env: { ...env, WORKSPACECTL_INSTALL_NPM: options.npm, WORKSPACECTL_INSTALL_TAR: options.tar } });
    const finalUnrelated = await snapshot({ projectUnrelated: dirname(unrelatedProject), globalUnrelated: dirname(unrelatedGlobal) });
    const governedAfterRuntimeRemoval = await snapshot({ synthetic });
    assert.deepEqual(finalUnrelated, initialUnrelated, "unrelated skills changed"); assert.deepEqual(governedAfterRuntimeRemoval, governedBeforeRuntimeRemoval, "synthetic config/repository changed during removals");
    if (existsSync(context.cli) || existsSync(context.mcp) || existsSync(join(managed, "versions", EXPECTED.packageVersion))) refuse("READBACK_FAILED", "runtime owned paths remain after remove");
    result.preservation = { unrelatedSkillsPreserved: true, syntheticConfigAndRepositoryPreserved: true, governedSnapshotIncludesGit: true, runtimeRemoved: true, projectSkillRemoved: true, globalSkillRemoved: true, governedSnapshot: governedAfterRuntimeRemoval.synthetic };
    result.passed = true;
    if (options.output) { await mkdir(dirname(options.output), { recursive: true }); await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`); }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    result.passed = false; result.error = { code: error.code ?? "UNEXPECTED", name: error.name, message: error.message };
    if (options.output) { await mkdir(dirname(options.output), { recursive: true }).catch(() => {}); await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`).catch(() => {}); }
    throw error;
  } finally { await rm(root, { recursive: true, force: true }); }
}

function isEntrypoint() {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync.native(process.argv[1])).href; }
  catch { return false; }
}
if (isEntrypoint()) {
  let options;
  try { options = parse(process.argv.slice(2)); await main(options); }
  catch (error) { process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? "UNEXPECTED", name: error.name, message: error.message } })}\n`); process.exitCode = 1; }
}
