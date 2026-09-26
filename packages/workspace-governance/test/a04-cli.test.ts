import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  documentRevision,
  type CatalogDocument,
  type LocalStateDocument,
  type WorkspacesConfig,
} from "../src/index.ts";
import { scratchRoot } from "./fixtures.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", [
    "-c", "user.name=Synthetic A04",
    "-c", "user.email=synthetic-a04@example.invalid",
    ...args,
  ], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function setupFixture() {
  const root = await scratchRoot("workspacectl-a04-cli-");
  const configDirectory = join(root, "config");
  const dataDirectory = join(root, "data");
  const stateDirectory = join(root, "state");
  const plansDirectory = join(root, "plans");
  const trustedRoot = join(root, "workspaces");
  const bin = join(root, "bin");
  await Promise.all([
    configDirectory,
    dataDirectory,
    stateDirectory,
    plansDirectory,
    trustedRoot,
    bin,
  ].map((path) => mkdir(path)));
  const configPath = join(configDirectory, "config.json");
  const catalogPath = join(dataDirectory, "catalog.json");
  const statePath = join(stateDirectory, "local-state.json");
  const config: WorkspacesConfig = {
    schemaVersion: 2,
    documentType: "workspacectl/config",
    catalog: { adapter: "file", path: catalogPath },
    localState: { adapter: "file", path: statePath },
    plans: { directory: plansDirectory },
    trustedRoots: [trustedRoot],
  };
  const catalog: CatalogDocument = {
    schemaVersion: 2,
    documentType: "workspacectl/catalog",
    groups: [{
      id: "org-synthetic",
      kind: "organization",
      name: "Synthetic Business",
      slug: "synthetic-business",
      parentId: null,
      metadata: {},
    }],
    sources: [{
      id: "source-synthetic-org",
      provider: "github",
      owner: "Synthetic-Org",
      ownerType: "organization",
      include: [],
      exclude: [],
      proposedDefaultGroupId: "org-synthetic",
      metadata: { fixture: "deterministic-synthetic-github" },
    }, {
      id: "source-synthetic-user",
      provider: "github",
      owner: "Synthetic-User",
      ownerType: "user",
      include: [],
      exclude: [],
      proposedDefaultGroupId: "org-synthetic",
      metadata: { fixture: "deterministic-synthetic-github" },
    }],
    repositories: [{
      id: "repo-synthetic-service",
      remote: "https://github.com/Synthetic-Org/service",
      sourceId: "source-synthetic-org",
      primaryGroupId: "org-synthetic",
      memberOf: [],
      aliases: [],
      classification: "confirmed",
      metadata: {},
    }],
    policies: [],
    workflows: [],
    metadata: { fixture: "A04 deterministic synthetic catalog" },
  };
  const localState: LocalStateDocument = {
    schemaVersion: 2,
    documentType: "workspacectl/local-state",
    selectedConfig: { path: configPath, revision: documentRevision(config) },
    repositoryWorkspaces: [],
    coordinationWorkspaces: [],
    workspacePolicyOverlays: [],
    trustedInputApprovals: [],
    planReferences: [],
    runReferences: [],
    metadata: {},
  };
  await Promise.all([
    writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 }),
    writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", { mode: 0o600 }),
    writeFile(statePath, JSON.stringify(localState, null, 2) + "\n", { mode: 0o600 }),
  ]);

  const checkout = join(trustedRoot, "service");
  await mkdir(checkout);
  git(checkout, "init", "--initial-branch=main");
  git(checkout, "remote", "add", "origin", "https://github.com/Synthetic-Org/service");
  await writeFile(join(checkout, "tracked.txt"), "synthetic fixture\n");
  git(checkout, "add", "tracked.txt");
  git(checkout, "commit", "-m", "synthetic fixture");

  const ghLog = join(root, "synthetic-gh-endpoints.log");
  const gh = join(bin, "gh");
  await writeFile(gh, `#!${process.execPath}
const fs = require("node:fs");
const endpoint = process.argv[5];
fs.appendFileSync(process.env.SYNTHETIC_GH_LOG, endpoint + "\\n");
const organization = endpoint && endpoint.startsWith("/orgs/Synthetic-Org/repos?");
const user = endpoint && endpoint.startsWith("/users/Synthetic-User/repos?");
if (!organization && !user) process.exit(41);
if (process.env.SYNTHETIC_GH_MODE === "denied") {
  process.stderr.write("gh: SYNTHETIC_FIXTURE_SECRET_DENIAL (HTTP 403)\\n");
  process.exit(1);
}
const mode = process.env.SYNTHETIC_GH_MODE || "complete";
const page = Number(new URL(endpoint, "https://fixture.invalid").searchParams.get("page"));
if (organization && ["pages", "interrupted"].includes(mode)) {
  if (page === 1) {
    const repositories = [{
      id: 7101,
      html_url: "https://github.com/Synthetic-Org/service",
      archived: false,
      private: true
    }];
    for (let index = 1; index < 100; index += 1) repositories.push({
      id: 7101 + index,
      html_url: "https://github.com/Synthetic-Org/page-one-" + String(index).padStart(3, "0"),
      archived: false,
      private: false
    });
    process.stdout.write(JSON.stringify(repositories));
  } else if (mode === "interrupted") {
    process.stderr.write("gh: SYNTHETIC_FIXTURE_SECRET_INTERRUPTION (HTTP 503)\\n");
    process.exit(1);
  } else {
    process.stdout.write(JSON.stringify([{
      id: 7301,
      html_url: "https://github.com/Synthetic-Org/final-page",
      archived: true,
      private: false
    }]));
  }
} else if (organization && mode === "extra") {
  process.stdout.write(JSON.stringify([{
    id: 7101,
    html_url: "https://github.com/Synthetic-Org/service",
    archived: false,
    private: true
  }, {
    id: 7102,
    html_url: "https://github.com/Synthetic-Org/unclassified-archive",
    archived: true,
    private: false
  }]));
} else process.stdout.write(JSON.stringify([user ? {
  id: 7201,
  html_url: "https://github.com/Synthetic-User/public-service",
  archived: false,
  private: false
} : {
  id: 7101,
  html_url: "https://github.com/Synthetic-Org/service",
  archived: false,
  private: true
}]));
`, { mode: 0o755 });

  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    SYNTHETIC_GH_LOG: ghLog,
    GH_HOST: "must-not-be-forwarded.invalid",
  };
  return {
    root,
    configPath,
    catalogPath,
    statePath,
    trustedRoot,
    checkout,
    ghLog,
    env,
  };
}

