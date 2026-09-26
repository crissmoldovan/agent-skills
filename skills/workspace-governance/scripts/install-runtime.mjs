#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { access, chmod, copyFile, lstat, link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PACKAGE = "@crissmoldovan/workspace-governance";
const RECEIPT = "manager-receipt.json";
const REPOSITORY = "https://github.com/crissmoldovan/agent-skills";
const RELEASE_TAG = "workspace-governance-v0.3.0";
const MANIFEST_ASSET = "runtime-manifest.json";
const CATALOG_VERSION = "0.26.0";
// Replaced only after the stable 0.3.0 runtime is assembled. The runtime archive
// does not contain this helper, so embedding its digest cannot create a cycle.
const CARRIED_MANIFEST_SHA256 = "b0060938c279a74b249e67ab8c26a8fa83848b0e25f406e0747bcde3ca72a246";
const BINS = ["workspacectl", "workspacectl-mcp"];
const BIN_ENTRIES = { workspacectl: "dist/cli.js", "workspacectl-mcp": "dist/mcp-cli.js" };
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "preprepare", "postprepare", "prepublish", "prepublishOnly", "prepack", "postpack", "dependencies"];
class Refusal extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new Refusal(code, message); };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function inside(parent, target) { const r = relative(parent, target); return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r)); }
async function kind(path) { try { const s = await lstat(path); return s.isSymbolicLink() ? "symlink" : s.isFile() ? "file" : s.isDirectory() ? "directory" : "other"; } catch (e) { if (e?.code === "ENOENT") return "absent"; throw e; } }
async function refuseSymlinkAncestors(path) { let cursor = resolve(path), parts = []; while (cursor !== dirname(cursor)) { parts.push(cursor); cursor = dirname(cursor); } for (const candidate of parts.reverse()) if (await kind(candidate) === "symlink") fail("CONFLICT", `selected path has a symlinked ancestor: ${candidate}`); }
function run(command, args, options = {}) { const r = spawnSync(command, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, ...options }); if (r.error || r.status !== 0) fail("UNAVAILABLE", `${basename(command)} failed: ${r.error?.message ?? r.stderr ?? r.stdout}`.trim()); return r.stdout; }
function parse(argv) {
  const action = argv.shift();
  if (!["status", "plan", "install", "update", "rollback", "remove"].includes(action)) fail("INVALID_ARGUMENT", "action must be status, plan, install, update, rollback, or remove");
  const o = { action, yes: false, json: false };
  while (argv.length) { const flag = argv.shift(); if (flag === "--yes") o.yes = true; else if (flag === "--json") o.json = true; else { const value = argv.shift(); if (!value || !["--bundle", "--manifest-sha256", "--root", "--bin-dir", "--version", "--preserve-version"].includes(flag)) fail("INVALID_ARGUMENT", `invalid argument ${flag}`); if (o[flag.slice(2).replaceAll("-", "_")] !== undefined) fail("INVALID_ARGUMENT", `duplicate ${flag}`); o[flag.slice(2).replaceAll("-", "_")] = value; } }
  for (const key of ["root", "bin_dir"]) if (!o[key] || !isAbsolute(o[key])) fail("INVALID_ARGUMENT", `--${key.replaceAll("_", "-")} must be an absolute path`);
  if (["plan", "install", "update"].includes(action)) { if (o.bundle && !isAbsolute(o.bundle)) fail("INVALID_ARGUMENT", "--bundle must be an absolute path"); if (!o.bundle && o.manifest_sha256 !== undefined && o.manifest_sha256 !== CARRIED_MANIFEST_SHA256) fail("INVALID_ARGUMENT", "the pinned public release must use the carried manifest anchor; --manifest-sha256 override is only for an explicit local --bundle"); o.manifest_sha256 ??= CARRIED_MANIFEST_SHA256; if (!/^[0-9a-f]{64}$/.test(o.manifest_sha256 ?? "")) fail("INVALID_ARGUMENT", "--manifest-sha256 must be the approved lowercase SHA-256 anchor"); }
  return o;
}

export async function fetchReleaseAsset(url, maximumBytes) {
  const allowed = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (current.protocol !== "https:" || !allowed.has(current.hostname)) fail("NETWORK_UNAVAILABLE", `release redirect left the approved HTTPS hosts: ${current.hostname}`);
    let response;
    try { response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "workspacectl-bootstrap/0.3.0" } }); }
    catch (error) { fail("NETWORK_UNAVAILABLE", `pinned release download failed; use --bundle ABSOLUTE_DIRECTORY for offline installation (${error instanceof Error ? error.message : String(error)})`); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) fail("NETWORK_UNAVAILABLE", "pinned release download exceeded the bounded redirect policy");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) fail("NETWORK_UNAVAILABLE", `pinned release download failed with HTTP ${response.status}; use --bundle ABSOLUTE_DIRECTORY for offline installation`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximumBytes) fail("INVALID_ARTIFACT", "release asset exceeds the bootstrap size limit");
    if (!response.body) fail("NETWORK_UNAVAILABLE", "release asset response has no body");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        fail("INVALID_ARTIFACT", "release asset exceeds the bootstrap size limit");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  }
  fail("NETWORK_UNAVAILABLE", "pinned release download exceeded the bounded redirect policy");
}

