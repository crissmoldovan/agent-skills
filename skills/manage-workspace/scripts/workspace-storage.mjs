#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  lstatSync, mkdirSync, opendirSync, readdirSync, readFileSync, realpathSync, rmdirSync,
  rmSync, statfsSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const markerName = '.agent-scratch.json';
const lockName = '.agent-storage-lock';
const runName = /^run-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const defaultContextMiB = 128n;
const defaultEntries = 10_000n;
const mib = 1024n * 1024n;
const options = {
  project: { type: 'string' },
  volume: { type: 'string' },
  'scratch-root': { type: 'string' },
  'context-max-mib': { type: 'string' },
  'context-max-entries': { type: 'string' },
  'min-free-mib': { type: 'string' },
  run: { type: 'string' },
  apply: { type: 'boolean' },
  closed: { type: 'boolean' },
};
const guardOptions = ['context-max-mib', 'context-max-entries', 'min-free-mib'];
const actions = {
  guard: ['project', 'volume', ...guardOptions],
  start: ['project', 'scratch-root', ...guardOptions],
  cleanup: ['project', 'run', 'apply', 'closed'],
};

function requireValue(values, key) {
  if (!values[key]) throw new Error('Supply --' + key);
  return values[key];
}

function integer(raw, fallback, name) {
  if (raw === undefined) return fallback;
  if (!/^[0-9]{1,19}$/.test(raw)) throw new Error('--' + name + ' must be a non-negative integer');
  return BigInt(raw);
}

function within(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function directory(location) {
  const stats = lstatSync(location, { bigint: true });
  if (!stats.isDirectory()) throw new Error('Expected a real directory at ' + location);
  return stats;
}

function privateDirectory(location, forbiddenMode) {
  const stats = directory(location);
  if (stats.uid !== BigInt(process.getuid()) || (stats.mode & forbiddenMode) !== 0n) {
    throw new Error('Expected a current-user directory with restricted permissions at ' + location);
  }
  return stats;
}

function identity(stats) {
  return [String(stats.dev), String(stats.ino)];
}

function availableBytes(volume) {
  const stats = statfsSync(volume, { bigint: true });
  return stats.bsize * stats.bavail;
}

function walk(root, visit) {
  const pending = [root];
  while (pending.length) {
    const parent = pending.pop();
    const dir = opendirSync(parent);
    try {
      for (let entry; (entry = dir.readSync()) !== null;) {
        const location = path.join(parent, entry.name);
        const stats = lstatSync(location, { bigint: true });
        visit(location, stats);
        if (stats.isDirectory()) pending.push(location);
      }
    } finally {
      dir.closeSync();
    }
  }
}

function guard(project, volume, values) {
  const context = path.join(project, '.context');
  const maxBytes = integer(values['context-max-mib'], defaultContextMiB, 'context-max-mib') * mib;
  const maxEntries = integer(values['context-max-entries'], defaultEntries, 'context-max-entries');
  const minimum = integer(values['min-free-mib'], 0n, 'min-free-mib') * mib;
  const available = availableBytes(volume);
  if (available < minimum) {
    throw new Error('Available space on ' + volume + ' is ' + available + ' bytes, below ' + minimum + ' bytes');
  }

  const stats = lstatSync(context, { bigint: true, throwIfNoEntry: false });
  let bytes = 0n;
  let entries = 0n;
  if (stats) {
    if (!stats.isDirectory()) throw new Error('Expected a real directory at ' + context);
    walk(context, (location, child) => {
      if (stats.dev !== child.dev) throw new Error('Unexpected filesystem inside .context at ' + location);
      entries += 1n;
      if (child.isFile()) bytes += child.size;
      if (bytes > maxBytes) throw new Error('.context exceeds ' + maxBytes + ' logical bytes at ' + location);
      if (entries > maxEntries) throw new Error('.context exceeds ' + maxEntries + ' entries at ' + location);
    });
  }
  return { project, volume, contextBytes: String(bytes), contextEntries: String(entries), availableBytes: String(available) };
}

function reserve(root, operation) {
  const lock = path.join(root, lockName);
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Scratch root is reserved at ' + lock);
    throw error;
  }
  try {
    return operation();
  } finally {
    rmdirSync(lock);
  }
}

function start(project, values) {
  const root = realpathSync.native(requireValue(values, 'scratch-root'));
  if (within(root, project)) throw new Error('Choose a scratch root outside the project');
  const rootStats = privateDirectory(root, 0o022n);
  requireValue(values, 'min-free-mib');
  const preflight = guard(project, root, values);
  return reserve(root, () => createRun(project, root, rootStats, preflight));
}

