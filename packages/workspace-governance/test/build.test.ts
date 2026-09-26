import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("build removes stale generated files from retired source families", async () => {
  const staleDirectory = join(root, "dist", "setup");
  const stale = join(staleDirectory, "retired-controller.js");
  await mkdir(staleDirectory, { recursive: true });
  await writeFile(stale, "export const stale = true;\n");
  try {
    const result = spawnSync("npm", ["run", "build"], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(access(stale), { code: "ENOENT" });
    await access(join(root, "dist", "cli.js"));
    await access(join(root, "dist", "doctor.js"));
  } finally {
    await rm(staleDirectory, { recursive: true, force: true });
  }
});