async function downloadPinnedBundle(anchor) {
  const bundle = await mkdtemp(join(tmpdir(), "workspacectl-pinned-release-"));
  const base = `${REPOSITORY}/releases/download/${RELEASE_TAG}`;
  try {
    const manifestBytes = await fetchReleaseAsset(`${base}/${MANIFEST_ASSET}`, 2 * 1024 * 1024);
    if (sha(manifestBytes) !== anchor) fail("ANCHOR_MISMATCH", "downloaded release manifest does not match the carried approved anchor");
    let manifest; try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { fail("INVALID_ARTIFACT", "downloaded release manifest is invalid JSON"); }
    const archiveName = manifest?.archive?.file;
    if (typeof archiveName !== "string" || basename(archiveName) !== archiveName || !archiveName.endsWith(".tgz")) fail("INVALID_ARTIFACT", "downloaded release manifest archive path is invalid");
    await writeFile(join(bundle, MANIFEST_ASSET), manifestBytes, { mode: 0o600 });
    await writeFile(join(bundle, archiveName), await fetchReleaseAsset(`${base}/${archiveName}`, 128 * 1024 * 1024), { mode: 0o600 });
    return bundle;
  } catch (error) {
    if (!(error instanceof Refusal)) await rm(bundle, { recursive: true, force: true });
    if (error instanceof Refusal) { await rm(bundle, { recursive: true, force: true }); throw error; }
    fail("NETWORK_UNAVAILABLE", `pinned release download failed; use --bundle ABSOLUTE_DIRECTORY for offline installation (${error instanceof Error ? error.message : String(error)})`);
  }
}
async function inventory(root, prefix = "") {
  const out = [];
  for (const name of (await readdir(root)).sort()) { const p = join(root, name); const rel = prefix ? `${prefix}/${name}` : name; const s = await lstat(p); if (s.isSymbolicLink()) fail("MODIFIED", `managed payload contains a link: ${rel}`); if (s.isDirectory()) out.push(...await inventory(p, rel)); else if (s.isFile()) out.push({ relativePath: rel, type: "file", mode: s.mode & 0o777, size: s.size, sha256: sha(await readFile(p)) }); else fail("MODIFIED", `unsupported managed payload: ${rel}`); }
  return out;
}
function treeDigest(files) { return sha(Buffer.from(files.map(x => `${x.relativePath}\0${x.type}\0${x.mode}\0${x.size}\0${x.sha256}\n`).join(""))); }
async function loadReceipt(root, binDir) {
  const p = join(root, RECEIPT); if (await kind(p) !== "file") fail("UNMANAGED", "private manager receipt is missing or not a regular file");
  const receiptStat = await lstat(p); if ((receiptStat.mode & 0o777) !== 0o600 || (typeof process.getuid === "function" && receiptStat.uid !== process.getuid())) fail("UNMANAGED", "private manager receipt permissions or owner are invalid");
  let r, receiptBytes; try { receiptBytes = await readFile(p); r = JSON.parse(receiptBytes.toString("utf8")); } catch { fail("UNMANAGED", "private manager receipt is corrupt"); }
  if (r?.schemaVersion !== 2 || r.package !== PACKAGE || !/^\d+\.\d+\.\d+$/.test(r.activeVersion ?? "") || !r.versions || Array.isArray(r.versions) || !r.versions[r.activeVersion] || !r.launchers || Array.isArray(r.launchers) || r.runtime !== process.execPath || r.release?.repository !== REPOSITORY || !/^workspace-governance-v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(r.release?.tag ?? "") || r.release?.manifestAsset !== MANIFEST_ASSET || !/^[0-9a-f]{64}$/.test(r.manifestSha256 ?? "") || !/^[0-9a-f]{64}$/.test(r.archiveSha256 ?? "")) fail("UNMANAGED", "private manager receipt is invalid");
  for (const [version, record] of Object.entries(r.versions)) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || record?.version !== version || record.root !== join(root, "versions", version) || !Array.isArray(record.files) || !/^[0-9a-f]{64}$/.test(record.treeSha256 ?? "")) fail("UNMANAGED", "receipt version ownership escapes the managed root");
    if (!/^[0-9a-f]{64}$/.test(record.manifestSha256 ?? "") || !/^[0-9a-f]{64}$/.test(record.archiveSha256 ?? "") || record.release?.repository !== REPOSITORY || !/^workspace-governance-v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(record.release?.tag ?? "") || record.release?.manifestAsset !== MANIFEST_ASSET || record.compatibility?.packageVersion !== version || record.compatibility?.skillRef !== record.release.tag || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(record.compatibility?.catalogVersion ?? "") || record.compatibility?.runtimeManifestSha256 !== record.manifestSha256) fail("UNMANAGED", "receipt version release identity is invalid");
  }
  if (!Array.isArray(r.retainedVersions) || r.retainedVersions.some((version, i) => !r.versions[version] || version === r.activeVersion || r.retainedVersions.indexOf(version) !== i)) fail("UNMANAGED", "receipt retained versions are invalid");
  const active = r.versions[r.activeVersion];
  if (r.manifestSha256 !== active.manifestSha256 || r.archiveSha256 !== active.archiveSha256 || !same(r.release, active.release) || !same(r.compatibility, active.compatibility)) fail("UNMANAGED", "receipt active release identity is invalid");
  if (Object.keys(r.launchers).sort().join("\0") !== [...BINS].sort().join("\0")) fail("UNMANAGED", "receipt launcher set is invalid");
  for (const name of BINS) {
    const launcher = r.launchers[name];
    const expectedPath = binDir ? join(binDir, name) : launcher?.path;
    const cli = join(root, "versions", r.activeVersion, "lib", "node_modules", "@crissmoldovan", "workspace-governance", BIN_ENTRIES[name]);
    const expectedBytes = typeof expectedPath === "string" ? launcherText(r.runtime, cli, root, expectedPath) : null;
    if (!launcher || !isAbsolute(launcher.path ?? "") || launcher.path !== expectedPath || launcher.targetVersion !== r.activeVersion || typeof launcher.bytes !== "string" || launcher.bytes !== expectedBytes || !/^[0-9a-f]{64}$/.test(launcher.sha256 ?? "") || launcher.sha256 !== sha(expectedBytes)) fail("UNMANAGED", "receipt launcher ownership or digest is incoherent");
  }
  Object.defineProperty(r, "receiptSha256", { value: sha(receiptBytes), enumerable: false });
  return r;
}
async function verifyVersion(root, record) { const vr = join(root, "versions", record.version); if (await kind(vr) !== "directory") fail("MODIFIED", `managed version ${record.version} is missing`); const got = await inventory(vr); if (treeDigest(got) !== record.treeSha256 || JSON.stringify(got) !== JSON.stringify(record.files)) fail("MODIFIED", `managed version ${record.version} was modified`); }
async function verifyLaunchers(receipt) { for (const name of BINS) { const r = receipt.launchers[name]; if (!r || await kind(r.path) !== "file" || sha(await readFile(r.path)) !== r.sha256) fail("CONFLICT", `owned launcher ${name} is missing, linked, or modified`); } }
async function verifyReceiptOwnership(path, digest) { if (await kind(path) !== "file" || sha(await readFile(path)) !== digest) fail("CONFLICT", "private manager receipt changed concurrently"); }
function safeMember(name) { const candidate = name.endsWith("/") ? name.slice(0, -1) : name; return candidate === "package" || (candidate.startsWith("package/") && !candidate.startsWith("/") && !candidate.split("/").some(part => part === "" || part === "." || part === "..") && !candidate.includes("\\")); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function same(value, expected) { return JSON.stringify(canonical(value)) === JSON.stringify(canonical(expected)); }
function validatePackageMetadata(meta, expected) {
  const bins = meta?.bin && typeof meta.bin === "object" && !Array.isArray(meta.bin)
    ? Object.fromEntries(Object.entries(meta.bin).sort().map(([name, path]) => [name, typeof path === "string" ? path.replace(/^\.\//, "") : path]))
    : null;
  const lifecycleScripts = meta?.scripts && typeof meta.scripts === "object" && !Array.isArray(meta.scripts)
    ? LIFECYCLE_SCRIPTS.filter(name => Object.prototype.hasOwnProperty.call(meta.scripts, name))
    : [];
  if (meta?.name !== expected.name || meta?.version !== expected.version || meta?.engines?.node !== expected.engines.node || !same(bins, expected.bins) || !same(lifecycleScripts, expected.lifecycleScripts)) {
    fail("INVALID_ARTIFACT", "archive package metadata differs from the anchored manifest");
  }
}
function validateManifest(m) {
  const bins = m?.package?.bins;
  if (m?.schemaVersion !== 1 || m?.artifactType !== "workspace-governance-offline-runtime" || m.package?.name !== PACKAGE || !/^\d+\.\d+\.\d+$/.test(m.package?.version ?? "") || m.package?.engines?.node !== ">=24.0.0" || !same(bins, BIN_ENTRIES) || !Array.isArray(m.package?.lifecycleScripts) || m.package.lifecycleScripts.length !== 0) fail("INVALID_ARTIFACT", "release manifest package identity or lifecycle contract is invalid");
  if (!m.archive || typeof m.archive.file !== "string" || !/^.+\.tgz$/.test(m.archive.file) || !Number.isSafeInteger(m.archive.size) || m.archive.size < 1 || !/^[0-9a-f]{64}$/.test(m.archive.sha256 ?? "")) fail("INVALID_ARTIFACT", "release manifest archive identity is invalid");
  if (!Array.isArray(m.content) || m.content.length === 0) fail("INVALID_ARTIFACT", "release manifest content inventory is invalid");
  const seen = new Set();
  for (const entry of m.content) {
    if (!entry || Object.keys(entry).sort().join("\0") !== "mode\0path\0sha256\0size" || typeof entry.path !== "string" || entry.path === "package" || !safeMember(entry.path) || seen.has(entry.path) || !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) fail("INVALID_ARTIFACT", "release manifest content inventory is invalid");
    seen.add(entry.path);
  }
  if (!seen.has("package/package.json")) fail("INVALID_ARTIFACT", "release manifest omits package metadata");
}
async function inspectArchive(archive, manifest, tar) {
  const inspection = await mkdtemp(join(tmpdir(), "workspacectl-archive-inspection-"));
  try {
    const extracted = spawnSync(tar, ["-xzf", archive, "-C", inspection], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    if (extracted.error || extracted.status !== 0) fail("INVALID_ARTIFACT", "archive extraction failed after inventory validation");
    const actual = await inventory(inspection);
    const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    const expected = [...manifest.content].sort(byPath);
    const normalized = actual.map(entry => ({ path: entry.relativePath, mode: entry.mode, size: entry.size, sha256: entry.sha256 })).sort(byPath);
    if (!same(normalized, expected)) fail("INVALID_ARTIFACT", "archive content bytes, sizes, or modes differ from the anchored manifest");
    let metadata; try { metadata = JSON.parse(await readFile(join(inspection, "package", "package.json"), "utf8")); } catch { fail("INVALID_ARTIFACT", "archive package metadata is missing or invalid"); }
    validatePackageMetadata(metadata, manifest.package);
  } finally { await rm(inspection, { recursive: true, force: true }); }
}
async function validateBundle(o) {
  if (process.platform !== "linux" && process.platform !== "darwin") fail("UNSUPPORTED", `unsupported platform ${process.platform}; use manual installation guidance`);
  const manifestPath = join(o.bundle, MANIFEST_ASSET); if (await kind(manifestPath) !== "file") fail("INVALID_ARTIFACT", "release manifest is missing"); const mb = await readFile(manifestPath); if (sha(mb) !== o.manifest_sha256) fail("ANCHOR_MISMATCH", "release manifest does not match the carried approved anchor");
  let m; try { m = JSON.parse(mb); } catch { fail("INVALID_ARTIFACT", "release manifest is invalid JSON"); }
  validateManifest(m);
  const c = m.compatibility; if (c?.packageVersion !== m.package.version || c?.skillRef !== RELEASE_TAG || c?.catalogVersion !== CATALOG_VERSION) fail("INCOMPATIBLE", "package, skill, or catalog compatibility identity differs");
  if (m.release?.repository !== REPOSITORY || m.release?.tag !== RELEASE_TAG || m.release?.manifestAsset !== MANIFEST_ASSET) fail("INVALID_ARTIFACT", "release repository/tag/asset identity differs");
  const archive = join(o.bundle, m.archive?.file ?? ""); if (!inside(o.bundle, archive) || await kind(archive) !== "file") fail("INVALID_ARTIFACT", "archive path is invalid"); const ab = await readFile(archive); if (ab.length !== m.archive.size || sha(ab) !== m.archive.sha256) fail("INVALID_ARTIFACT", "archive digest or size differs");
  const privateBundle = await mkdtemp(join(tmpdir(), "workspacectl-anchored-bundle-")); const anchoredArchive = join(privateBundle, basename(archive)); await writeFile(anchoredArchive, ab, { mode: 0o600 });
  const npm = process.env.WORKSPACECTL_INSTALL_NPM || "npm"; const tar = process.env.WORKSPACECTL_INSTALL_TAR || "tar";
  try {
    const names = run(tar, ["-tzf", anchoredArchive]).split("\n").filter(Boolean); const verbose = run(tar, ["-tvzf", anchoredArchive]).split("\n").filter(Boolean); if (!names.length || names.length !== verbose.length) fail("INVALID_ARTIFACT", "archive inventory is invalid"); for (let i=0;i<names.length;i++) if (!safeMember(names[i]) || !["-", "d"].includes(verbose[i][0])) fail("INVALID_ARTIFACT", `archive contains an unsafe path or link: ${names[i]}`);
    const expected = new Set(m.content.map(x => x.path)); const regular = names.filter((_, i) => verbose[i][0] === "-"); if (regular.length !== expected.size || regular.some(x => !expected.has(x))) fail("INVALID_ARTIFACT", "archive regular-file inventory differs from manifest");
    await inspectArchive(anchoredArchive, m, tar);
    return { manifest: m, archive: anchoredArchive, privateBundle, npm, tar };
  } catch (error) { await rm(privateBundle, { recursive: true, force: true }); throw error; }
}
function shQuote(value) { return `'${value.replaceAll("'", `'\\''`)}'`; }
function launcherText(node, cli, root, path) { return `#!/bin/sh\n# workspacectl-managed-launcher-v2\nset -eu\nexport WORKSPACECTL_INSTALL_PREFIX=${shQuote(root)}\nexport WORKSPACECTL_LAUNCHER=${shQuote(path)}\nexport WORKSPACECTL_RUNTIME_PATH=${shQuote(node)}\nexec ${shQuote(node)} ${shQuote(cli)} "$@"\n`; }
async function acquire(root) { await mkdir(root, { recursive: true, mode: 0o700 }); const lock = join(root, ".manager-lock"); try { await mkdir(lock, { mode: 0o700 }); } catch (e) { if (e?.code === "EEXIST") fail("BUSY", "another runtime lifecycle operation holds the manager lock"); throw e; } return async () => rm(lock, { recursive: true, force: true }); }
async function exclusiveFile(path, bytes, mode) { const dir = await mkdtemp(join(dirname(path), ".launcher-")); const candidate = join(dir, basename(path)); try { await writeFile(candidate, bytes, { mode }); await chmod(candidate, mode); await link(candidate, path); } catch (e) { if (e?.code === "EEXIST") fail("CONFLICT", `target became occupied: ${path}`); throw e; } finally { await rm(dir, { recursive: true, force: true }); } }
async function restoreMovedNoReplace(moved, path) { try { await link(moved, path); } catch (e) { if (e?.code === "EEXIST") fail("CONFLICT", `target became occupied while preserving a concurrent replacement: ${path}`); throw e; } await unlink(moved); }
async function quarantineOwned(path, digest) {
  if (await kind(path) !== "file") fail("CONFLICT", `owned target changed: ${path}`);
  const before = await stat(path); if (sha(await readFile(path)) !== digest) fail("CONFLICT", `owned target changed: ${path}`);
  const privateDir = await mkdtemp(join(dirname(path), ".workspacectl-private-")); await chmod(privateDir, 0o700); const moved = join(privateDir, "owned");
  try {
    if (process.env.WORKSPACECTL_TEST_REPLACE_BEFORE_UNLINK === path) { await rename(path, `${path}.displaced`); await writeFile(path, "concurrent replacement\n", { mode: 0o755 }); }
    await rename(path, moved);
  } catch (e) { await rm(privateDir, { recursive: true, force: true }); throw e; }
  const movedStat = await stat(moved); const movedDigest = sha(await readFile(moved));
  if (movedStat.dev !== before.dev || movedStat.ino !== before.ino || movedDigest !== digest) {
    try { await restoreMovedNoReplace(moved, path); await rm(privateDir, { recursive: true, force: true }); } catch (e) { if (e instanceof Refusal) throw e; throw e; }
    fail("CONFLICT", `owned target changed concurrently and replacement was preserved: ${path}`);
  }
  if (process.env.WORKSPACECTL_TEST_REPLACE_AFTER_UNLINK === path) await writeFile(path, "concurrent replacement\n", { mode: 0o755 });
  try { await link(moved, path); } catch (e) { if (e?.code === "EEXIST") fail("CONFLICT", `replacement appeared after owned target was quarantined: ${path}`); throw e; }
  const guard = await stat(path); if (guard.dev !== movedStat.dev || guard.ino !== movedStat.ino) fail("CONFLICT", `owned target guard changed concurrently: ${path}`);
  return { path, digest, privateDir, moved, movedStat, released: false };
}
async function releaseQuarantined(transaction) {
  const released = join(transaction.privateDir, "released"); await rename(transaction.path, released); const moved = await stat(released);
  if (moved.dev !== transaction.movedStat.dev || moved.ino !== transaction.movedStat.ino || sha(await readFile(released)) !== transaction.digest) {
    await restoreMovedNoReplace(released, transaction.path);
    fail("CONFLICT", `launcher changed during quarantine release and replacement was preserved: ${transaction.path}`);
  }
  transaction.released = true;
}
async function rollbackQuarantined(transaction) {
  if (transaction.released) {
    try { await link(transaction.moved, transaction.path); } catch (e) { if (e?.code === "EEXIST") return; throw e; }
  }
  try { const current = await stat(transaction.path); if (current.dev === transaction.movedStat.dev && current.ino === transaction.movedStat.ino) await rm(transaction.privateDir, { recursive: true, force: true }); } catch {}
}
async function discardCandidate(path, digest) {
  if (await kind(path) === "absent") return;
  if (await kind(path) !== "file" || sha(await readFile(path)) !== digest) return;
  const candidate = await quarantineOwned(path, digest);
  await releaseQuarantined(candidate);
  await rm(candidate.privateDir, { recursive: true, force: true });
}
async function replaceOwnedSet(entries) {
  const quarantined = [], installed = [];
  try {
    for (const entry of entries) quarantined.push(await quarantineOwned(entry.path, entry.oldDigest));
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index], transaction = quarantined[index];
      await releaseQuarantined(transaction);
      if (process.env.WORKSPACECTL_TEST_FAIL_SWITCH === entry.path) fail("CONFLICT", `injected owned-target switch failure: ${entry.path}`);
      await exclusiveFile(entry.path, entry.bytes, entry.mode);
      installed.push({ path: entry.path, digest: sha(entry.bytes) });
    }
  } catch (error) {
    let preserveVersionRoot = false;
    for (const candidate of installed.reverse()) {
      try { await discardCandidate(candidate.path, candidate.digest); } catch { preserveVersionRoot = true; }
      if (await kind(candidate.path) !== "absent") preserveVersionRoot = true;
    }
    for (const transaction of quarantined.reverse()) { try { await rollbackQuarantined(transaction); } catch { preserveVersionRoot = true; } }
    if (preserveVersionRoot && error && typeof error === "object") error.preserveVersionRoot = true;
    throw error;
  }
  for (const transaction of quarantined) await rm(transaction.privateDir, { recursive: true, force: true });
}
function releaseIdentity(validated, manifestSha256) {
  return {
    release: { ...validated.manifest.release },
    manifestSha256,
    archiveSha256: validated.manifest.archive.sha256,
    compatibility: { ...validated.manifest.compatibility, runtimeManifestSha256: manifestSha256 },
  };
}
async function stageVersion(o, validated, versionRoot) { const version = validated.manifest.package.version; const staging = await mkdtemp(join(o.root, `.staging-${version}-`)); try { const cache = join(staging, ".npm-cache"); const outcome = spawnSync(validated.npm, ["install", "--global", "--prefix", staging, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache, validated.archive], { encoding: "utf8", env: process.env, timeout: 120000 }); if (outcome.error || outcome.status !== 0) fail("INSTALL_FAILED", "offline scripts-disabled npm installation failed"); await rm(cache, { recursive: true, force: true }); const pkg = join(staging, "lib", "node_modules", "@crissmoldovan", "workspace-governance"); let meta; try { meta = JSON.parse(await readFile(join(pkg, "package.json"), "utf8")); } catch { fail("INVALID_ARTIFACT", "installed package metadata is missing or invalid"); } validatePackageMetadata(meta, validated.manifest.package); for (const n of BINS) if (await kind(join(pkg, validated.manifest.package.bins[n])) !== "file") fail("INVALID_ARTIFACT", `installed package lacks ${n}`); const cliCheck = spawnSync(process.execPath, [join(pkg, validated.manifest.package.bins.workspacectl), "--version"], { encoding: "utf8", env: process.env, timeout: 10000 }); if (cliCheck.error || cliCheck.status !== 0 || cliCheck.stdout.trim() !== version) fail("INVALID_ARTIFACT", "staged CLI executable version verification failed"); const mcpCheck = spawnSync(process.execPath, [join(pkg, validated.manifest.package.bins["workspacectl-mcp"])], { encoding: "utf8", env: process.env, timeout: 10000 }); if (mcpCheck.error || mcpCheck.status !== 2 || !/Usage: workspacectl-mcp/.test(mcpCheck.stderr)) fail("INVALID_ARTIFACT", "staged MCP executable verification failed"); await rm(join(staging, "bin"), { recursive: true, force: true }); await rm(join(pkg, "node_modules", ".bin"), { recursive: true, force: true }); await rename(staging, versionRoot); } catch (e) { await rm(staging, { recursive: true, force: true }); throw e; } const files = await inventory(versionRoot); return { version, root: versionRoot, files, treeSha256: treeDigest(files), ...releaseIdentity(validated, o.manifest_sha256) }; }
async function install(o, validated) {
  let release = await acquire(o.root); try {
    if (await kind(join(o.root, RECEIPT)) === "file") {
      const current = await loadReceipt(o.root, o.bin_dir); for (const v of Object.values(current.versions)) await verifyVersion(o.root, v); await verifyLaunchers(current);
      if (current.activeVersion === validated.manifest.package.version && current.manifestSha256 === o.manifest_sha256) return { action: o.action, applied: false, noOp: true, activeVersion: current.activeVersion };
      if (o.action !== "update") fail("CONFLICT", "a managed runtime already exists; use update with a different anchored version");
      const version = validated.manifest.package.version, versionRoot = join(o.root, "versions", version); if (current.versions[version] || await kind(versionRoot) !== "absent") fail("CONFLICT", "update version root is already occupied");
      const record = await stageVersion(o, validated, versionRoot);
      try {
        const receiptPath = join(o.root, RECEIPT);
        if (process.env.WORKSPACECTL_TEST_REPLACE_RECEIPT_AFTER_STAGE === receiptPath) await writeFile(receiptPath, "concurrent receipt replacement\n", { mode: 0o600 });
        if (process.env.WORKSPACECTL_TEST_MODIFY_MANAGED_AFTER_STAGE) await writeFile(process.env.WORKSPACECTL_TEST_MODIFY_MANAGED_AFTER_STAGE, "concurrent managed replacement\n");
        for (const owned of Object.values(current.versions)) await verifyVersion(o.root, owned);
        await verifyVersion(o.root, record); await verifyLaunchers(current); await verifyReceiptOwnership(receiptPath, current.receiptSha256);
        const nextLaunchers = {};
        for (const name of BINS) { const p = current.launchers[name].path, cli = join(versionRoot, "lib", "node_modules", "@crissmoldovan", "workspace-governance", validated.manifest.package.bins[name]); const bytes = launcherText(process.execPath, cli, o.root, p); nextLaunchers[name] = { path: p, sha256: sha(bytes), targetVersion: version, bytes }; }
        const next = { ...current, ...releaseIdentity(validated, o.manifest_sha256), activeVersion: version, launchers: nextLaunchers, retainedVersions: [...new Set([...(current.retainedVersions ?? []), current.activeVersion])], versions: { ...current.versions, [version]: record } };
        const receiptBytes = jsonBytes(next);
        await replaceOwnedSet([
          ...BINS.map(name => ({ path: current.launchers[name].path, oldDigest: current.launchers[name].sha256, bytes: nextLaunchers[name].bytes, mode: 0o755 })),
          { path: receiptPath, oldDigest: current.receiptSha256, bytes: receiptBytes, mode: 0o600 },
        ]);
        return { action: "update", applied: true, activeVersion: version, retainedVersions: next.retainedVersions };
      } catch (e) { if (!e?.preserveVersionRoot) await rm(versionRoot, { recursive: true, force: true }); throw e; }
    }
    const unknownRoot = (await readdir(o.root)).filter(name => name !== ".manager-lock"); if (unknownRoot.length) fail("CONFLICT", "managed root is occupied without a valid receipt");
    for (const name of BINS) if (await kind(join(o.bin_dir, name)) !== "absent") fail("CONFLICT", `launcher path is occupied: ${join(o.bin_dir, name)}`);
    const version = validated.manifest.package.version, versionRoot = join(o.root, "versions", version); if (await kind(versionRoot) !== "absent") fail("CONFLICT", "version root is occupied without a valid receipt"); await mkdir(join(o.root, "versions"), { recursive: true, mode: 0o700 }); await mkdir(o.bin_dir, { recursive: true, mode: 0o700 }); const staging = await mkdtemp(join(o.root, `.staging-${version}-`));
    await rm(staging, { recursive: true, force: true }); const record = await stageVersion(o, validated, versionRoot); const files = record.files; const launchers = {}; const created = []; try { for (const name of BINS) { const p = join(o.bin_dir, name), cli = join(versionRoot, "lib", "node_modules", "@crissmoldovan", "workspace-governance", validated.manifest.package.bins[name]); const bytes = launcherText(process.execPath, cli, o.root, p); await exclusiveFile(p, bytes, 0o755); created.push(p); launchers[name] = { path: p, sha256: sha(bytes), targetVersion: version, bytes }; } } catch (e) { for (const p of created) await rm(p, { force: true }); await rm(versionRoot, { recursive: true, force: true }); throw e; }
    const identity = releaseIdentity(validated, o.manifest_sha256); const receipt = { schemaVersion: 2, package: PACKAGE, ...identity, activeVersion: version, runtime: process.execPath, versions: { [version]: record }, launchers, retainedVersions: [] }; await writeFile(join(o.root, RECEIPT), jsonBytes(receipt), { mode: 0o600 }); await chmod(join(o.root, RECEIPT), 0o600); return { action: o.action, applied: true, noOp: false, activeVersion: version, launchers: Object.fromEntries(BINS.map(n => [n, launchers[n].path])) };
  } finally { await release(); }
}
async function removeInstall(o) { const release = await acquire(o.root); try { const r = await loadReceipt(o.root, o.bin_dir); for (const v of Object.values(r.versions)) await verifyVersion(o.root, v); await verifyLaunchers(r); const known = new Set(Object.keys(r.versions)); const found = await readdir(join(o.root, "versions")); if (found.some(name => !known.has(name))) fail("CONFLICT", "versions container contains unknown content; nothing was removed"); if (o.preserve_version && !r.versions[o.preserve_version]) fail("INVALID_ARGUMENT", "--preserve-version must name an exactly owned version"); const quarantined = []; try { for (const n of BINS) quarantined.push(await quarantineOwned(r.launchers[n].path, r.launchers[n].sha256)); for (const transaction of quarantined) await releaseQuarantined(transaction); } catch (e) { for (const transaction of quarantined.reverse()) await rollbackQuarantined(transaction); throw e; } for (const transaction of quarantined) await rm(transaction.privateDir, { recursive: true, force: true }); const removedVersions = []; for (const [version, record] of Object.entries(r.versions)) if (version !== o.preserve_version) { await rm(record.root, { recursive: true }); removedVersions.push(version); } if (o.preserve_version) { const backup = { schemaVersion: 2, package: PACKAGE, release: r.release, manifestSha256: r.manifestSha256, archiveSha256: r.archiveSha256, preservedVersion: o.preserve_version, version: r.versions[o.preserve_version], compatibility: r.compatibility, runtime: r.runtime }; await writeFile(join(o.root, "backup-receipt.json"), jsonBytes(backup), { mode: 0o600 }); } else await rmdir(join(o.root, "versions")); await rm(join(o.root, RECEIPT)); return { action: "remove", applied: true, removedVersions, preservedVersion: o.preserve_version ?? null, preserved: ["config", "catalog", "state", "plans", "repositories", "skills"] }; } finally { await release(); try { if ((await readdir(o.root)).length === 0) await rm(o.root, { recursive: true }); } catch {} } }
async function rollbackInstall(o) {
  const release = await acquire(o.root);
  try {
    const r = await loadReceipt(o.root, o.bin_dir); for (const v of Object.values(r.versions)) await verifyVersion(o.root, v); await verifyLaunchers(r);
    const target = o.version ?? [...(r.retainedVersions ?? [])].reverse().find(v => v !== r.activeVersion);
    if (!target || !r.versions[target] || target === r.activeVersion) fail("INVALID_ARGUMENT", "rollback target must name a retained verified version");
    const targetRecord = r.versions[target], nextLaunchers = {};
    for (const name of BINS) { const old = r.launchers[name], cli = join(targetRecord.root, "lib", "node_modules", "@crissmoldovan", "workspace-governance", BIN_ENTRIES[name]); if (await kind(cli) !== "file") fail("MODIFIED", `rollback target lacks ${name}`); const bytes = launcherText(r.runtime, cli, o.root, old.path); nextLaunchers[name] = { path: old.path, sha256: sha(bytes), targetVersion: target, bytes }; }
    const previous = r.activeVersion;
    const next = { ...r, release: targetRecord.release, manifestSha256: targetRecord.manifestSha256, archiveSha256: targetRecord.archiveSha256, compatibility: targetRecord.compatibility, activeVersion: target, launchers: nextLaunchers, retainedVersions: [...new Set([...(r.retainedVersions ?? []).filter(v => v !== target), previous])] };
    const receiptPath = join(o.root, RECEIPT);
    await verifyVersion(o.root, targetRecord); await verifyLaunchers(r); await verifyReceiptOwnership(receiptPath, r.receiptSha256);
    await replaceOwnedSet([
      ...BINS.map(name => ({ path: r.launchers[name].path, oldDigest: r.launchers[name].sha256, bytes: nextLaunchers[name].bytes, mode: 0o755 })),
      { path: receiptPath, oldDigest: r.receiptSha256, bytes: jsonBytes(next), mode: 0o600 },
    ]);
    return { action: "rollback", applied: true, activeVersion: target, retainedVersions: next.retainedVersions };
  } finally { await release(); }
}
async function main() { const o = parse(process.argv.slice(2)); await refuseSymlinkAncestors(o.root); await refuseSymlinkAncestors(o.bin_dir); let result;
  if (["status", "remove", "rollback"].includes(o.action)) { if (o.action === "status") { try { const r = await loadReceipt(o.root, o.bin_dir); await verifyVersion(o.root, r.versions[r.activeVersion]); await verifyLaunchers(r); result = { action: "status", managed: true, activeVersion: r.activeVersion, compatibility: r.compatibility }; } catch (e) { if (e instanceof Refusal && e.code === "UNMANAGED") result = { action: "status", managed: false }; else throw e; } } else if (o.action === "rollback") { const r = await loadReceipt(o.root, o.bin_dir); const target = o.version ?? [...(r.retainedVersions ?? [])].reverse().find(v => v !== r.activeVersion); if (!o.yes) result = { action: "rollback", applied: false, requiresYes: true, activeVersion: r.activeVersion, targetVersion: target ?? null }; else result = await rollbackInstall(o); } else if (!o.yes) { const r = await loadReceipt(o.root, o.bin_dir); if (o.preserve_version && !r.versions[o.preserve_version]) fail("INVALID_ARGUMENT", "--preserve-version must name an exactly owned version"); result = { action: "remove", applied: false, requiresYes: true, activeVersion: r.activeVersion, launchers: BINS.map(n => r.launchers[n].path), versionRoots: Object.values(r.versions).map(v => v.root), preserveVersion: o.preserve_version ?? null }; } else result = await removeInstall(o);
  } else { const downloadedBundle = o.bundle ? null : await downloadPinnedBundle(o.manifest_sha256); if (downloadedBundle) o.bundle = downloadedBundle; try { const v = await validateBundle(o); try { if (!o.yes) result = { action: o.action === "plan" ? "install" : o.action, applied: false, requiresYes: true, source: downloadedBundle ? { type: "github-release", repository: REPOSITORY, tag: RELEASE_TAG } : { type: "offline-bundle", path: o.bundle }, package: v.manifest.package, compatibility: v.manifest.compatibility, destination: { root: o.root, binDir: o.bin_dir } }; else result = await install(o, v); } finally { await rm(v.privateBundle, { recursive: true, force: true }); } } finally { if (downloadedBundle) await rm(downloadedBundle, { recursive: true, force: true }); } }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
function isEntrypoint(moduleUrl) {
  if (!process.argv[1]) return false;
  try { return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(moduleUrl)); }
  catch { return false; }
}
if (isEntrypoint(import.meta.url)) main().catch(e => { const code = e instanceof Refusal ? e.code : "INTERNAL"; process.stderr.write(`${JSON.stringify({ error: { code, message: e instanceof Error ? e.message : String(e) } })}\n`); process.exitCode = code === "CONSENT_REQUIRED" ? 4 : code === "CONFLICT" || code === "BUSY" || code === "MODIFIED" || code === "UNMANAGED" ? 5 : 2; });
