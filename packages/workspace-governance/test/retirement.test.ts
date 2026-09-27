import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

async function assertAbsent(relativePath: string) {
  await assert.rejects(access(fileURLToPath(new URL(relativePath, new URL("../", import.meta.url)))), {
    code: "ENOENT",
  });
}

test("M1 retires the native trial controller ledger recovery closure", async () => {
  for (const path of [
    "native/setup-helper",
    "src/setup",
    "scripts/verify-effective-uid.mjs",
    "scripts/test-runner.mjs",
  ]) await assertAbsent(path);

  const cli = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const testScript = await readFile(new URL("../scripts/test.mjs", import.meta.url), "utf8");
  const metadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const retired of [
    "__workspacectlNativeTrialStartup",
    "manifestInitPlan",
    "manifestInitTrialPlan",
    "readMutationStatus",
  ]) assert.equal(cli.includes(retired), false, retired);
  assert.equal(index.includes("readMutationStatus"), false);
  assert.equal(testScript.includes("test-runner"), false);
  assert.equal(metadata.scripts["verify:effective-uid"], undefined);
  assert.equal(metadata.scripts.verify.includes("verify:effective-uid"), false);
  assert.match(packageRoot, /workspace-governance\/?$/);
});
