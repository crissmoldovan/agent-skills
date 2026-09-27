import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SKILLS_CLI_VERSION,
  localSourceRef,
  planSkillLifecycle,
  runSkillLifecycle,
  type LifecycleRunner,
} from "../src/skill-lifecycle.ts";

async function fixture(): Promise<{ root: string; home: string; project: string; source: string; ref: string }> {
  const root = await mkdtemp(join(tmpdir(), "workspacectl-skill-lifecycle-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const source = join(root, "source");
  await Promise.all([
    mkdir(join(home, ".hermes"), { recursive: true }),
    mkdir(join(home, ".claude"), { recursive: true }),
    mkdir(join(project, ".hermes"), { recursive: true }),
    mkdir(join(project, ".claude"), { recursive: true }),
    mkdir(join(source, "skills", "workspace-governance", "references"), { recursive: true }),
  ]);
  await writeFile(join(project, "package.json"), '{"name":"fixture","private":true}\n');
  await writeFile(join(source, "skills", "workspace-governance", "SKILL.md"), "---\nname: workspace-governance\ndescription: fixture\nversion: 0.3.0\n---\nFixture\n");
  await writeFile(join(source, "skills", "workspace-governance", "references", "guide.md"), "guide\n");
  return { root, home, project, source, ref: await localSourceRef(source) };
}

const envFor = (home: string): NodeJS.ProcessEnv => ({
  HOME: home,
  HERMES_HOME: join(home, ".hermes"),
  CLAUDE_CONFIG_DIR: join(home, ".claude"),
  PATH: process.env.PATH,
});

test("setup preview pins Skills CLI, immutable ref, real agent IDs, and cwd project scope", async () => {
  const f = await fixture();
  try {
    const plan = await planSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent", "claude-code"], scope: "project", cwd: f.project, env: envFor(f.home) });
    assert.equal(SKILLS_CLI_VERSION, "1.7.0");
    assert.equal(plan.mutates, false);
    assert.equal(plan.projectDirectory, f.project);
    assert.deepEqual(plan.command, ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`, "add", f.source, "--skill", "workspace-governance", "--agent", "hermes-agent", "claude-code", "--copy", "--yes", "--json"]);
    assert.deepEqual(plan.projections.map((p) => p.agent), ["hermes-agent", "claude-code"]);
    assert.ok(plan.projections.every((p) => p.state === "absent"));
    assert.equal(plan.ref, f.ref);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("unsupported agents and mutable refs refuse before invoking the installer", async () => {
  const f = await fixture();
  try {
    await assert.rejects(planSkillLifecycle({ action: "add", source: f.source, ref: "main", agents: ["hermes-agent"], scope: "project", cwd: f.project, env: envFor(f.home) }), (error: any) => error.code === "INVALID_ARGUMENT");
    await assert.rejects(planSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["invented-agent"], scope: "project", cwd: f.project, env: envFor(f.home) }), (error: any) => error.code === "UNSUPPORTED_AGENT");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("unmanaged directories, modified managed bytes, and unknown symlinks refuse unchanged", async () => {
  const f = await fixture();
  try {
    const target = join(f.project, ".agents", "skills", "workspace-governance");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "unmanaged\n");
    const before = await readFile(join(target, "SKILL.md"), "utf8");
    await assert.rejects(planSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent"], scope: "project", cwd: f.project, env: envFor(f.home) }), (error: any) => error.code === "SKILL_CONFLICT");
    assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), before);
    await rm(target, { recursive: true });
    await symlink(join(f.root, "elsewhere"), target);
    await assert.rejects(planSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent"], scope: "project", cwd: f.project, env: envFor(f.home) }), (error: any) => error.code === "SKILL_CONFLICT");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("byte-identical unmanaged copies cannot authorize removal", async () => {
  const f = await fixture();
  try {
    const projection = join(f.project, ".hermes", "skills", "workspace-governance");
    await cp(join(f.source, "skills", "workspace-governance"), projection, { recursive: true });
    await assert.rejects(planSkillLifecycle({ action: "remove", source: f.source, ref: f.ref, agents: ["hermes-agent"], scope: "project", cwd: f.project, env: envFor(f.home) }), (error: any) => error.code === "SKILL_CONFLICT");
    assert.equal(await readFile(join(projection, "SKILL.md"), "utf8"), await readFile(join(f.source, "skills", "workspace-governance", "SKILL.md"), "utf8"));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("source provenance and scope ancestors refuse mismatches before installer execution", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, "skills", "workspace-governance", "SKILL.md"), "modified\n");
    await assert.rejects(planSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent"], scope: "project", cwd: f.project, env: envFor(f.home) }), (error: any) => error.code === "UNTRUSTED_INPUT");
    const currentRef = await localSourceRef(f.source);
    const linkedRoot = join(f.project, ".hermes");
    await rm(linkedRoot, { recursive: true });
    await symlink(join(f.root, "outside"), linkedRoot);
    await assert.rejects(planSkillLifecycle({ action: "add", source: f.source, ref: currentRef, agents: ["hermes-agent"], scope: "project", cwd: f.project, env: envFor(f.home) }), (error: any) => error.code === "SKILL_CONFLICT");
    await assert.rejects(planSkillLifecycle({ action: "add", source: f.source, ref: currentRef, agents: ["hermes-agent"], scope: "global", cwd: f.project, env: { ...envFor(f.home), HERMES_HOME: join(f.root, "outside-hermes") } }), (error: any) => error.code === "INVALID_ARGUMENT");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("successful add verifies exact source bytes, version, provenance, and matching rerun is no-op", async () => {
  const f = await fixture();
  try {
    const runner: LifecycleRunner = async ({ plan }) => {
      for (const projection of plan.projections) {
        await cp(join(f.source, "skills", "workspace-governance"), projection.path, { recursive: true });
      }
      return { status: 0, stdout: JSON.stringify([{ name: "workspace-governance", status: "installed", source: f.source, ref: null }]), stderr: "" };
    };
    const added = await runSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent", "claude-code"], scope: "project", cwd: f.project, env: envFor(f.home), yes: true }, runner);
    assert.equal(added.ok, true);
    assert.equal(added.skillVersion, "0.3.0");
    assert.ok(added.projections.every((p) => p.readback === "matching"));
    assert.equal(added.provenance.source, f.source);
    assert.equal(added.provenance.ref, f.ref);
    let invoked = false;
    const noop = await runSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent", "claude-code"], scope: "project", cwd: f.project, env: envFor(f.home), yes: true }, async () => { invoked = true; throw new Error("not reached"); });
    assert.equal(invoked, false);
    assert.equal(noop.noop, true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("partial add and remove enumerate exact readback and scoped recovery without rollback claims", async () => {
  const f = await fixture();
  try {
    const partialAdd: LifecycleRunner = async ({ plan }) => {
      const first = plan.projections[0];
      await cp(join(f.source, "skills", "workspace-governance"), first.path, { recursive: true });
      return { status: 1, stdout: "", stderr: "synthetic partial add" };
    };
    const add = await runSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent", "claude-code"], scope: "project", cwd: f.project, env: envFor(f.home), yes: true }, partialAdd);
    assert.equal(add.ok, false);
    assert.deepEqual(add.projections.map((p) => [p.agent, p.readback]), [["hermes-agent", "matching"], ["claude-code", "absent"]]);
    assert.match(add.recoveryCommands.join("\n"), /--agent hermes-agent/);
    assert.match(add.recoveryCommands.join("\n"), /--agent claude-code/);
    assert.equal(JSON.stringify(add).includes("rollback"), false);

    await rm(join(f.project, ".hermes", "skills", "workspace-governance"), { recursive: true, force: true });
    const fullAdd: LifecycleRunner = async ({ plan }) => {
      for (const projection of plan.projections) {
        await cp(join(f.source, "skills", "workspace-governance"), projection.path, { recursive: true });
      }
      return { status: 0, stdout: "[]", stderr: "" };
    };
    const complete = await runSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent", "claude-code"], scope: "project", cwd: f.project, env: envFor(f.home), yes: true }, fullAdd);
    assert.equal(complete.ok, true);
    const partialRemove: LifecycleRunner = async ({ plan }) => {
      await rm(plan.projections[0].path, { recursive: true, force: true });
      return { status: 1, stdout: "", stderr: "synthetic partial remove" };
    };
    const remove = await runSkillLifecycle({ action: "remove", source: f.source, ref: f.ref, agents: ["hermes-agent", "claude-code"], scope: "project", cwd: f.project, env: envFor(f.home), yes: true }, partialRemove);
    assert.equal(remove.ok, false);
    assert.deepEqual(remove.projections.map((p) => [p.agent, p.readback]), [["hermes-agent", "absent"], ["claude-code", "matching"]]);
    assert.ok(remove.recoveryCommands.every((command) => command.includes("skills@1.7.0 remove") && command.includes("--agent")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("runner exceptions return sanitized exact partial add and remove readback", async () => {
  const f = await fixture();
  const unrelated = join(f.project, "unrelated.txt");
  try {
    await writeFile(unrelated, "preserve me\n");
    const options = { source: f.source, ref: f.ref, agents: ["hermes-agent", "claude-code"], scope: "project" as const, cwd: f.project, env: envFor(f.home), yes: true };
    const add = await runSkillLifecycle({ ...options, action: "add" }, async ({ plan }) => {
      await cp(join(f.source, "skills", "workspace-governance"), plan.projections[0].path, { recursive: true });
      throw new Error("credential=top-secret synthetic add rejection");
    });
    assert.equal(add.ok, false);
    assert.equal(add.exitStatus, 1);
    assert.equal(add.failureCode, "TOOL_FAILURE");
    assert.match(add.installerStderr, /failed to start or complete/i);
    assert.doesNotMatch(add.installerStderr, /top-secret|credential/);
    assert.deepEqual(add.projections.map((p) => [p.agent, p.readback]), [["hermes-agent", "matching"], ["claude-code", "absent"]]);
    assert.deepEqual(add.changed.map((p) => p.agent), ["hermes-agent"]);
    assert.deepEqual(add.unchanged.map((p) => [p.agent, p.state]), [["claude-code", "absent"]]);
    assert.equal(add.recoveryCommands.length, 2);

    await rm(join(f.project, ".hermes", "skills", "workspace-governance"), { recursive: true, force: true });
    const installed = await runSkillLifecycle({ ...options, action: "add" }, async ({ plan }) => {
      for (const projection of plan.projections) await cp(join(f.source, "skills", "workspace-governance"), projection.path, { recursive: true });
      return { status: 0, stdout: "", stderr: "" };
    });
    assert.equal(installed.ok, true);
    const remove = await runSkillLifecycle({ ...options, action: "remove" }, async ({ plan }) => {
      await rm(plan.projections[0].path, { recursive: true, force: true });
      throw new Error("token=remove-secret synthetic remove rejection");
    });
    assert.equal(remove.ok, false);
    assert.equal(remove.failureCode, "TOOL_FAILURE");
    assert.doesNotMatch(remove.installerStderr, /remove-secret|token=/);
    assert.deepEqual(remove.projections.map((p) => [p.agent, p.readback]), [["hermes-agent", "absent"], ["claude-code", "matching"]]);
    assert.deepEqual(remove.changed.map((p) => p.agent), ["hermes-agent"]);
    assert.deepEqual(remove.unchanged.map((p) => [p.agent, p.state]), [["claude-code", "matching"]]);
    assert.ok(remove.recoveryCommands.every((command) => command.includes("--agent claude-code")));
    assert.equal(await readFile(unrelated, "utf8"), "preserve me\n");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("receipt ancestors refuse project and global scope escapes before installer", async () => {
  for (const scope of ["project", "global"] as const) {
    const f = await fixture();
    try {
      const base = scope === "project" ? f.project : f.home;
      const outside = join(f.root, "outside");
      await mkdir(outside);
      await mkdir(join(base, ".agents"), { recursive: true });
      await symlink(outside, join(base, ".agents", "skill-receipts"));
      let invoked = false;
      await assert.rejects(runSkillLifecycle({ action: "add", source: f.source, ref: f.ref, agents: ["hermes-agent"], scope, cwd: f.project, env: envFor(f.home), yes: true }, async () => {
        invoked = true;
        return { status: 0, stdout: "", stderr: "" };
      }), (error: any) => error.code === "SKILL_CONFLICT");
      assert.equal(invoked, false);
      await assert.rejects(readFile(join(outside, "workspace-governance.json")), { code: "ENOENT" });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("runner receipt ancestor replacement reports incomplete add and remove without outside mutation", async () => {
  for (const scope of ["project", "global"] as const) {
    const f = await fixture();
    try {
      const base = scope === "project" ? f.project : f.home;
      const receiptDirectory = join(base, ".agents", "skill-receipts");
      const outside = join(f.root, "outside");
      await mkdir(outside);
      const options = { source: f.source, ref: f.ref, agents: ["hermes-agent"], scope, cwd: f.project, env: envFor(f.home), yes: true };
      const escapedAdd = await runSkillLifecycle({ ...options, action: "add" }, async ({ plan }) => {
        await cp(join(f.source, "skills", "workspace-governance"), plan.projections[0].path, { recursive: true });
        await mkdir(join(base, ".agents"), { recursive: true });
        await symlink(outside, receiptDirectory);
        return { status: 0, stdout: "", stderr: "" };
      });
      assert.equal(escapedAdd.ok, false);
      assert.equal(escapedAdd.failureCode, "ACTION_FAILED");
      assert.equal(escapedAdd.projections[0].readback, "matching");
      await assert.rejects(readFile(join(outside, "workspace-governance.json")), { code: "ENOENT" });

      await rm(receiptDirectory, { force: true });
      await rm(escapedAdd.projections[0].path, { recursive: true, force: true });
      const installed = await runSkillLifecycle({ ...options, action: "add" }, async ({ plan }) => {
        await cp(join(f.source, "skills", "workspace-governance"), plan.projections[0].path, { recursive: true });
        return { status: 0, stdout: "", stderr: "" };
      });
      assert.equal(installed.ok, true);
      const remove = await runSkillLifecycle({ ...options, action: "remove" }, async ({ plan }) => {
        await rm(plan.projections[0].path, { recursive: true, force: true });
        await rm(receiptDirectory, { recursive: true, force: true });
        await symlink(outside, receiptDirectory);
        return { status: 0, stdout: "", stderr: "" };
      });
      assert.equal(remove.ok, false);
      assert.equal(remove.failureCode, "ACTION_FAILED");
      await assert.rejects(readFile(join(outside, "workspace-governance.json")), { code: "ENOENT" });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("concurrent receipt winners are preserved during add and remove", async () => {
  const f = await fixture();
  const winner = "foreign concurrent receipt winner\n";
  try {
    const options = { source: f.source, ref: f.ref, agents: ["hermes-agent"], scope: "project" as const, cwd: f.project, env: envFor(f.home), yes: true };
    const added = await runSkillLifecycle({ ...options, action: "add" }, async ({ plan }) => {
      await cp(join(f.source, "skills", "workspace-governance"), plan.projections[0].path, { recursive: true });
      await mkdir(join(f.project, ".agents", "skill-receipts"), { recursive: true });
      await writeFile(plan.receiptPath, winner);
      return { status: 0, stdout: "", stderr: "" };
    });
    assert.equal(added.ok, false);
    assert.equal(await readFile(added.receiptPath, "utf8"), winner);

    await rm(added.receiptPath, { force: true });
    await rm(added.projections[0].path, { recursive: true, force: true });
    const installed = await runSkillLifecycle({ ...options, action: "add" }, async ({ plan }) => {
      await cp(join(f.source, "skills", "workspace-governance"), plan.projections[0].path, { recursive: true });
      return { status: 0, stdout: "", stderr: "" };
    });
    assert.equal(installed.ok, true);
    const removed = await runSkillLifecycle({ ...options, action: "remove" }, async ({ plan }) => {
      await rm(plan.projections[0].path, { recursive: true, force: true });
      await writeFile(plan.receiptPath, winner);
      return { status: 0, stdout: "", stderr: "" };
    });
    assert.equal(removed.ok, false);
    assert.equal(await readFile(removed.receiptPath, "utf8"), winner);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
