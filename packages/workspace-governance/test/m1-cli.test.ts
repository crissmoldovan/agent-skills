import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { example } from "./fixtures.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

async function snapshotPath(path: string): Promise<unknown> {
  try {
    const status = await lstat(path);
    const mode = status.mode & 0o7777;
    if (status.isSymbolicLink()) return { kind: "symlink", mode, target: await readlink(path) };
    if (status.isDirectory()) {
      const entries: Record<string, unknown> = {};
      for (const name of (await readdir(path)).sort()) entries[name] = await snapshotPath(join(path, name));
      return { kind: "directory", mode, entries };
    }
    if (status.isFile()) return { kind: "file", mode, bytes: (await readFile(path)).toString("base64") };
    return { kind: "other", mode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function createV2Setup(root: string, config: string): Promise<void> {
  const data = join(root, "v2-data");
  const state = join(root, "v2-state");
  const plans = join(root, "v2-plans");
  const trusted = join(root, "v2-workspaces");
  await Promise.all([data, state, plans, trusted].map((path) => mkdir(path)));
  const plan = join(plans, "init.json");
  const preview = run(
    "init",
    "--config",
    config,
    "--catalog",
    join(data, "catalog.json"),
    "--state",
    join(state, "local-state.json"),
    "--plans-dir",
    plans,
    "--trusted-root",
    trusted,
    "--plan",
    plan,
    "--json",
  );
  assert.equal(preview.status, 0, preview.stderr);
  const planId = JSON.parse(preview.stdout).plan.id;
  const applied = run(
    "apply",
    "--config",
    config,
    "--plan",
    plan,
    "--approve",
    planId,
    "--json",
  );
  assert.equal(applied.status, 0, applied.stderr);
}

test("M2/A05 help retains the labelled M1 read-only surface", () => {
  for (const args of [[], ["help"], ["--help"]]) {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^workspacectl 0\.2\.0 — Workspaces M2\/A05/m);
    for (const command of ["discover --config", "list", "report", "audit"])
      assert.ok(result.stdout.includes(command), command);
    assert.match(result.stdout, /doctor \[--standalone\] \[--config FILE\] \[--skill FILE\] \[--json\]/);
    assert.match(result.stdout, /Legacy read-only engine:/);
    assert.match(result.stdout, /advisory, not authentication/i);
    assert.match(result.stdout, /inert/i);
    for (const retired of [
      "manifest-init-plan",
      "manifest-init-trial-plan",
      "mutation-status",
      "controller",
      "ledger",
      "recovery",
    ]) assert.equal(result.stdout.includes(retired), false, retired);
    for (const premature of ["  checkout REPO"])
      assert.equal(result.stdout.includes(premature), false, premature);
  }
  assert.equal(run("version").stdout.trim(), "0.2.0");
  assert.equal(run("--version").stdout.trim(), "0.2.0");
});

test("M1 package metadata and CLI report the same v0.2 release", async () => {
  const metadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(metadata.name, "@crissmoldovan/workspace-governance");
  assert.equal(metadata.version, "0.2.0");
  assert.equal(metadata.private, true);
  assert.equal(run("--version").stdout.trim(), metadata.version);
});

test("M1 shell refuses removed and unknown commands in text or JSON", () => {
  for (const command of [
    "manifest-init-plan",
    "manifest-init-trial-plan",
    "mutation-status",
    "unknown-command",
  ]) {
    const text = run(command);
    assert.equal(text.status, 2);
    assert.equal(text.stdout, "");
    assert.equal(text.stderr, "Error [UNSUPPORTED]: Command is unsupported.\n");

    const json = run(command, "--json");
    assert.equal(json.status, 2);
    assert.equal(json.stdout, "");
    assert.deepEqual(JSON.parse(json.stderr), {
      ok: false,
      error: { code: "UNSUPPORTED", message: "Command is unsupported." },
    });
  }
});

test("doctor JSON reports the selected missing config without claiming readiness", async () => {
  const home = await mkdtemp(join(tmpdir(), "workspacectl doctor home with spaces-"));
  try {
    const xdg = join(home, "xdg config");
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg };
    delete env.WORKSPACECTL_CONFIG;
    delete env.WORKSPACECTL_SKILL;
    const result = spawnSync(process.execPath, [cli, "doctor", "--json"], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, "");
    const diagnosis = JSON.parse(result.stdout);
    assert.equal(diagnosis.ok, false);
    assert.equal(diagnosis.command, "doctor");
    assert.equal(diagnosis.cliVersion, "0.2.0");
    assert.equal(diagnosis.milestone, "M2/A03");
    assert.equal(diagnosis.ready, false);
    assert.deepEqual(diagnosis.selected.config, {
      path: join(xdg, "workspacectl", "config.yaml"),
      source: "xdg",
    });
    assert.deepEqual(diagnosis.selected.skill, {
      path: join(home, ".hermes", "skills", "workspace-governance", "SKILL.md"),
      source: "default",
    });
    const checks = Object.fromEntries(
      diagnosis.checks.map((check: { id: string }) => [check.id, check]),
    );
    assert.equal(checks.runtime.status, "pass");
    assert.equal(checks.install.status, "source");
    assert.equal(checks.git.status, "pass");
    assert.equal(checks.config.status, "missing");
    assert.equal(checks.config.validated, false);
    assert.equal(checks.skill.status, "missing");
    assert.equal(checks["trusted-roots"].status, "blocked");
    assert.equal(checks.store.status, "blocked");
    assert.deepEqual(diagnosis.error.code, "NOT_CONFIGURED");
    assert.match(diagnosis.error.details.remedies.join("\n"), /Run workspacectl init/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("invalid doctor input is rejected before any prerequisite probe", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl invalid doctor-"));
  try {
    const bin = join(root, "bin");
    const sentinel = join(root, "git-ran");
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh\n: > ${JSON.stringify(sentinel)}\nprintf 'git version synthetic\\n'\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [cli, "doctor", "--config", "", "--json"],
      { encoding: "utf8", env: { ...process.env, HOME: root, PATH: bin } },
    );
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: { code: "INVALID_CONFIG", message: "Invalid doctor invocation." },
    });
    await assert.rejects(access(sentinel), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor rejects invalid standalone flag combinations before any prerequisite probe", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl conflicting doctor-"));
  try {
    const bin = join(root, "bin");
    const sentinel = join(root, "git-ran");
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh\n: > ${JSON.stringify(sentinel)}\nprintf 'git version synthetic\\n'\n`,
      { mode: 0o755 },
    );
    for (const args of [
      ["--standalone", "--skill", join(root, "SKILL.md")],
      ["--skill", join(root, "SKILL.md"), "--standalone"],
      ["--standalone", "--standalone"],
      ["--standalone", "--unknown"],
    ]) {
      await rm(sentinel, { force: true });
      const result = spawnSync(
        process.execPath,
        [cli, "doctor", ...args, "--json"],
        { encoding: "utf8", env: { ...process.env, HOME: root, PATH: bin } },
      );
      assert.equal(result.status, 2, args.join(" "));
      assert.equal(result.stdout, "");
      assert.deepEqual(JSON.parse(result.stderr), {
        ok: false,
        error: { code: "INVALID_CONFIG", message: "Invalid doctor invocation." },
      });
      await assert.rejects(access(sentinel), { code: "ENOENT" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor rejects a malformed selected v2 config without claiming readiness", async () => {
  const home = await mkdtemp(join(tmpdir(), "workspacectl configured home-"));
  try {
    const explicitConfig = join(home, "chosen config", "config.yaml");
    const explicitSkill = join(home, "chosen skill", "SKILL.md");
    await mkdir(join(home, "chosen config"), { recursive: true });
    await mkdir(join(home, "chosen skill"), { recursive: true });
    await writeFile(explicitConfig, "schemaVersion: 2\n", { mode: 0o600 });
    await writeFile(
      explicitSkill,
      "---\nname: workspace-governance\nversion: 0.2.0\n---\n# Workspaces\n",
      { mode: 0o600 },
    );
    const env = {
      ...process.env,
      HOME: home,
      WORKSPACECTL_CONFIG: join(home, "ignored environment config.yaml"),
      WORKSPACECTL_SKILL: join(home, "ignored environment skill.md"),
    };
    const result = spawnSync(process.execPath, [
      cli,
      "doctor",
      "--config",
      explicitConfig,
      "--skill",
      explicitSkill,
      "--json",
    ], { encoding: "utf8", env });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, "");
    const diagnosis = JSON.parse(result.stdout);
    assert.deepEqual(diagnosis.selected.config, {
      path: explicitConfig,
      source: "cli",
    });
    assert.deepEqual(diagnosis.selected.skill, {
      path: explicitSkill,
      source: "cli",
    });
    const checks = Object.fromEntries(
      diagnosis.checks.map((check: { id: string }) => [check.id, check]),
    );
    assert.equal(checks.config.status, "invalid");
    assert.equal(checks.config.validated, false);
    assert.equal(checks.config.code, "INVALID_CONFIG");
    assert.deepEqual(checks.skill, {
      id: "skill",
      status: "pass",
      path: explicitSkill,
      version: "0.2.0",
    });
    assert.equal(diagnosis.ready, false);
    assert.equal(diagnosis.error.code, "INVALID_CONFIG");
    assert.match(diagnosis.error.message, /invalid or incomplete/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("doctor standalone reports CLI-only readiness without selecting or reading an agent skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl standalone doctor-"));
  try {
    const home = join(root, "fresh-home");
    const config = join(home, ".config", "workspacectl", "config.yaml");
    await mkdir(join(home, ".config", "workspacectl"), { recursive: true });
    await createV2Setup(home, config);
    const mismatchedSkill = join(root, "ambient-mismatched-skill.md");
    await writeFile(mismatchedSkill, "---\nname: workspace-governance\nversion: 0.1.0\n---\n# Legacy\n");

    const baseEnv: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete baseEnv.XDG_CONFIG_HOME;
    delete baseEnv.WORKSPACECTL_CONFIG;
    delete baseEnv.WORKSPACECTL_SKILL;
    delete baseEnv.WORKSPACECTL_INSTALL_PREFIX;
    delete baseEnv.WORKSPACECTL_LAUNCHER;
    delete baseEnv.WORKSPACECTL_RUNTIME_PATH;
    const before = await snapshotPath(root);
    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env: baseEnv });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /doctor \[--standalone\] \[--config FILE\] \[--skill FILE\] \[--json\]/);

    const integrated = spawnSync(process.execPath, [cli, "doctor", "--json"], { encoding: "utf8", env: baseEnv });
    assert.equal(integrated.status, 3, integrated.stderr);
    const integratedBody = JSON.parse(integrated.stdout);
    assert.equal(integratedBody.ready, false);
    assert.equal(integratedBody.readinessScope, "integration");
    assert.equal(integratedBody.error.code, "INCOMPLETE");
    assert.equal(integratedBody.checks.find((check: any) => check.id === "skill").status, "missing");

    const standaloneEnv = { ...baseEnv, WORKSPACECTL_SKILL: mismatchedSkill };
    const standalone = spawnSync(process.execPath, [cli, "doctor", "--standalone", "--json"], { encoding: "utf8", env: standaloneEnv });
    assert.equal(standalone.status, 0, standalone.stderr);
    assert.equal(standalone.stderr, "");
    const standaloneBody = JSON.parse(standalone.stdout);
    assert.equal(standaloneBody.ok, true);
    assert.equal(standaloneBody.ready, true);
    assert.equal(standaloneBody.readinessScope, "standalone");
    assert.equal(standaloneBody.selected.skill, null);
    assert.deepEqual(standaloneBody.checks.find((check: any) => check.id === "skill"), {
      id: "skill",
      status: "skipped",
      required: false,
      reason: "Agent skill integration is not required in standalone mode.",
    });
    for (const id of ["runtime", "git", "config", "trusted-roots", "catalog", "local-state", "store"])
      assert.equal(standaloneBody.checks.find((check: any) => check.id === id).status, "pass", id);
    assert.equal(standaloneBody.checks.find((check: any) => check.id === "install").status, "source");

    const text = spawnSync(process.execPath, [cli, "doctor", "--standalone"], { encoding: "utf8", env: standaloneEnv });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Readiness scope: standalone CLI/);
    assert.match(text.stdout, /Selected skill: not required/);
    assert.match(text.stdout, /\[SKIPPED\] skill — not required/);

    const invalidInstall = spawnSync(process.execPath, [cli, "doctor", "--standalone", "--json"], {
      encoding: "utf8",
      env: { ...standaloneEnv, WORKSPACECTL_INSTALL_PREFIX: join(root, "invalid-install") },
    });
    assert.equal(invalidInstall.status, 3, invalidInstall.stderr);
    const invalidInstallBody = JSON.parse(invalidInstall.stdout);
    assert.equal(invalidInstallBody.ready, false);
    assert.equal(invalidInstallBody.error.code, "INCOMPLETE");
    assert.equal(invalidInstallBody.error.message, "The CLI installation does not match the selected setup.");
    assert.equal(invalidInstallBody.checks.find((check: any) => check.id === "install").status, "invalid");
    assert.equal(invalidInstallBody.checks.find((check: any) => check.id === "skill").status, "skipped");

    const explicitIntegration = spawnSync(process.execPath, [cli, "doctor", "--skill", mismatchedSkill, "--json"], { encoding: "utf8", env: baseEnv });
    assert.equal(explicitIntegration.status, 3, explicitIntegration.stderr);
    const explicitBody = JSON.parse(explicitIntegration.stdout);
    assert.equal(explicitBody.ready, false);
    assert.equal(explicitBody.error.code, "INCOMPLETE");
    assert.equal(explicitBody.checks.find((check: any) => check.id === "skill").status, "mismatch");
    const integrationText = spawnSync(process.execPath, [cli, "doctor", "--skill", mismatchedSkill], { encoding: "utf8", env: baseEnv });
    assert.equal(integrationText.status, 3, integrationText.stderr);
    assert.match(integrationText.stdout, /Readiness scope: CLI \+ agent skill integration/);
    assert.deepEqual(await snapshotPath(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor standalone refuses malformed config without selecting an ambient agent skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl malformed standalone doctor-"));
  try {
    const config = join(root, "config.yaml");
    await writeFile(config, "schemaVersion: 2\n", { mode: 0o600 });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      WORKSPACECTL_SKILL: join(root, "must-not-be-read", "SKILL.md"),
    };
    delete env.XDG_CONFIG_HOME;
    delete env.WORKSPACECTL_CONFIG;
    delete env.WORKSPACECTL_INSTALL_PREFIX;
    delete env.WORKSPACECTL_LAUNCHER;
    delete env.WORKSPACECTL_RUNTIME_PATH;
    const before = await snapshotPath(root);

    const result = spawnSync(process.execPath, [cli, "doctor", "--standalone", "--config", config, "--json"], {
      encoding: "utf8",
      env,
    });

    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, "");
    const diagnosis = JSON.parse(result.stdout);
    assert.equal(diagnosis.readinessScope, "standalone");
    assert.equal(diagnosis.selected.skill, null);
    assert.equal(diagnosis.checks.find((check: any) => check.id === "config").status, "invalid");
    assert.deepEqual(diagnosis.checks.find((check: any) => check.id === "skill"), {
      id: "skill",
      status: "skipped",
      required: false,
      reason: "Agent skill integration is not required in standalone mode.",
    });
    assert.equal(diagnosis.error.code, "INVALID_CONFIG");
    assert.deepEqual(await snapshotPath(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor standalone keeps configured resource checks mandatory and nonmutating", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl standalone resources-"));
  try {
    for (const resource of ["catalog", "local-state", "trusted-roots"] as const) {
      const home = join(root, resource);
      await mkdir(home);
      const config = join(home, "config.yaml");
      await createV2Setup(home, config);
      const target = resource === "catalog"
        ? join(home, "v2-data", "catalog.json")
        : resource === "local-state"
          ? join(home, "v2-state", "local-state.json")
          : join(home, "v2-workspaces");
      await rm(target, { recursive: true, force: true });
      const before = await snapshotPath(home);
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
      delete env.XDG_CONFIG_HOME;
      delete env.WORKSPACECTL_CONFIG;
      delete env.WORKSPACECTL_SKILL;
      delete env.WORKSPACECTL_INSTALL_PREFIX;
      delete env.WORKSPACECTL_LAUNCHER;
      delete env.WORKSPACECTL_RUNTIME_PATH;

      const result = spawnSync(process.execPath, [cli, "doctor", "--standalone", "--config", config, "--json"], {
        encoding: "utf8",
        env,
      });

      assert.equal(result.status, 2, `${resource}: ${result.stderr}`);
      assert.equal(result.stderr, "");
      const diagnosis = JSON.parse(result.stdout);
      assert.equal(diagnosis.ready, false);
      assert.equal(diagnosis.error.code, "INVALID_CONFIG");
      assert.equal(
        diagnosis.checks.find((check: any) => check.id === resource).status,
        resource === "trusted-roots" ? "invalid" : "missing",
      );
      assert.equal(diagnosis.checks.find((check: any) => check.id === "skill").status, "skipped");
      assert.deepEqual(await snapshotPath(home), before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor text is the default and carries the same incomplete setup facts", async () => {
  const home = await mkdtemp(join(tmpdir(), "workspacectl text doctor-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.XDG_CONFIG_HOME;
    delete env.WORKSPACECTL_CONFIG;
    delete env.WORKSPACECTL_SKILL;
    const result = spawnSync(process.execPath, [cli, "doctor"], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^Workspaces doctor — workspacectl 0\.2\.0/m);
    assert.match(result.stdout, /Ready: no \(NOT_CONFIGURED\)/);
    assert.match(result.stdout, /\[PASS\] runtime/);
    assert.match(result.stdout, /\[PASS\] git/);
    assert.match(result.stdout, /\[MISSING\] config/);
    assert.match(result.stdout, /\[BLOCKED\] trusted-roots/);
    assert.match(result.stdout, /Run workspacectl init/);
    assert.throws(() => JSON.parse(result.stdout));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("doctor reports missing Git as an actionable prerequisite failure", async () => {
  const home = await mkdtemp(join(tmpdir(), "workspacectl no git-"));
  try {
    const emptyPath = join(home, "empty path");
    await mkdir(emptyPath);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: emptyPath };
    delete env.XDG_CONFIG_HOME;
    delete env.WORKSPACECTL_CONFIG;
    delete env.WORKSPACECTL_SKILL;
    const result = spawnSync(process.execPath, [cli, "doctor", "--json"], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 6, result.stderr);
    assert.equal(result.stderr, "");
    const diagnosis = JSON.parse(result.stdout);
    const git = diagnosis.checks.find((check: { id: string }) => check.id === "git");
    assert.equal(git.status, "missing");
    assert.match(git.remedy, /Install Git separately/);
    assert.equal(diagnosis.error.code, "ACTION_FAILED");
    assert.match(diagnosis.error.details.remedies.join("\n"), /trusted git executable/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("doctor identifies a mismatched installed skill version", async () => {
  const home = await mkdtemp(join(tmpdir(), "workspacectl skill mismatch-"));
  try {
    const config = join(home, "config.yaml");
    const skill = join(home, "SKILL.md");
    await createV2Setup(home, config);
    await writeFile(
      skill,
      "---\nname: workspace-governance\nversion: 0.1.0\n---\n# Legacy\n",
      { mode: 0o600 },
    );
    const result = spawnSync(process.execPath, [
      cli,
      "doctor",
      "--config",
      config,
      "--skill",
      skill,
      "--json",
    ], { encoding: "utf8", env: { ...process.env, HOME: home } });
    assert.equal(result.status, 3, result.stderr);
    const diagnosis = JSON.parse(result.stdout);
    const check = diagnosis.checks.find((entry: { id: string }) => entry.id === "skill");
    assert.equal(check.status, "mismatch");
    assert.equal(check.version, "0.1.0");
    assert.equal(check.expectedVersion, "0.2.0");
    assert.match(check.remedy, /v0\.2\.0/);
    assert.equal(diagnosis.error.code, "INCOMPLETE");
    assert.match(diagnosis.error.details.remedies.join("\n"), /workspace-governance skill v0\.2\.0/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("doctor ignores skill identity examples outside YAML frontmatter", async () => {
  const home = await mkdtemp(join(tmpdir(), "workspacectl skill body example-"));
  try {
    const config = join(home, "config.yaml");
    const skill = join(home, "SKILL.md");
    await createV2Setup(home, config);
    await writeFile(
      skill,
      "# Synthetic documentation, not a valid skill header\n\n```yaml\nname: workspace-governance\nversion: 0.2.0\n```\n",
      { mode: 0o600 },
    );
    const result = spawnSync(process.execPath, [
      cli,
      "doctor",
      "--config",
      config,
      "--skill",
      skill,
      "--json",
    ], { encoding: "utf8", env: { ...process.env, HOME: home } });
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stderr, "");
    const diagnosis = JSON.parse(result.stdout);
    const check = diagnosis.checks.find((entry: { id: string }) => entry.id === "skill");
    assert.deepEqual(check, {
      id: "skill",
      status: "invalid",
      path: skill,
      expectedVersion: "0.2.0",
      remedy: "Install workspace-governance skill v0.2.0 separately at the selected path or pass --skill FILE.",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("retained read-only data uses text by default and JSON only when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl legacy output-"));
  try {
    const manifest = join(root, "manifest.json");
    await writeFile(manifest, JSON.stringify(example()), { mode: 0o600 });

    const text = run("validate", "--manifest", manifest);
    assert.equal(text.status, 0, text.stderr);
    assert.equal(text.stderr, "");
    assert.match(text.stdout, /^Legacy read-only result: validate/m);
    assert.match(text.stdout, /^valid: true$/m);
    assert.throws(() => JSON.parse(text.stdout));

    const json = run("validate", "--manifest", manifest, "--json");
    assert.equal(json.status, 0, json.stderr);
    assert.equal(json.stderr, "");
    assert.equal(JSON.parse(json.stdout).valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
