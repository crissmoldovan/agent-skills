import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as discovery from "../src/discovery.ts";
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=example@example.com",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
test("A6 real Git read-only discovery includes dirty unborn nested and linked worktrees", async () => {
  const root = await mkdtemp(join(tmpdir(), "governance-"));
  try {
    const repo = join(root, "repo");
    await mkdir(repo);
    git(repo, "init");
    git(repo, "remote", "add", "origin", "git@github.com:Example/Api.git");
    let inv = await discovery.discoverLocal(root);
    assert.equal(inv.complete, true);
    assert.equal(inv.repositories[0].head, null);
    assert.equal(inv.repositories[0].dirty, false);
    await writeFile(join(repo, "file"), "one");
    git(repo, "add", "file");
    git(repo, "commit", "-m", "synthetic");
    const index = await readFile(join(repo, ".git", "index"));
    const sentinel = join(root, "sentinel");
    const script = join(root, "monitor.sh");
    await writeFile(
      script,
      `#!/bin/sh
touch '${sentinel}'
`,
      { mode: 0o755 },
    );
    const linked = join(root, "linked");
    git(repo, "worktree", "add", "-b", "test", linked);
    await writeFile(join(repo, "file"), "two");
    await writeFile(join(repo, "untracked"), "new");
    const nested = join(repo, "nested");
    await mkdir(nested);
    git(nested, "init");
    git(nested, "remote", "add", "origin", "https://github.com/example/nested");
    git(repo, "config", "core.fsmonitor", script);
    const prior = process.env.GIT_DIR;
    process.env.GIT_DIR = "/nonexistent-injected";
    try {
      inv = await discovery.discoverLocal(root);
    } finally {
      if (prior === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prior;
    }
    assert.equal(inv.complete, true);
    assert.equal(inv.repositories.length, 3);
    assert.equal(
      inv.repositories.find((r: any) => r.path === repo)?.dirty,
      true,
    );
    assert.equal(
      inv.repositories.find((r: any) => r.path === linked)?.worktree,
      true,
    );
    assert.deepEqual(await readFile(join(repo, ".git", "index")), index);
    await assert.rejects(() => access(sentinel));
    assert.equal(
      (await discovery.discoverLocal(root, { depth: 0 })).complete,
      false,
    );
    await symlink(repo, join(root, "alias"));
    inv = await discovery.discoverLocal(root);
    assert.ok(inv.unsafePaths.includes(join(root, "alias")));
    await assert.rejects(() => discovery.discoverLocal(join(root, "alias")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
for (const source of ["local", "include", "worktree"] as const) {
  for (const driver of ["clean", "process"] as const) {
    for (const name of ["sentinel", "sentinel\u2028driver", "sentinel\u2029driver"]) {
      test(`A6 ${source} ${driver} ${JSON.stringify(name)} filter fails closed without execution`, async () => {
        const root = await mkdtemp(join(tmpdir(), "governance-filter-"));
        try {
          const repo = join(root, "repo");
          await mkdir(repo);
          git(repo, "init");
          git(repo, "remote", "add", "origin", "https://github.com/example/api");
          await writeFile(join(repo, ".gitattributes"), `tracked filter=${name}\n`);
          await writeFile(join(repo, "tracked"), "initial\n");
          git(repo, "add", ".");
          git(repo, "commit", "-m", "synthetic");
          let checkout = repo;
          if (source === "worktree") {
            checkout = join(root, "linked");
            git(repo, "worktree", "add", "-b", "linked", checkout);
            git(repo, "config", "extensions.worktreeConfig", "true");
          }
          const sentinel = join(root, "SENTINEL");
          const command = `touch '${sentinel}'; ${driver === "clean" ? "cat" : "exit 1"}`;
          const key = `filter.${name}.${driver}`;
          if (source === "include") {
            const included = join(repo, ".git", "included.config");
            git(repo, "config", "--file", included, key, command);
            git(repo, "config", "includeIf.gitdir:" + repo + "/.git.path", included);
          } else {
            git(checkout, "config", source === "worktree" ? "--worktree" : "--local", key, command);
          }
          // Same-size content forces Git to compare bytes through the filter.
          await writeFile(join(checkout, "tracked"), "changed\n");
          const indexPath = source === "worktree"
            ? join(repo, ".git", "worktrees", "linked", "index")
            : join(repo, ".git", "index");
          const index = await readFile(indexPath);
          const inv = await discovery.discoverLocal(root);
          await assert.rejects(() => access(sentinel), { code: "ENOENT" });
          assert.equal(inv.complete, false);
          assert.deepEqual(inv.errors, [{ code: "GIT_METADATA_OR_STATUS" }]);
          assert.equal(inv.repositories.some((r) => r.path === checkout), false);
          assert.deepEqual(await readFile(indexPath), index);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
}

test("A6 external and symlink Git metadata fail closed without target diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "governance-"));
  const outside = await mkdtemp(join(tmpdir(), "governance-out-"));
  try {
    git(outside, "init");
    const repo = join(root, "repo");
    await mkdir(repo);
    await writeFile(join(repo, ".git"), `gitdir: ${join(outside, ".git")}\n`);
    const inv = await discovery.discoverLocal(root);
    assert.equal(inv.complete, false);
    assert.equal(JSON.stringify(inv.errors).includes(outside), false);
    await rm(join(repo, ".git"));
    await symlink(join(outside, ".git"), join(repo, ".git"));
    assert.equal((await discovery.discoverLocal(root)).complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
