import test from "node:test";
import assert from "node:assert/strict";
import {
  writeFile,
  mkdir,
  rm,
  readFile,
  symlink,
} from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { devNull } from "node:os";
import { join, delimiter } from "node:path";
import { execFileSync } from "node:child_process";
import { discoverGithub, discoverLocal } from "../src/discovery.ts";
import { scratchRoot } from "./fixtures.ts";
test("A7 one hundred full unique pages refuse truncation and late failure never returns partial", async () => {
  let pages = 0;
  await assert.rejects(
    () =>
      discoverGithub("example", {
        runner: async () => {
          const offset = pages++ * 100;
          return JSON.stringify(
            Array.from({ length: 100 }, (_, i) => ({
              id: offset + i + 1,
              html_url: `https://github.com/example/repo-${offset + i}`,
              archived: false,
              private: false,
            })),
          );
        },
      }),
    { code: "TOOL_FAILURE" },
  );
  assert.equal(pages, 100);
  pages = 0;
  await assert.rejects(
    () =>
      discoverGithub("example", {
        runner: async () => {
          if (pages++) throw new Error("private stderr");
          return JSON.stringify(
            Array.from({ length: 100 }, (_, i) => ({
              id: i + 1,
              html_url: `https://github.com/example/repo-${i}`,
              archived: false,
              private: false,
            })),
          );
        },
      }),
    { code: "TOOL_FAILURE" },
  );
  assert.equal(pages, 2);
});
test("A6 trusted Git shim proves fixed argv and sanitized environment", async () => {
  const root = await scratchRoot("governance-shim-");
  const oldPath = process.env.PATH;
  const oldTrace = process.env.GIT_TRACE;
  try {
    const realGit = realpathSync(
      oldPath!
        .split(delimiter)
        .map((p) => join(p, "git"))
        .find((p) => existsSync(p))!,
    );
    const scan = join(root, "scan");
    const shim = join(root, "bin");
    await mkdir(scan);
    await mkdir(shim);
    execFileSync(realGit, ["init"], { cwd: scan, stdio: "ignore" });
    execFileSync(
      realGit,
      ["config", "remote.origin.url", "https://github.com/example/api"],
      { cwd: scan },
    );
    const log = join(root, "calls.jsonl");
    await writeFile(
      join(shim, "git"),
      `#!${process.execPath}
const fs=require('node:fs');const cp=require('node:child_process');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('GIT_')))})+'\\n');const r=cp.spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{env:process.env,stdio:'inherit'});process.exit(r.status??1);
`,
      { mode: 0o755 },
    );
    process.env.PATH = shim + delimiter + oldPath;
    process.env.GIT_TRACE = join(root, "must-not-exist");
    const inventory = await discoverLocal(scan);
    assert.equal(inventory.complete, true);
    assert.equal(existsSync(process.env.GIT_TRACE), false);
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(calls.length, 4);
    const fixed = [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      `core.hooksPath=${devNull}`,
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      "-c",
      `core.excludesFile=${devNull}`,
    ];
    for (const c of calls) {
      assert.deepEqual(c.args.slice(0, fixed.length), fixed);
      assert.deepEqual(c.env, {
        GIT_WORK_TREE: scan,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: devNull,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
      });
    }
    assert.deepEqual(
      calls.map((c) => c.args.slice(fixed.length)),
      [
        ["config", "--local", "--no-includes", "--get", "remote.origin.url"],
        ["rev-parse", "--verify", "HEAD"],
        ["config", "--includes", "--null", "--name-only", "--list"],
        [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "--ignore-submodules=all",
        ],
      ],
    );
  } finally {
    process.env.PATH = oldPath;
    if (oldTrace === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = oldTrace;
    await rm(root, { recursive: true, force: true });
  }
});
test("A6 commondir whitespace cannot hide a symlink from metadata preflight", async () => {
  const root = await scratchRoot("governance-space-");
  const oldPath = process.env.PATH;
  try {
    const scan = join(root, "scan");
    const meta = join(scan, ".git");
    await mkdir(meta, { recursive: true });
    await mkdir(join(scan, "common"));
    await symlink(root, join(scan, "common "));
    await writeFile(join(meta, "commondir"), "../common \n");
    const bin = join(root, "bin");
    await mkdir(bin);
    const sentinel = join(root, "invoked");
    await writeFile(
      join(bin, "git"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)},'unsafe');process.exit(1);\n`,
      { mode: 0o755 },
    );
    process.env.PATH = bin + delimiter + oldPath;
    assert.equal((await discoverLocal(scan)).complete, false);
    assert.equal(existsSync(sentinel), false);
  } finally {
    process.env.PATH = oldPath;
    await rm(root, { recursive: true, force: true });
  }
});
test("A6 commondir escape and symlink fail before repository observation", async () => {
  const root = await scratchRoot("governance-common-");
  const outside = await scratchRoot("governance-other-");
  try {
    const scan = join(root, "scan");
    const meta = join(scan, ".git");
    await mkdir(meta, { recursive: true });
    await writeFile(join(meta, "commondir"), outside + "\n");
    assert.equal((await discoverLocal(scan)).complete, false);
    await rm(join(meta, "commondir"));
    await writeFile(join(root, "common-pointer"), ".\n");
    await symlink(join(root, "common-pointer"), join(meta, "commondir"));
    assert.equal((await discoverLocal(scan)).complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
