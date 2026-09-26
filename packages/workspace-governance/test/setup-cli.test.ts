import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localSourceRef } from "../src/skill-lifecycle.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function base() {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-setup-cli-"));
  const home = join(root, "home"), project = join(root, "project"), source = join(root, "source");
  await Promise.all([mkdir(home), mkdir(project), mkdir(join(source, "skills", "workspace-governance"), { recursive: true })]);
  await writeFile(join(project, "package.json"), '{"name":"fixture","private":true}\n');
  await writeFile(join(source, "skills", "workspace-governance", "SKILL.md"), "---\nname: workspace-governance\ndescription: fixture\nversion: 0.3.0\n---\nFixture\n");
  const env = { ...process.env, HOME: home, HERMES_HOME: join(home, ".hermes"), CLAUDE_CONFIG_DIR: join(home, ".claude") };
  return { root, home, project, source, ref: await localSourceRef(source), env };
}
const invoke = (cwd: string, env: NodeJS.ProcessEnv, args: string[], input?: string) => spawnSync(process.execPath, [cli, ...args], { cwd, env, input, encoding: "utf8" });

test("setup JSON is inert by default and renders exact manual add/remove commands", async () => {
  const f = await base();
  try {
    const before = await access(join(f.project, ".agents")).then(() => true, () => false);
    const result = invoke(f.project, f.env, ["setup", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.mode, "preview");
    assert.equal(body.cliReady, true);
    assert.equal(body.skill.optional, true);
    assert.match(body.instructions.join("\n"), /skills@1\.7\.0 add/);
    assert.match(body.instructions.join("\n"), /--agent hermes-agent --copy --yes --json/);
    assert.match(body.instructions.join("\n"), /skills@1\.7\.0 remove/);
    assert.equal(await access(join(f.project, ".agents")).then(() => true, () => false), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("noninteractive installation requires action, source, immutable ref, agents, scope, and yes", async () => {
  const f = await base();
  try {
    const complete = ["setup", "--install-skill", "--source", f.source, "--ref", f.ref, "--agent", "hermes-agent", "--scope", "project", "--yes", "--json"];
    for (const remove of [["--source", f.source], ["--ref", f.ref], ["--agent", "hermes-agent"], ["--scope", "project"], ["--yes"]]) {
      const args = [...complete];
      const index = args.indexOf(remove[0]);
      args.splice(index, remove.length);
      const result = invoke(f.project, f.env, args);
      assert.equal(result.status, 2, `${args.join(" ")}\n${result.stderr}`);
      assert.equal(JSON.parse(result.stderr).ok, false);
      assert.match(JSON.parse(result.stderr).error.code, /CONSENT_REQUIRED|INVALID_ARGUMENT/);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("ordinary help, list, and doctor never launch Skills CLI", async () => {
  const f = await base();
  try {
    const bin = join(f.root, "bin"), sentinel = join(f.root, "npx-ran");
    await mkdir(bin);
    await writeFile(join(bin, "npx"), `#!/bin/sh\n: > ${JSON.stringify(sentinel)}\nexit 88\n`, { mode: 0o755 });
    const env = { ...f.env, PATH: `${bin}:${process.env.PATH ?? ""}` };
    for (const args of [["--help"], ["list", "--json"], ["doctor", "--json"]]) invoke(f.project, env, args);
    await assert.rejects(access(sentinel), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("EOF on interactive setup defaults to skip without installation", async () => {
  const f = await base();
  try {
    const result = invoke(f.project, { ...f.env, WORKSPACECTL_FORCE_INTERACTIVE: "1", WORKSPACECTL_SKILL_SOURCE: f.source, WORKSPACECTL_SKILL_REF: f.ref }, ["setup"], "");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /optional/i);
    assert.match(result.stdout, /skipped/i);
    await assert.rejects(access(join(f.project, ".agents", "skills", "workspace-governance")), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("spawn failure returns structured sanitized JSON with exit 6", async () => {
  const f = await base();
  try {
    const result = invoke(f.project, { ...f.env, PATH: join(f.root, "missing-bin"), PRIVATE_TOKEN: "not-a-real-secret" }, ["setup", "--install-skill", "--source", f.source, "--ref", f.ref, "--agent", "hermes-agent", "--scope", "project", "--yes", "--json"]);
    assert.equal(result.status, 6, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.failureCode, "TOOL_FAILURE");
    assert.equal(body.exitStatus, 1);
    assert.match(body.installerStderr, /failed to start or complete/i);
    assert.doesNotMatch(JSON.stringify(body), /not-a-real-secret/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