function createRun(project, root, rootStats, preflight) {
  const existing = readdirSync(root).find((name) => runName.test(name));
  if (existing) throw new Error('Existing run at ' + path.join(root, existing) + '. Use or retire it before starting another run here.');
  const run = path.join(root, 'run-' + randomUUID());
  mkdirSync(run, { mode: 0o700 });

  const owner = {
    version: 1,
    project,
    projectIdentity: identity(directory(project)),
    root,
    rootIdentity: identity(rootStats),
    runIdentity: identity(directory(run)),
  };
  const marker = path.join(run, markerName);
  const work = path.join(run, 'work');
  try {
    writeFileSync(marker, JSON.stringify(owner) + '\n', { mode: 0o600, flag: 'wx' });
    mkdirSync(work, { mode: 0o700 });
  } catch (error) {
    // Roll back only the entries created by an incomplete initialization.
    try {
      if (lstatSync(marker, { throwIfNoEntry: false })) unlinkSync(marker);
      rmdirSync(run);
    } catch (rollback) {
      throw new Error(error.message + '. Inspect the incomplete run at ' + run + ': ' + rollback.message);
    }
    throw error;
  }
  return { ...preflight, run, work };
}

function mountpoints() {
  if (process.platform === 'linux') {
    return readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map((line) =>
      line.split(' ')[4].replace(/\\([0-7]{3})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 8))),
    );
  }
  return execFileSync('/sbin/mount', [], { encoding: 'utf8' }).trim().split('\n').map((line) => {
    const found = line.match(/ on (.+) \([^()]*\)$/);
    if (!found) throw new Error('Could not verify the mount table');
    return found[1];
  });
}

function inspectRun(project, root, run) {
  const runStats = privateDirectory(run, 0o077n);
  const rootStats = privateDirectory(root, 0o022n);
  const marker = path.join(run, markerName);
  const markerStats = lstatSync(marker, { bigint: true, throwIfNoEntry: false });
  if (!markerStats?.isFile() || markerStats.uid !== runStats.uid || markerStats.size > 16_384n
      || markerStats.nlink !== 1n || (markerStats.mode & 0o077n) !== 0n) {
    throw new Error('Missing or unsafe run owner marker at ' + marker);
  }
  let owner;
  try {
    owner = JSON.parse(readFileSync(marker, 'utf8'));
  } catch {
    throw new Error('Invalid run owner marker at ' + marker);
  }
  if (owner?.version !== 1 || owner.project !== project || owner.root !== root || !runName.test(path.basename(run))
      || JSON.stringify(owner.projectIdentity) !== JSON.stringify(identity(directory(project)))
      || JSON.stringify(owner.rootIdentity) !== JSON.stringify(identity(rootStats))
      || JSON.stringify(owner.runIdentity) !== JSON.stringify(identity(runStats))) {
    throw new Error('Run owner marker does not match this project and directory');
  }
  const mounted = mountpoints().find((point) => within(point, run));
  if (mounted) throw new Error('Mount inside the run at ' + mounted);
  let bytes = 0n;
  let entries = 0n;
  walk(run, (location, stats) => {
    entries += 1n;
    if (stats.isFile()) bytes += stats.size;
    if (stats.dev !== runStats.dev) throw new Error('Unexpected filesystem inside the run at ' + location);
    if (path.basename(location) === '.git') throw new Error('Git metadata inside the run at ' + location + '. Retire the checkout using Git first.');
  });
  return { run, entries: String(entries), logicalBytes: String(bytes) };
}

function cleanup(project, values) {
  const supplied = requireValue(values, 'run');
  if (!path.isAbsolute(supplied) || supplied.split(path.sep).includes('..')) {
    throw new Error('Use the absolute run path printed by start without parent traversal');
  }
  const requested = path.normalize(supplied);
  const root = realpathSync.native(path.dirname(requested));
  const run = path.join(root, path.basename(requested));
  if (within(run, project) || within(project, run)) throw new Error('Run overlaps the project');
  privateDirectory(root, 0o022n);
  if (!values.apply) return { ...inspectRun(project, root, run), removed: false };
  if (!values.closed) throw new Error('Pass --closed only after confirming all writers ended and required evidence is retained');
  return reserve(root, () => retireRun(project, root, run));
}

function retireRun(project, root, run) {
  const report = inspectRun(project, root, run);
  const before = availableBytes(root);
  for (const name of readdirSync(run)) {
    if (name !== markerName) rmSync(path.join(run, name), { recursive: true, maxRetries: 0 });
  }
  unlinkSync(path.join(run, markerName));
  rmdirSync(run);
  if (lstatSync(run, { throwIfNoEntry: false })) throw new Error('Run still exists at ' + run);
  const after = availableBytes(root);
  return {
    ...report, removed: true, availableBefore: String(before), availableAfter: String(after),
    availableChange: String(after - before),
  };
}

try {
  const [action, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(actions, action)) throw new Error('Choose guard, start, or cleanup');
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Use this helper on macOS or Linux');
  const enabled = Object.fromEntries(actions[action].map((key) => [key, options[key]]));
  const { values } = parseArgs({ args, options: enabled });
  const project = realpathSync.native(requireValue(values, 'project'));
  directory(project);
  const result = action === 'guard'
    ? guard(project, realpathSync.native(values.volume ?? project), values)
    : action === 'start' ? start(project, values) : cleanup(project, values);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('workspace-storage: ' + error.message);
  process.exitCode = 1;
}
