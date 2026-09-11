import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import {
  resolve,
  join,
  relative,
  isAbsolute,
  dirname,
  parse,
  sep,
} from "node:path";
import { devNull } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  GovernanceError,
  requireThat,
  canonicalRemote,
  validOwner,
  parseJson,
  digest,
} from "./core.ts";
export interface RemoteInventory {
  owner: string;
  complete: true;
  repositories: {
    remote: string;
    id: number;
    archived: boolean;
    private: boolean;
  }[];
}
export type GithubRunner = (
  bin: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<string>;
export async function discoverGithub(
  owner: string,
  options: { runner?: GithubRunner } = {},
): Promise<RemoteInventory> {
  requireThat(validOwner(owner));
  const env = { ...process.env };
  delete env.GH_HOST;
  const run =
    options.runner ??
    (async (bin, args, opts) =>
      (await exec(bin, args, { ...opts, encoding: "utf8" })).stdout);
  const result: RemoteInventory = { owner, complete: true, repositories: [] };
  const seen = new Set<string>();
  const ids = new Set<number>();
  try {
    for (let page = 1; page <= 100; page++) {
      const raw = await run(
        "gh",
        [
          "api",
          "--hostname",
          "github.com",
          `/orgs/${owner}/repos?per_page=100&page=${page}&type=all`,
        ],
        { env, timeout: 30000, maxBuffer: limit },
      );
      const data = parseJson(raw);
      requireThat(Array.isArray(data) && data.length <= 100, "TOOL_FAILURE");
      for (const r of data) {
        requireThat(
          r &&
            typeof r === "object" &&
            Number.isSafeInteger(r.id) &&
            r.id > 0 &&
            typeof r.archived === "boolean" &&
            typeof r.private === "boolean",
          "TOOL_FAILURE",
        );
        const remote = canonicalRemote(r.html_url);
        requireThat(!seen.has(remote) && !ids.has(r.id), "TOOL_FAILURE");
        seen.add(remote);
        ids.add(r.id);
        result.repositories.push({
          remote,
          id: r.id,
          archived: r.archived,
          private: r.private,
        });
      }
      if (data.length < 100) {
        result.repositories.sort((a, b) =>
          a.remote < b.remote ? -1 : a.remote > b.remote ? 1 : 0,
        );
        return result;
      }
    }
    throw new GovernanceError("TOOL_FAILURE");
  } catch {
    throw new GovernanceError("TOOL_FAILURE");
  }
}
export interface RepositoryObservation {
  path: string;
  remote: string | null;
  head: string | null;
  dirty: boolean;
  worktree: boolean;
  status: string;
}
export interface Inventory {
  root: string;
  complete: boolean;
  errors: { code: string }[];
  repositories: RepositoryObservation[];
  occupiedPaths: string[];
  /** Non-directory obstructions (including files and symlinks). */
  unsafePaths: string[];
}
const exec = promisify(execFile);
const limit = 2 * 1024 * 1024;
const skipped = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".cache",
  ".next",
  ".turbo",
]);
export function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))
  );
}
async function noSymlinks(path: string): Promise<void> {
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    requireThat(!(await lstat(cursor)).isSymbolicLink(), "INCOMPLETE");
  }
}
async function metadataPath(root: string, path: string): Promise<string> {
  const full = resolve(path);
  requireThat(contained(root, full), "INCOMPLETE");
  await noSymlinks(full);
  const real = await realpath(full);
  requireThat(contained(root, real), "INCOMPLETE");
  return real;
}
async function smallText(path: string): Promise<string> {
  const s = await lstat(path);
  requireThat(s.isFile() && s.size <= 16384, "INCOMPLETE");
  const b = await readFile(path);
  requireThat(b.length <= 16384, "INCOMPLETE");
  return new TextDecoder("utf-8", { fatal: true }).decode(b);
}
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!k.startsWith("GIT_")) env[k] = v;
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
  };
}
async function git(cwd: string, args: string[]): Promise<string> {
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
  const { stdout } = await exec("git", [...fixed, ...args], {
    cwd,
    env: { ...gitEnv(), GIT_WORK_TREE: cwd },
    encoding: "utf8",
    maxBuffer: limit,
    timeout: 30000,
  });
  return stdout;
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export async function discoverLocal(
  root: string,
  options: { depth?: number } = {},
): Promise<Inventory> {
  requireThat(typeof root === "string" && root.length > 0);
  const depth = options.depth ?? 8;
  requireThat(
    Number.isInteger(depth) &&
      depth >= 0 &&
      depth <= 32 &&
      Object.keys(options).every((k) => k === "depth"),
  );
  const absolute = resolve(root);
  try {
    await noSymlinks(absolute);
    requireThat((await lstat(absolute)).isDirectory());
    requireThat((await realpath(absolute)) === absolute);
  } catch {
    throw new GovernanceError("INVALID");
  }
  const inventory: Inventory = {
    root: absolute,
    complete: true,
    errors: [],
    repositories: [],
    occupiedPaths: [],
    unsafePaths: [],
  };
  let count = 0;
  const fail = (code = "SCAN_FAILURE") => {
    inventory.complete = false;
    if (!inventory.errors.some((e) => e.code === code))
      inventory.errors.push({ code });
  };
  const observe = async (path: string) => {
    try {
      const marker = join(path, ".git");
      const stat = await lstat(marker);
      requireThat(!stat.isSymbolicLink(), "INCOMPLETE");
      let meta = marker;
      const worktree = stat.isFile();
      if (worktree) {
        const text = await smallText(marker);
        const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(text);
        requireThat(match, "INCOMPLETE");
        meta = resolve(path, match[1]);
      } else requireThat(stat.isDirectory(), "INCOMPLETE");
      meta = await metadataPath(absolute, meta);
      requireThat((await lstat(meta)).isDirectory(), "INCOMPLETE");
      let common = meta;
      const cp = join(meta, "commondir");
      if (await exists(cp)) {
        await noSymlinks(cp);
        const text = await smallText(cp);
        requireThat(/^[^\r\n]+\r?\n?$/.test(text), "INCOMPLETE");
        common = await metadataPath(
          absolute,
          resolve(meta, text.replace(/\r?\n$/, "")),
        );
        requireThat((await lstat(common)).isDirectory(), "INCOMPLETE");
      }
      let remote: string | null = null;
      try {
        remote = canonicalRemote(
          (
            await git(path, [
              "config",
              "--local",
              "--no-includes",
              "--get",
              "remote.origin.url",
            ])
          ).replace(/\n$/, ""),
        );
      } catch {
        fail("REMOTE_UNAVAILABLE");
      }
      let head: string | null = null;
      try {
        head = (await git(path, ["rev-parse", "--verify", "HEAD"])).trim();
        requireThat(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head), "INCOMPLETE");
      } catch {
        const ref = (await smallText(join(meta, "HEAD"))).trim();
        requireThat(/^ref: refs\/heads\/[^\s]+$/.test(ref), "INCOMPLETE");
        const branch = ref.slice(5);
        requireThat(
          !branch.includes("..") && !branch.includes("\\"),
          "INCOMPLETE",
        );
        requireThat(!(await exists(join(common, branch))), "INCOMPLETE");
        if (await exists(join(common, "packed-refs"))) {
          const packed = await smallText(join(common, "packed-refs"));
          requireThat(
            !packed.split("\n").some((l) => l.endsWith(" " + branch)),
            "INCOMPLETE",
          );
        }
        head = null;
      }
      // Status may execute clean/process drivers while comparing tracked bytes.
      // Query effective names (including conditional includes and worktree config)
      // under the same sanitized environment; never run status if one is present.
      // Reject even empty/unused drivers rather than silently change dirty semantics.
      const configNames = await git(path, [
        "config",
        "--includes",
        "--null",
        "--name-only",
        "--list",
      ]);
      requireThat(
        !configNames.split("\0").some((key) => {
          // Subsections may contain any non-NUL bytes, including line separators.
          // Inspect only the fixed boundaries of each complete config key.
          const normalized = key.toLowerCase();
          return normalized.startsWith("filter.") &&
            (normalized.endsWith(".clean") || normalized.endsWith(".process"));
        }),
        "INCOMPLETE",
      );
      const status = await git(path, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=all",
      ]);
      inventory.repositories.push({
        path,
        remote,
        head,
        dirty: status.length > 0,
        worktree,
        status,
      });
    } catch {
      fail("GIT_METADATA_OR_STATUS");
    }
  };
  const walk = async (path: string, level: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      fail();
      return;
    }
    if (entries.some((e) => e.name === ".git")) await observe(path);
    for (const entry of entries.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (++count > 50000) {
        fail("ENTRY_LIMIT");
        return;
      }
      const target = join(path, entry.name);
      inventory.occupiedPaths.push(target);
      // Every non-directory obstructs a target at or below this path.
      // Keep ordinary directories usable as ancestors; do not follow symlinks.
      if (!entry.isDirectory()) inventory.unsafePaths.push(target);
      if (entry.isSymbolicLink()) continue;
      if (skipped.has(entry.name)) continue;
      if (entry.isDirectory()) {
        if (level >= depth) {
          fail("DEPTH_LIMIT");
          continue;
        }
        await walk(target, level + 1);
      } else if (!entry.isFile()) fail("UNSUPPORTED_ENTRY");
    }
  };
  await walk(absolute, 0);
  inventory.repositories.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  inventory.errors.sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
  inventory.occupiedPaths.sort();
  inventory.unsafePaths.sort();
  return inventory;
}
