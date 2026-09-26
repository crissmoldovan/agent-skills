import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runner = join(root, "scripts", "verify-workspace-governance-release.mjs");
const workflow = join(root, ".github", "workflows", "workspace-governance-release-consumer.yml");
const node = process.execPath;

function refusal(args) {
  const result = spawnSync(node, [runner, ...args], { encoding: "utf8" });
  assert.notEqual(result.status, 0, `unexpected success: ${result.stdout}`);
  return JSON.parse(result.stderr.trim());
}

test("rejects malformed manifest anchors before network or fixture access", () => {
  const result = refusal(["--mode", "release", "--manifest-sha256", "ABC"]);
  assert.equal(result.error.code, "INVALID_ARGUMENT");
  assert.match(result.error.message, /lowercase SHA-256/);
});

test("rejects mutable or malformed release tags", () => {
  for (const tag of ["main", "workspace-governance-v0.3", "workspace-governance-v0.3.0/../x"]) {
    const result = refusal(["--mode", "release", "--tag", tag]);
    assert.equal(result.error.code, "INVALID_ARGUMENT");
  }
});

test("rejects non-HTTPS and non-official release repositories", () => {
  for (const repository of ["http://github.com/crissmoldovan/agent-skills", "https://example.com/crissmoldovan/agent-skills"]) {
    const result = refusal(["--mode", "release", "--repository", repository]);
    assert.equal(result.error.code, "INVALID_ARGUMENT");
  }
});

test("workflow is post-publication, read-only, dual-host, and source-runtime-free", async () => {
  const text = await readFile(workflow, "utf8");
  assert.match(text, /release:\s*\n\s*types: \[published\]/);
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /permissions:\s*\n\s*contents: read/);
  assert.match(text, /ubuntu-latest/);
  assert.match(text, /macos-14/);
  assert.match(text, /workspace-governance-v0\.3\.0/);
  assert.match(text, /2a5ad4846c14e3ff9c2948b216133821743083ffb1c6d07b7474e1b4b4b46379/);
  const verifierDigest = createHash("sha256").update(await readFile(runner)).digest("hex");
  assert.match(text, new RegExp(`VERIFIER_SHA256: ${verifierDigest}`));
  assert.doesNotMatch(text, /actions\/checkout/);
  assert.doesNotMatch(text, /npm (?:run )?(?:build|pack)/);
});

test("CLI-first global install is performed by the installed runtime and read back with Skills", async () => {
  const text = await readFile(runner, "utf8");
  assert.match(text, /context\.cli, \["setup", "--install-skill", "--source", source, "--ref", ref, "--agent", EXPECTED\.agent, "--scope", "global", "--yes", "--json"\]/);
  assert.doesNotMatch(text, /exerciseSkill\(options, context, "global", "cliFirstGlobal"\)/);
  assert.match(text, /npxArgs\("list", "--agent", EXPECTED\.agent, "--json", "--global"\)/);
  assert.match(text, /setup\.ok !== true|!setup\.ok/);
});

test("preservation covers Git bytes and release skill provenance is exact", async () => {
  const text = await readFile(runner, "utf8");
  assert.doesNotMatch(text, /name === "\.git"/);
  assert.match(text, /expectedPublicSkillTree/);
  assert.match(text, /assert\.deepEqual\(tree, context\.expectedSkillTree/);
  assert.match(text, /governedSnapshotIncludesGit: true/);
});

test("second-host classification requires Actions and runner identity", async () => {
  const text = await readFile(runner, "utf8");
  assert.match(text, /process\.env\.GITHUB_ACTIONS === "true"/);
  assert.match(text, /RUNNER_NAME/);
  assert.match(text, /published-source same-host verification/);
});

test("MCP framing rejects non-JSON and awaits terminal exit after kill", async () => {
  const text = await readFile(runner, "utf8");
  assert.match(text, /INVALID_OUTPUT.*non-JSON MCP stdout|non-JSON MCP stdout.*INVALID_OUTPUT/s);
  assert.match(text, /child\.once\("error"/);
  assert.match(text, /child\.kill\("SIGKILL"\);\s*await exited/);
});

test("MCP harness rejects malformed stdout and spawn errors in real child processes", async () => {
  const { mcpCall } = await import(`${new URL(`file://${runner}`).href}?test=${Date.now()}`);
  await assert.rejects(
    mcpCall(node, ["-e", "process.stdout.write('not-json\\n')"], {}),
    error => error?.code === "INVALID_OUTPUT" && /non-JSON MCP stdout/.test(error.message),
  );
  await assert.rejects(
    mcpCall(join(root, "absent-mcp-executable"), [], {}),
    /MCP process error/,
  );
});
