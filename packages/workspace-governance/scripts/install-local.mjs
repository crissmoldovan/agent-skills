#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

const PACKAGE_NAME = "@crissmoldovan/workspace-governance";
const VERSION = "0.3.0";
const LAUNCHER_MARKER = "# workspacectl-managed-launcher-v1";

class InstallError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstallError";
  }
}

function fail(message) {
  throw new InstallError(message);
}

function parseArguments(args) {
  const values = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--archive", "--prefix", "--launcher"].includes(flag) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 16_384 ||
      Object.hasOwn(values, flag)
    ) fail("Invalid arguments. Use --archive FILE --prefix DIR --launcher FILE.");
    values[flag] = value;
  }
  for (const flag of ["--archive", "--prefix", "--launcher"])
    if (!Object.hasOwn(values, flag) || !isAbsolute(values[flag]))
      fail("Archive, prefix, and launcher paths must all be explicit absolute paths.");
  if (basename(values["--prefix"]) !== VERSION)
    fail(`The versioned prefix must end in /${VERSION}.`);
  return {
    archive: values["--archive"],
    prefix: values["--prefix"],
    launcher: values["--launcher"],
  };
}

async function pathKind(path) {
  try {
    const stat = await lstat(path);
    return stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "absent";
    throw error;
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function launcherText(runtime, cli, prefix, launcher) {
  return `#!/bin/sh
${LAUNCHER_MARKER}
set -eu
runtime=${shellQuote(runtime)}
cli=${shellQuote(cli)}
prefix=${shellQuote(prefix)}
launcher=${shellQuote(launcher)}
if [ ! -x "$runtime" ]; then
  printf '%s\n' \
    'workspacectl: the Node.js runtime selected during installation is unavailable.' \
    'Remedy: reinstall workspacectl with Node.js 24 or newer using install-local.sh.' >&2
  exit 2
fi
major=$("$runtime" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')
case "$major" in ''|*[!0-9]*) major=0 ;; esac
if [ "$major" -lt 24 ]; then
  printf '%s\n' \
    'workspacectl: the selected runtime no longer satisfies Node.js 24 or newer.' \
    'Remedy: reinstall workspacectl with a supported runtime using install-local.sh.' >&2
  exit 2
fi
export WORKSPACECTL_INSTALL_PREFIX="$prefix"
export WORKSPACECTL_LAUNCHER="$launcher"
export WORKSPACECTL_RUNTIME_PATH="$runtime"
exec "$runtime" "$cli" "$@"
`;
}

async function main() {
  const { archive, prefix, launcher } = parseArguments(process.argv.slice(2));
  const runtime = process.env.WORKSPACECTL_INSTALL_NODE;
  const npm = process.env.WORKSPACECTL_INSTALL_NPM;
  if (!runtime || !npm || runtime !== process.execPath)
    fail("Run install-local.sh so prerequisites and the selected runtime are checked first.");
  if ((await pathKind(archive)) !== "file") fail("The package archive is not a readable regular file.");
  if ((await pathKind(prefix)) !== "absent") fail("The versioned prefix is already occupied; nothing was changed.");
  const launcherKind = await pathKind(launcher);
  const replacingLauncher = launcherKind === "file";
  if (
    launcherKind !== "absent" &&
    (!replacingLauncher ||
      !(await readFile(launcher, "utf8")).startsWith(`#!/bin/sh\n${LAUNCHER_MARKER}\n`))
  ) fail("The launcher path is already occupied; nothing was changed.");

  await mkdir(dirname(prefix), { recursive: true, mode: 0o700 });
  await mkdir(dirname(launcher), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(prefix), `.workspacectl-${VERSION}-`));
  let installed = false;
  try {
    const cache = join(staging, ".npm-cache");
    const outcome = spawnSync(npm, [
      "install",
      "--global",
      "--prefix",
      staging,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      cache,
      archive,
    ], {
      encoding: "utf8",
      env: process.env,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    if (outcome.error || outcome.signal || outcome.status !== 0)
      fail("npm could not install the reviewed package archive; the versioned prefix was not created.");
    await rm(cache, { recursive: true, force: true });

    const packageRoot = join(staging, "lib", "node_modules", "@crissmoldovan", "workspace-governance");
    const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (metadata.name !== PACKAGE_NAME || metadata.version !== VERSION)
      fail("The archive package name or version does not match this installer.");
    const cli = join(packageRoot, "dist", "cli.js");
    if ((await pathKind(cli)) !== "file") fail("The archive does not contain the workspacectl CLI.");

    const marker = {
      schemaVersion: 1,
      package: PACKAGE_NAME,
      version: VERSION,
      prefix,
      launcher,
      runtime,
    };
    await writeFile(
      join(staging, ".workspacectl-install.json"),
      JSON.stringify(marker, null, 2) + "\n",
      { mode: 0o600 },
    );
    await rename(staging, prefix);
    installed = true;

    const launcherDirectory = await mkdtemp(join(dirname(launcher), ".workspacectl-launcher-"));
    const candidate = join(launcherDirectory, "workspacectl");
    try {
      await writeFile(candidate, launcherText(runtime, cli.replace(staging, prefix), prefix, launcher), {
        mode: 0o755,
      });
      await chmod(candidate, 0o755);
      if (replacingLauncher) await rename(candidate, launcher);
      else {
        await link(candidate, launcher);
        await unlink(candidate);
      }
    } finally {
      await rm(launcherDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    if (installed) await rm(prefix, { recursive: true, force: true });
    else await rm(staging, { recursive: true, force: true });
    throw error;
  }

  process.stdout.write(
    `Installed workspacectl ${VERSION}\n` +
      `Version prefix: ${prefix}\n` +
      `Launcher: ${launcher}\n` +
      `Runtime: ${runtime}\n` +
      "No config, skill, credential, provider, or Hermes settings were changed.\n",
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof InstallError ? error.message : "Installation failed safely; nothing outside the requested paths was changed.";
  process.stderr.write(`workspacectl installer: ${message}\n`);
  process.exitCode = 2;
}
