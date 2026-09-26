import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Runtime helper is intentionally shipped as a standalone JavaScript module.
// @ts-expect-error no declaration file is published for the carried helper
import { fetchReleaseAsset } from "../scripts/install-runtime.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const carried = fileURLToPath(new URL("../../../skills/workspace-governance/scripts/install-runtime.mjs", import.meta.url));
const skill = fileURLToPath(new URL("../../../skills/workspace-governance/SKILL.md", import.meta.url));

test("carried bootstrap runs through a symlink rather than silently exiting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bootstrap-symlink-"));
  try {
    const link = join(directory, "helper.mjs");
    await symlink(carried, link);
    for (const flags of [[], ["--preserve-symlinks-main"]]) {
      const result = spawnSync(process.execPath, [...flags, link, "status", "--root", join(directory, "managed"), "--bin-dir", join(directory, "bin"), "--json"], { encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { action: "status", managed: false });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("carried bootstrap is self-contained and anchored to the 0.3 compatibility tuple", async () => {
  assert.deepEqual(await readFile(carried), await readFile(`${root}/scripts/install-runtime.mjs`));
  const text = await readFile(skill, "utf8");
  assert.match(text, /version: 0\.3\.0/);
  assert.match(text, /workspace-governance-v0\.3\.0/);
  assert.match(text, /catalog 0\.26\.0/);
  assert.match(text, /runtime-manifest-sha256=b0060938c279a74b249e67ab8c26a8fa83848b0e25f406e0747bcde3ca72a246/);
  assert.match(text, /--bundle \/absolute\/release-assets/);
  assert.match(text, /never uses sudo/);
});

test("release downloader follows only bounded allowlisted HTTPS redirects", async () => {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    requested.push(url);
    if (requested.length === 1) return new Response(null, {
      status: 302,
      headers: { location: "https://release-assets.githubusercontent.com/asset-id/runtime-manifest.json" },
    });
    return new Response("anchored bytes", { status: 200, headers: { "content-length": "14" } });
  }) as typeof fetch;
  try {
    const bytes = await fetchReleaseAsset("https://github.com/crissmoldovan/agent-skills/releases/download/workspace-governance-v0.3.0/runtime-manifest.json", 1024);
    assert.equal(bytes.toString(), "anchored bytes");
    assert.equal(requested.length, 2);
  } finally { globalThis.fetch = original; }
});

test("release downloader refuses an off-policy redirect before requesting it", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { location: "https://example.invalid/replacement" } });
  }) as typeof fetch;
  try {
    await assert.rejects(
      fetchReleaseAsset("https://github.com/crissmoldovan/agent-skills/releases/download/workspace-governance-v0.3.0/runtime-manifest.json", 1024),
      /approved HTTPS hosts/,
    );
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test("release downloader stops an oversized chunked body without a content length", async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = (async () => new Response(new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
    },
    cancel() { cancelled = true; },
  }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      fetchReleaseAsset("https://github.com/crissmoldovan/agent-skills/releases/download/workspace-governance-v0.3.0/runtime-manifest.json", 10),
      /size limit/,
    );
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = original; }
});
