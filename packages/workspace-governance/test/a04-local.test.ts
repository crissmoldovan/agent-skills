import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverLocal } from "../src/discovery.ts";
import { scratchRoot } from "./fixtures.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", [
    "-c", "user.name=Synthetic A04",
    "-c", "user.email=synthetic-a04@example.invalid",
    ...args,
  ], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function committedRepository(path: string, remote: string): Promise<void> {
  await mkdir(path);
  git(path, "init", "--initial-branch=main");
  git(path, "remote", "add", "origin", remote);
  await writeFile(join(path, "tracked.txt"), "synthetic fixture\n");
  git(path, "add", "tracked.txt");
  git(path, "commit", "-m", "synthetic fixture");
}

test("A04 one unsafe synthetic checkout does not erase a safe sibling observation", async () => {
  const root = await scratchRoot("workspacectl-a04-local-");
  try {
    const safe = join(root, "safe");
    const unsafe = join(root, "unsafe");
    const sentinel = join(root, "FILTER-RAN");
    await committedRepository(safe, "https://github.com/Synthetic-Org/safe");
    await committedRepository(unsafe, "https://github.com/Synthetic-Org/unsafe");
    git(unsafe, "config", "filter.fixture.clean", `touch '${sentinel}'; cat`);

    const before = {
      safeHead: await readFile(join(safe, ".git", "HEAD")),
      safeIndex: await readFile(join(safe, ".git", "index")),
      safeFile: await readFile(join(safe, "tracked.txt")),
      unsafeHead: await readFile(join(unsafe, ".git", "HEAD")),
      unsafeIndex: await readFile(join(unsafe, ".git", "index")),
      unsafeFile: await readFile(join(unsafe, "tracked.txt")),
    };

    const inventory = await discoverLocal(root);
    assert.equal(inventory.complete, false);
    assert.deepEqual(
      inventory.repositories.map((repository) => repository.path),
      [safe],
    );
    assert.deepEqual(inventory.errors, [{
      code: "GIT_METADATA_OR_STATUS",
      target: unsafe,
    }]);
    await assert.rejects(access(sentinel), { code: "ENOENT" });

    assert.deepEqual(await readFile(join(safe, ".git", "HEAD")), before.safeHead);
    assert.deepEqual(await readFile(join(safe, ".git", "index")), before.safeIndex);
    assert.deepEqual(await readFile(join(safe, "tracked.txt")), before.safeFile);
    assert.deepEqual(await readFile(join(unsafe, ".git", "HEAD")), before.unsafeHead);
    assert.deepEqual(await readFile(join(unsafe, ".git", "index")), before.unsafeIndex);
    assert.deepEqual(await readFile(join(unsafe, "tracked.txt")), before.unsafeFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
