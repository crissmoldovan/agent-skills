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
export type GithubOwnerType = "organization" | "user";
export type CoverageStatus = "complete" | "partial" | "unknown";

export interface GithubObservationError {
  code: "ACCESS_DENIED" | "PAGE_FAILED" | "INVALID_RESPONSE" | "REPEATED_RESPONSE" | "PAGE_LIMIT";
  page: number;
  causeCode: string | null;
  httpStatus: number | null;
}

export interface GithubCoverage {
  status: CoverageStatus;
  scope: "credential-visible";
  absenceAuthoritative: false;
  privateVisibility: "observed" | "unknown" | "unavailable";
  endpoint: GithubOwnerType;
  pages: {
    requested: number;
    completed: number;
    max: number;
    nextPage: number | null;
    truncated: boolean;
  };
  limitations: string[];
  errors: GithubObservationError[];
}

export interface RemoteInventory {
  provider: "github";
  owner: string;
  ownerType: GithubOwnerType;
  observedAt: string;
  complete: boolean;
  coverage: GithubCoverage;
  counts: {
    received: number;
    private: number;
    archived: number;
  };
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

export interface GithubDiscoveryOptions {
  ownerType?: GithubOwnerType;
  maxPages?: number;
  runner?: GithubRunner;
  now?: () => Date;
}

export async function discoverGithub(
  owner: string,
  options: GithubDiscoveryOptions = {},
): Promise<RemoteInventory> {
  requireThat(validOwner(owner));
  requireThat(
    Object.keys(options).every((key) =>
      ["ownerType", "maxPages", "runner", "now"].includes(key)
    ),
  );
  const ownerType = options.ownerType ?? "organization";
  requireThat(ownerType === "organization" || ownerType === "user");
  const maxPages = options.maxPages ?? 100;
  requireThat(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 100);
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const env = { ...process.env };
  delete env.GH_HOST;
  const run =
    options.runner ??
    (async (bin, args, opts) =>
      (await exec(bin, args, { ...opts, encoding: "utf8" })).stdout);
  const repositories: RemoteInventory["repositories"] = [];
  const seen = new Set<string>();
  const ids = new Set<number>();
  let requested = 0;
  let completed = 0;

  const finish = (
    status: CoverageStatus,
    nextPage: number | null,
    truncated: boolean,
    errors: GithubObservationError[] = [],
  ): RemoteInventory => {
    repositories.sort((a, b) =>
      a.remote < b.remote ? -1 : a.remote > b.remote ? 1 : 0
    );
    const privateCount = repositories.filter((repository) => repository.private).length;
    const userVisibilityLimited = ownerType === "user";
    const effectiveStatus = status === "complete" && userVisibilityLimited
      ? "partial"
      : status;
    return {
      provider: "github",
      owner,
      ownerType,
      observedAt,
      complete: effectiveStatus === "complete",
      coverage: {
        status: effectiveStatus,
        scope: "credential-visible",
        absenceAuthoritative: false,
        privateVisibility: userVisibilityLimited
          ? "unavailable"
          : privateCount > 0
            ? "observed"
            : "unknown",
        endpoint: ownerType,
        pages: {
          requested,
          completed,
          max: maxPages,
          nextPage,
          truncated,
        },
        limitations: userVisibilityLimited
          ? ["PRIVATE_VISIBILITY_UNAVAILABLE_FOR_USER_ENDPOINT"]
          : ["PRIVATE_REPOSITORY_ABSENCE_NOT_AUTHORITATIVE"],
        errors,
      },
      counts: {
        received: repositories.length,
        private: privateCount,
        archived: repositories.filter((repository) => repository.archived).length,
      },
      repositories,
    };
  };

  const runnerError = (error: unknown, page: number): GithubObservationError => {
    const record = error !== null && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
    const stderr = typeof record.stderr === "string" ? record.stderr : "";
    const stderrStatus = /(?:^|[\s(])HTTP\s+([1-5]\d{2})(?:[\s)]|$)/i.exec(stderr);
    const rawStatus = record.status ?? record.statusCode ??
      (stderrStatus === null ? undefined : Number(stderrStatus[1]));
    const httpStatus = Number.isInteger(rawStatus) && Number(rawStatus) >= 100 && Number(rawStatus) <= 599
      ? Number(rawStatus)
      : null;
    const rawCause = record.code;
    const cause = typeof rawCause === "string" || typeof rawCause === "number"
      ? String(rawCause)
      : "";
    const causeCode = /^[A-Za-z0-9_.:-]{1,64}$/.test(cause) ? cause : null;
    return {
      code: httpStatus === 401 || httpStatus === 403 ? "ACCESS_DENIED" : "PAGE_FAILED",
      page,
      causeCode,
      httpStatus,
    };
  };

  for (let page = 1; page <= maxPages; page++) {
    requested += 1;
    const endpoint = ownerType === "organization"
      ? `/orgs/${owner}/repos?per_page=100&page=${page}&type=all&sort=full_name&direction=asc`
      : `/users/${owner}/repos?per_page=100&page=${page}&type=owner&sort=full_name&direction=asc`;
    let raw: string;
    try {
      raw = await run(
        "gh",
        ["api", "--hostname", "github.com", endpoint],
        { env, timeout: 30000, maxBuffer: limit },
      );
    } catch (error) {
      return finish(
        completed === 0 ? "unknown" : "partial",
        page,
        false,
        [runnerError(error, page)],
      );
    }
    let data: unknown;
    try {
      data = parseJson(raw);
      requireThat(Array.isArray(data) && data.length <= 100, "TOOL_FAILURE");
      const pageRepositories: RemoteInventory["repositories"] = [];
      for (const repository of data) {
        requireThat(
          repository &&
            typeof repository === "object" &&
            Number.isSafeInteger(repository.id) &&
            repository.id > 0 &&
            typeof repository.html_url === "string" &&
            typeof repository.archived === "boolean" &&
            typeof repository.private === "boolean",
          "TOOL_FAILURE",
        );
        const remote = canonicalRemote(repository.html_url);
        if (seen.has(remote) || ids.has(repository.id))
          throw new GovernanceError("REPEATED_RESPONSE");
        requireThat(
          remote.startsWith(`https://github.com/${owner.toLowerCase()}/`),
          "TOOL_FAILURE",
        );
        seen.add(remote);
        ids.add(repository.id);
        pageRepositories.push({
          remote,
          id: repository.id,
          archived: repository.archived,
          private: repository.private,
        });
      }
      repositories.push(...pageRepositories);
    } catch (error) {
      const code = error instanceof GovernanceError && error.code === "REPEATED_RESPONSE"
        ? "REPEATED_RESPONSE"
        : "INVALID_RESPONSE";
      return finish(
        completed === 0 ? "unknown" : "partial",
        page,
        false,
        [{ code, page, causeCode: null, httpStatus: null }],
      );
    }
    completed += 1;
    if ((data as unknown[]).length < 100)
      return finish("complete", null, false);
  }
  return finish(
    "partial",
    maxPages + 1,
    true,
    [{ code: "PAGE_LIMIT", page: maxPages + 1, causeCode: null, httpStatus: null }],
  );
}
export interface RepositoryObservation {
  path: string;
  remote: string | null;
  head: string | null;
  branch?: string | null;
  dirty: boolean;
  worktree: boolean;
  status: string;
}
export interface Inventory {
  root: string;
  complete: boolean;
  errors: { code: string; target: string }[];
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
async function metadataPath(roots: readonly string[], path: string): Promise<string> {
  const full = resolve(path);
  requireThat(roots.some((root) => contained(root, full)), "INCOMPLETE");
  await noSymlinks(full);
  const real = await realpath(full);
  requireThat(roots.some((root) => contained(root, real)), "INCOMPLETE");
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
  options: { depth?: number; trustedMetadataRoots?: string[] } = {},
): Promise<Inventory> {
  requireThat(typeof root === "string" && root.length > 0);
  const depth = options.depth ?? 8;
  requireThat(
    Number.isInteger(depth) &&
      depth >= 0 &&
      depth <= 32 &&
      Object.keys(options).every((k) => k === "depth" || k === "trustedMetadataRoots") &&
      (options.trustedMetadataRoots === undefined ||
        (Array.isArray(options.trustedMetadataRoots) &&
          options.trustedMetadataRoots.length <= 64 &&
          options.trustedMetadataRoots.every((candidate) =>
            typeof candidate === "string" &&
            candidate.length > 0 &&
            candidate.length <= 16_384 &&
            isAbsolute(candidate) &&
            !/[\x00\r\n]/.test(candidate)
          ))),
  );
  const absolute = resolve(root);
  const metadataRoots = [...new Set([
    absolute,
    ...(options.trustedMetadataRoots ?? []).map((candidate) => resolve(candidate)),
  ])];
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
  const fail = (code = "SCAN_FAILURE", target = absolute) => {
    inventory.complete = false;
    if (!inventory.errors.some((error) => error.code === code && error.target === target))
      inventory.errors.push({ code, target });
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
      meta = await metadataPath(metadataRoots, meta);
      requireThat((await lstat(meta)).isDirectory(), "INCOMPLETE");
      let common = meta;
      const cp = join(meta, "commondir");
      if (await exists(cp)) {
        await noSymlinks(cp);
        const text = await smallText(cp);
        requireThat(/^[^\r\n]+\r?\n?$/.test(text), "INCOMPLETE");
        common = await metadataPath(
          metadataRoots,
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
        fail("REMOTE_UNAVAILABLE", path);
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
      let branch: string | null = null;
      try {
        branch = (await git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
        requireThat(branch.length > 0 && branch.length <= 1024 && !/[\x00-\x1f]/.test(branch), "INCOMPLETE");
      } catch {
        branch = null;
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
        branch,
        dirty: status.length > 0,
        worktree,
        status,
      });
    } catch {
      fail("GIT_METADATA_OR_STATUS", path);
    }
  };
  const walk = async (path: string, level: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      fail("SCAN_FAILURE", path);
      return;
    }
    if (entries.some((e) => e.name === ".git")) await observe(path);
    for (const entry of entries.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const target = join(path, entry.name);
      if (++count > 50000) {
        fail("ENTRY_LIMIT", target);
        return;
      }
      inventory.occupiedPaths.push(target);
      // Every non-directory obstructs a target at or below this path.
      // Keep ordinary directories usable as ancestors; do not follow symlinks.
      if (!entry.isDirectory()) inventory.unsafePaths.push(target);
      if (entry.isSymbolicLink()) continue;
      if (skipped.has(entry.name)) continue;
      if (entry.isDirectory()) {
        if (level >= depth) {
          fail("DEPTH_LIMIT", target);
          continue;
        }
        await walk(target, level + 1);
      } else if (!entry.isFile()) fail("UNSUPPORTED_ENTRY", target);
    }
  };
  await walk(absolute, 0);
  inventory.repositories.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  inventory.errors.sort((a, b) =>
    a.code < b.code
      ? -1
      : a.code > b.code
        ? 1
        : a.target < b.target
          ? -1
          : a.target > b.target
            ? 1
            : 0,
  );
  inventory.occupiedPaths.sort();
  inventory.unsafePaths.sort();
  return inventory;
}
