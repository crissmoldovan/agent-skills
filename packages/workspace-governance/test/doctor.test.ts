import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNodeVersion, diagnose, renderDoctorText } from "../src/doctor.ts";

test("doctor runtime check enforces the Node 24 major-version floor", () => {
  assert.deepEqual(checkNodeVersion("24.0.0"), {
    id: "runtime",
    status: "pass",
    actual: "24.0.0",
    required: ">=24.0.0",
  });
  const old = checkNodeVersion("23.11.1");
  assert.equal(old.id, "runtime");
  assert.equal(old.status, "fail");
  assert.equal(old.actual, "23.11.1");
  assert.equal(old.required, ">=24.0.0");
  assert.match(String(old.remedy), /Node\.js 24 or newer/);
});

test("doctor verifies a launcher installation against its recorded paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl doctor install-"));
  try {
    const prefix = join(root, "versions", "0.3.0");
    const launcher = join(root, "bin", "workspacectl");
    const cliPath = join(
      prefix,
      "lib",
      "node_modules",
      "@crissmoldovan",
      "workspace-governance",
      "dist",
      "cli.js",
    );
    const config = join(root, "config.yaml");
    const skill = join(root, "SKILL.md");
    await mkdir(join(prefix, "lib", "node_modules", "@crissmoldovan", "workspace-governance", "dist"), {
      recursive: true,
    });
    await mkdir(join(root, "bin"));
    await writeFile(cliPath, "#!/usr/bin/env node\n", { mode: 0o755 });
    await writeFile(
      launcher,
      "#!/bin/sh\n# workspacectl-managed-launcher-v1\nexit 0\n",
      { mode: 0o755 },
    );
    await writeFile(config, "schemaVersion: 2\n", { mode: 0o600 });
    await writeFile(
      skill,
      "---\nname: workspace-governance\nversion: 0.3.0\n---\n# Workspaces\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(prefix, ".workspacectl-install.json"),
      JSON.stringify({
        schemaVersion: 1,
        package: "@crissmoldovan/workspace-governance",
        version: "0.3.0",
        prefix,
        launcher,
        runtime: process.execPath,
      }),
      { mode: 0o600 },
    );
    const diagnosis = await diagnose({
      configPath: config,
      skillPath: skill,
      cliPath,
      env: {
        ...process.env,
        WORKSPACECTL_INSTALL_PREFIX: prefix,
        WORKSPACECTL_LAUNCHER: launcher,
        WORKSPACECTL_RUNTIME_PATH: process.execPath,
      },
    });
    const install = diagnosis.checks.find((check) => check.id === "install");
    assert.deepEqual(install, {
      id: "install",
      status: "pass",
      version: "0.3.0",
      prefix,
      launcher,
      runtime: process.execPath,
      cliPath,
    });
    const text = renderDoctorText(diagnosis);
    assert.ok(text.includes(prefix));
    assert.ok(text.includes(launcher));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor recognizes the managed MCP launcher and entrypoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspacectl doctor managed-mcp-"));
  try {
    const version = "0.3.0";
    const prefix = join(root, "managed");
    const versionRoot = join(prefix, "versions", version);
    const packageRoot = join(versionRoot, "lib", "node_modules", "@crissmoldovan", "workspace-governance");
    const binDir = join(root, "bin");
    const launcher = join(binDir, "workspacectl-mcp");
    const cliLauncher = join(binDir, "workspacectl");
    const shadowDir = join(root, "shadow-bin");
    const shadow = join(shadowDir, "workspacectl");
    const cliPath = join(packageRoot, "dist", "mcp-cli.js");
    await mkdir(join(packageRoot, "dist"), { recursive: true });
    await mkdir(binDir);
    await mkdir(shadowDir);
    await writeFile(shadow, "#!/bin/sh\necho 0.1.0\n", { mode: 0o755 });
    await writeFile(cliPath, "#!/usr/bin/env node\n", { mode: 0o755 });
    const launcherBytes = Buffer.from("#!/bin/sh\n# workspacectl-managed-launcher-v2\nexit 0\n");
    await writeFile(launcher, launcherBytes, { mode: 0o755 });
    await writeFile(cliLauncher, launcherBytes, { mode: 0o755 });
    await writeFile(join(prefix, "manager-receipt.json"), JSON.stringify({
      schemaVersion: 2,
      package: "@crissmoldovan/workspace-governance",
      activeVersion: version,
      versions: { [version]: { root: versionRoot } },
      launchers: {
        workspacectl: {
          path: cliLauncher,
          targetVersion: version,
          sha256: createHash("sha256").update(launcherBytes).digest("hex"),
        },
        "workspacectl-mcp": {
          path: launcher,
          targetVersion: version,
          sha256: createHash("sha256").update(launcherBytes).digest("hex"),
        },
      },
    }));
    const diagnosis = await diagnose({
      cliPath,
      standalone: true,
      configPath: join(root, "missing-config.json"),
      env: {
        ...process.env,
        PATH: `${shadowDir}:${process.env.PATH ?? ""}`,
        WORKSPACECTL_INSTALL_PREFIX: prefix,
        WORKSPACECTL_LAUNCHER: launcher,
        WORKSPACECTL_RUNTIME_PATH: process.execPath,
      },
    });
    assert.equal(diagnosis.checks.find(check => check.id === "install")?.status, "pass");
    const pathCheck = diagnosis.checks.find(check => check.id === "path-launcher");
    assert.equal(pathCheck?.status, "shadowed");
    assert.equal(pathCheck?.actual, shadow);
    assert.match(String(pathCheck?.remedy), /PATH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