function run(env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
}

test("A04 selected discover is a read-only installed-style overview in JSON and text", async () => {
  const fixture = await setupFixture();
  try {
    const paths = [
      fixture.configPath,
      fixture.catalogPath,
      fixture.statePath,
      join(fixture.checkout, ".git", "HEAD"),
      join(fixture.checkout, ".git", "index"),
      join(fixture.checkout, "tracked.txt"),
    ];
    const before = await Promise.all(paths.map((path) => readFile(path)));
    const flags = [
      "--config", fixture.configPath,
      "--source", "source-synthetic-org",
      "--root", fixture.trustedRoot,
      "--depth", "8",
      "--max-pages", "2",
    ];

    const json = run(fixture.env, ["discover", ...flags, "--json"]);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(json.stderr, "");
    const body = JSON.parse(json.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.command, "discover");
    assert.equal(body.format, "workspacectl-overview/1");
    assert.equal(body.readOnly, true);
    assert.equal(body.selection.transient, true);
    assert.deepEqual(body.selection.sourceIds, ["source-synthetic-org"]);
    assert.deepEqual(body.selection.roots, [fixture.trustedRoot]);
    assert.equal(body.coverage.status, "complete");
    assert.equal(body.coverage.sources[0].ownerType, "organization");
    assert.equal(body.coverage.sources[0].counts.received, 1);
    assert.equal(body.coverage.sources[0].counts.private, 1);
    assert.equal(body.summary.repositories, 1);
    assert.equal(body.repositories[0].id, "repo-synthetic-service");
    assert.equal(body.repositories[0].checkout.state, "present");
    assert.equal(body.repositories[0].checkout.selected, null);

    const text = run(fixture.env, ["discover", ...flags]);
    assert.equal(text.status, 0, text.stderr);
    assert.equal(text.stderr, "");
    assert.match(text.stdout, /Workspace overview: discover/);
    assert.match(text.stdout, /Coverage: complete/);
    assert.match(text.stdout, /Synthetic Business/);
    assert.match(text.stdout, /repo-synthetic-service/);
    assert.match(text.stdout, /checkout present/);
    assert.match(text.stdout, /Read-only observation; no selections were persisted\./);

    const after = await Promise.all(paths.map((path) => readFile(path)));
    assert.deepEqual(after, before);
    const endpoints = (await readFile(fixture.ghLog, "utf8")).trim().split("\n");
    assert.equal(endpoints.length, 2);
    assert.ok(endpoints.every((endpoint) =>
      endpoint === "/orgs/Synthetic-Org/repos?per_page=100&page=1&type=all&sort=full_name&direction=asc"
    ));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function comparableOverview(body: Record<string, any>) {
  const comparable = structuredClone(body);
  delete comparable.ok;
  delete comparable.command;
  delete comparable.selectedConfig;
  comparable.observedAt = "<normalized>";
  for (const source of comparable.coverage.sources)
    source.observedAt = "<normalized>";
  for (const local of comparable.coverage.local)
    local.observedAt = "<normalized>";
  return comparable;
}

test("A04 discover list report and audit expose one selected coverage and findings projection", async () => {
  const fixture = await setupFixture();
  try {
    const immutablePaths = [
      fixture.configPath,
      fixture.catalogPath,
      fixture.statePath,
      join(fixture.checkout, ".git", "HEAD"),
      join(fixture.checkout, ".git", "index"),
      join(fixture.checkout, ".git", "refs", "heads", "main"),
      join(fixture.checkout, "tracked.txt"),
    ];
    const before = await Promise.all(immutablePaths.map((path) => readFile(path)));
    const flags = [
      "--config", fixture.configPath,
      "--source", "source-synthetic-org",
      "--root", fixture.trustedRoot,
      "--depth", "8",
      "--max-pages", "2",
    ];
    const bodies: Record<string, any> = {};
    for (const command of ["discover", "list", "report", "audit"] as const) {
      const result = run(fixture.env, [command, ...flags, "--json"]);
      assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      assert.equal(result.stderr, "");
      bodies[command] = JSON.parse(result.stdout);
      assert.equal(bodies[command].command, command);
      assert.equal(bodies[command].coverage.status, "complete");
      assert.equal(bodies[command].summary.repositories, bodies[command].repositories.length);
      assert.equal(
        bodies[command].summary.localCheckouts,
        bodies[command].repositories.reduce(
          (total: number, repository: Record<string, any>) =>
            total + repository.checkout.checkouts.length,
          0,
        ),
      );

      const text = run(fixture.env, [command, ...flags]);
      assert.equal(text.status, 0, `${command} text: ${text.stderr}`);
      assert.match(text.stdout, new RegExp(`Workspace overview: ${command}`));
      assert.match(text.stdout, /Coverage: complete/);
      assert.match(text.stdout, /Findings:/);
      assert.match(text.stdout, /Read-only observation; no selections were persisted\./);
    }
    const reference = comparableOverview(bodies.discover);
    assert.deepEqual(comparableOverview(bodies.list), reference);
    assert.deepEqual(comparableOverview(bodies.report), reference);
    assert.deepEqual(comparableOverview(bodies.audit), reference);
    assert.equal(reference.coverage.sources[0].counts.received, 1);
    assert.equal(reference.coverage.sources[0].counts.selected, 1);
    assert.equal(reference.coverage.sources[0].counts.excluded, 0);
    assert.equal(reference.coverage.sources[0].pages.requested, 1);
    assert.equal(reference.coverage.sources[0].pages.completed, 1);
    assert.equal(reference.coverage.sources[0].absenceAuthoritative, false);
    assert.deepEqual(await Promise.all(immutablePaths.map((path) => readFile(path))), before);

    const endpoints = (await readFile(fixture.ghLog, "utf8")).trim().split("\n");
    assert.equal(endpoints.length, 8);
    assert.ok(endpoints.every((endpoint) =>
      endpoint === "/orgs/Synthetic-Org/repos?per_page=100&page=1&type=all&sort=full_name&direction=asc"
    ));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 installed-style denied GitHub selection is unknown without leaking runner text", async () => {
  const fixture = await setupFixture();
  try {
    const env = { ...fixture.env, SYNTHETIC_GH_MODE: "denied" };
    const flags = [
      "--config", fixture.configPath,
      "--source", "source-synthetic-org",
      "--max-pages", "2",
    ];
    const result = run(env, ["discover", ...flags, "--json"]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.includes("SYNTHETIC_FIXTURE_SECRET_DENIAL"), false);
    const body = JSON.parse(result.stdout);
    assert.equal(body.coverage.status, "unknown");
    assert.equal(body.coverage.sources[0].status, "unknown");
    assert.equal(body.coverage.sources[0].counts.received, 0);
    assert.equal(body.coverage.sources[0].pages.requested, 1);
    assert.equal(body.coverage.sources[0].pages.completed, 0);
    assert.deepEqual(body.coverage.sources[0].errors, [{
      code: "ACCESS_DENIED",
      page: 1,
      causeCode: "1",
      httpStatus: 403,
    }]);
    assert.equal(body.summary.catalogRepositories, 1);
    assert.equal(body.repositories[0].checkout.state, "unknown");

    const text = run(env, ["discover", ...flags]);
    assert.equal(text.status, 3, text.stderr);
    assert.equal(text.stderr, "");
    assert.match(text.stdout, /Coverage: unknown/);
    assert.match(text.stdout, /ACCESS_DENIED at page 1/);
    assert.equal(text.stdout.includes("SYNTHETIC_FIXTURE_SECRET_DENIAL"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 a separately selected unsafe local target does not block a narrow safe target", async () => {
  const fixture = await setupFixture();
  try {
    const outside = join(fixture.root, "outside");
    const unsafe = join(fixture.trustedRoot, "unsafe-link");
    await mkdir(outside);
    await symlink(outside, unsafe, "dir");
    const immutablePaths = [
      join(fixture.checkout, ".git", "HEAD"),
      join(fixture.checkout, ".git", "index"),
      join(fixture.checkout, ".git", "refs", "heads", "main"),
      join(fixture.checkout, "tracked.txt"),
    ];
    const before = await Promise.all(immutablePaths.map((path) => readFile(path)));
    const result = run(fixture.env, [
      "discover",
      "--config", fixture.configPath,
      "--root", fixture.checkout,
      "--root", unsafe,
      "--root", outside,
      "--depth", "1",
      "--json",
    ]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stderr, "");
    const body = JSON.parse(result.stdout);
    assert.equal(body.coverage.status, "partial");
    assert.deepEqual(
      body.coverage.local.map((entry: Record<string, unknown>) => entry.status),
      ["complete", "unknown", "unknown"],
    );
    assert.deepEqual(body.coverage.local[1].errors, [{
      code: "INVALID_ROOT",
      target: unsafe,
    }]);
    assert.deepEqual(body.coverage.local[2].errors, [{
      code: "UNTRUSTED_ROOT",
      target: outside,
    }]);
    assert.equal(body.repositories[0].id, "repo-synthetic-service");
    assert.equal(body.repositories[0].checkout.state, "present");
    assert.equal(body.repositories[0].checkout.checkouts[0].path, fixture.checkout);
    assert.ok(body.findings.some((finding: Record<string, unknown>) =>
      finding.code === "COVERAGE_INCOMPLETE" && finding.subject === `root:${unsafe}`
    ));
    assert.deepEqual(await Promise.all(immutablePaths.map((path) => readFile(path))), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 selected GitHub user source uses the user endpoint and reports private coverage unavailable", async () => {
  const fixture = await setupFixture();
  try {
    const beforeCatalog = await readFile(fixture.catalogPath);
    const result = run(fixture.env, [
      "discover",
      "--config", fixture.configPath,
      "--source", "source-synthetic-user",
      "--max-pages", "2",
      "--json",
    ]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stderr, "");
    const body = JSON.parse(result.stdout);
    assert.equal(body.coverage.status, "partial");
    assert.equal(body.coverage.sources[0].owner, "Synthetic-User");
    assert.equal(body.coverage.sources[0].ownerType, "user");
    assert.equal(body.coverage.sources[0].endpoint, "user");
    assert.equal(body.coverage.sources[0].privateVisibility, "unavailable");
    assert.equal(body.coverage.sources[0].absenceAuthoritative, false);
    assert.deepEqual(body.coverage.sources[0].limitations, [
      "PRIVATE_VISIBILITY_UNAVAILABLE_FOR_USER_ENDPOINT",
    ]);
    assert.equal(body.summary.catalogRepositories, 1);
    assert.equal(body.summary.observedOnlyRepositories, 1);
    const observed = body.repositories.find((repository: Record<string, unknown>) =>
      repository.identity === "https://github.com/synthetic-user/public-service"
    );
    assert.equal(observed.catalogStatus, "observed-only");
    assert.equal(observed.grouping.classification, "unclassified");
    assert.equal(observed.grouping.approvedPrimaryGroup, null);
    assert.equal(observed.grouping.suggestions[0].group.name, "Synthetic Business");
    assert.equal(await readFile(fixture.catalogPath, "utf8"), beforeCatalog.toString("utf8"));
    assert.equal(
      (await readFile(fixture.ghLog, "utf8")).trim(),
      "/users/Synthetic-User/repos?per_page=100&page=1&type=owner&sort=full_name&direction=asc",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 invalid selections refuse before either GitHub or local observation", async () => {
  const fixture = await setupFixture();
  try {
    const sentinel = join(fixture.root, "synthetic-git-ran");
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    await writeFile(join(fixture.root, "bin", "git"), `#!${process.execPath}
const fs = require("node:fs");
const cp = require("node:child_process");
fs.writeFileSync(process.env.SYNTHETIC_GIT_SENTINEL, "ran\\n");
const result = cp.spawnSync(process.env.SYNTHETIC_REAL_GIT, process.argv.slice(2), {
  env: process.env,
  stdio: "inherit"
});
process.exit(result.status === null ? 70 : result.status);
`, { mode: 0o755 });
    const env = {
      ...fixture.env,
      SYNTHETIC_GIT_SENTINEL: sentinel,
      SYNTHETIC_REAL_GIT: realGit,
    };

    const valid = run(env, [
      "discover", "--config", fixture.configPath,
      "--root", fixture.checkout, "--json",
    ]);
    assert.equal(valid.status, 0, valid.stderr);
    await access(sentinel);
    await rm(sentinel, { force: true });

    const invalid = [
      ["no selection"],
      ["unknown source", "--source", "source-does-not-exist", "--root", fixture.checkout],
      ["duplicate source", "--source", "source-synthetic-org", "--source", "source-synthetic-org"],
      ["duplicate root", "--root", fixture.checkout, "--root", fixture.checkout],
      ["normalized duplicate root", "--root", fixture.checkout, "--root", join(fixture.checkout, ".")],
      ["relative root", "--root", "relative/root"],
      ["unused depth", "--depth", "1"],
      ["unused page limit", "--max-pages", "1"],
      ["depth out of range", "--root", fixture.checkout, "--depth", "33"],
      ["page limit out of range", "--source", "source-synthetic-org", "--max-pages", "0"],
      ["duplicate scalar", "--root", fixture.checkout, "--depth", "1", "--depth", "2"],
    ];
    for (const [name, ...args] of invalid) {
      const result = run(env, [
        "discover", "--config", fixture.configPath, ...args, "--json",
      ]);
      assert.equal(result.status, 2, `${name}: ${result.stderr}`);
      assert.equal(result.stdout, "", name);
      assert.equal(JSON.parse(result.stderr).error.code, "INVALID_CONFIG", name);
    }
    await assert.rejects(access(sentinel), { code: "ENOENT" });
    await assert.rejects(access(fixture.ghLog), { code: "ENOENT" });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 overlapping selected roots report one physical checkout rather than a duplicate", async () => {
  const fixture = await setupFixture();
  try {
    const result = run(fixture.env, [
      "discover",
      "--config", fixture.configPath,
      "--root", fixture.trustedRoot,
      "--root", fixture.checkout,
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const body = JSON.parse(result.stdout);
    const repository = body.repositories.find((entry: Record<string, unknown>) =>
      entry.id === "repo-synthetic-service"
    );
    assert.equal(repository.checkout.state, "present");
    assert.equal(repository.checkout.standaloneDuplicates, 1);
    assert.equal(repository.checkout.checkouts.length, 1);
    assert.equal(body.summary.localCheckouts, 1);
    assert.equal(body.findings.some((finding: Record<string, unknown>) =>
      finding.code === "DUPLICATE_CHECKOUT"
    ), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 narrow linked worktree uses configured trusted metadata root read-only", async () => {
  const fixture = await setupFixture();
  try {
    const linked = join(fixture.trustedRoot, "service-task");
    git(fixture.checkout, "worktree", "add", "-b", "a04-linked", linked);
    const linkedMarkerBefore = await readFile(join(linked, ".git"));
    const primaryHeadBefore = await readFile(join(fixture.checkout, ".git", "HEAD"));
    const linkedIndex = join(fixture.checkout, ".git", "worktrees", "service-task", "index");
    const linkedIndexBefore = await readFile(linkedIndex);

    const result = run(fixture.env, [
      "discover", "--config", fixture.configPath,
      "--root", linked,
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const body = JSON.parse(result.stdout);
    assert.equal(body.coverage.status, "complete");
    assert.deepEqual(body.coverage.local.map((entry: any) => ({
      root: entry.root,
      status: entry.status,
      observedRepositories: entry.counts.repositories,
    })), [{ root: linked, status: "complete", observedRepositories: 1 }]);
    const service = body.repositories.find((repository: any) =>
      repository.id === "repo-synthetic-service"
    );
    assert.equal(service.checkout.state, "present");
    assert.deepEqual(service.checkout.checkouts, [{
      path: linked,
      kind: "worktree",
      head: service.checkout.checkouts[0].head,
      dirty: false,
      remoteAvailable: true,
    }]);
    assert.deepEqual(await readFile(join(linked, ".git")), linkedMarkerBefore);
    assert.deepEqual(await readFile(join(fixture.checkout, ".git", "HEAD")), primaryHeadBefore);
    assert.deepEqual(await readFile(linkedIndex), linkedIndexBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 installed pagination reconciles complete, interrupted, and bounded source counts", async () => {
  const fixture = await setupFixture();
  try {
    const base = [
      "discover", "--config", fixture.configPath,
      "--source", "source-synthetic-org",
    ];
    let result = run({ ...fixture.env, SYNTHETIC_GH_MODE: "pages" }, [
      ...base, "--max-pages", "3", "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    let body = JSON.parse(result.stdout);
    assert.equal(body.coverage.status, "complete");
    assert.deepEqual(body.coverage.sources[0].pages, {
      requested: 2,
      completed: 2,
      max: 3,
      nextPage: null,
      truncated: false,
    });
    assert.deepEqual(body.coverage.sources[0].counts, {
      received: 101,
      private: 1,
      archived: 1,
      selected: 101,
      excluded: 0,
    });
    assert.equal(body.repositories.length, 101);
    assert.equal(body.summary.repositories, 101);
    assert.equal(body.repositories.filter((repository: Record<string, unknown>) =>
      repository.catalogStatus === "observed-only").length, 100);

    result = run({ ...fixture.env, SYNTHETIC_GH_MODE: "interrupted" }, [
      ...base, "--max-pages", "3", "--json",
    ]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stdout.includes("SYNTHETIC_FIXTURE_SECRET_INTERRUPTION"), false);
    body = JSON.parse(result.stdout);
    assert.equal(body.coverage.status, "partial");
    assert.deepEqual(body.coverage.sources[0].pages, {
      requested: 2,
      completed: 1,
      max: 3,
      nextPage: 2,
      truncated: false,
    });
    assert.equal(body.coverage.sources[0].counts.received, 100);
    assert.equal(body.repositories.length, 100);
    assert.deepEqual(body.coverage.sources[0].errors, [{
      code: "PAGE_FAILED",
      page: 2,
      causeCode: "1",
      httpStatus: 503,
    }]);

    result = run({ ...fixture.env, SYNTHETIC_GH_MODE: "pages" }, [
      ...base, "--max-pages", "1", "--json",
    ]);
    assert.equal(result.status, 3, result.stderr);
    body = JSON.parse(result.stdout);
    assert.equal(body.coverage.status, "partial");
    assert.equal(body.coverage.sources[0].counts.received, 100);
    assert.deepEqual(body.coverage.sources[0].pages, {
      requested: 1,
      completed: 1,
      max: 1,
      nextPage: 2,
      truncated: true,
    });
    assert.deepEqual(body.coverage.sources[0].errors, [{
      code: "PAGE_LIMIT",
      page: 2,
      causeCode: null,
      httpStatus: null,
    }]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A04 audit alone exits for decision findings while all commands preserve the same complete overview", async () => {
  const fixture = await setupFixture();
  try {
    const env = { ...fixture.env, SYNTHETIC_GH_MODE: "extra" };
    const flags = [
      "--config", fixture.configPath,
      "--source", "source-synthetic-org",
      "--max-pages", "2",
      "--json",
    ];
    const bodies: Record<string, any> = {};
    for (const command of ["discover", "list", "report", "audit"] as const) {
      const result = run(env, [command, ...flags]);
      assert.equal(result.status, command === "audit" ? 3 : 0, `${command}: ${result.stderr}`);
      assert.equal(result.stderr, "");
      bodies[command] = JSON.parse(result.stdout);
      assert.equal(bodies[command].coverage.status, "complete");
      assert.ok(bodies[command].findings.some((finding: Record<string, unknown>) =>
        finding.code === "UNCLASSIFIED_REPOSITORY" && finding.severity === "decision"
      ));
      assert.ok(bodies[command].findings.some((finding: Record<string, unknown>) =>
        finding.code === "ARCHIVED_REPOSITORY"
      ));
    }
    const reference = comparableOverview(bodies.discover);
    assert.deepEqual(comparableOverview(bodies.list), reference);
    assert.deepEqual(comparableOverview(bodies.report), reference);
    assert.deepEqual(comparableOverview(bodies.audit), reference);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
