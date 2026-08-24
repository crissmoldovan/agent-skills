import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
// Use the stable system /tmp root rather than an externally overridden TMPDIR.
// npm persists local `file:` source paths in lock metadata, and transient
// TMPDIR aliases/removal can make repeated release verification resolve a
// previous tarball pathname. This fixture is outside the package tree and is
// always removed in `finally`.
const tempRoot = await mkdtemp('/tmp/agent-lifecycle-consumer-');

function run(command, args, cwd = packageRoot) {
  // This script itself runs under `npm run`, which injects npm_package_* and
  // npm_config_* variables describing the parent checkout. A nested npm
  // install can mistake those inherited local-source coordinates for the
  // candidate tarball. Preserve ordinary process environment, but give every
  // nested npm command a clean npm-specific environment.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_')));
  return execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  run('npm', ['run', 'clean']);
  run('npm', ['run', 'build']);

  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tempRoot]));
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== 'string') {
    throw new Error('npm pack did not report exactly one tarball');
  }

  const packedTarball = join(tempRoot, packed[0].filename);
  // Give every local source a unique pathname. npm may retain the resolved
  // `file:` source for the same package name/version across repeated release
  // checks even with a fresh consumer and cache.
  const tarball = join(tempRoot, `candidate-${process.pid}-${Date.now()}.tgz`);
  await copyFile(packedTarball, tarball);
  const consumerRoot = await mkdtemp(join(tempRoot, 'consumer-'));
  await writeFile(join(consumerRoot, 'package.json'), JSON.stringify({ name: 'package-consumer-check', private: true, type: 'module' }, null, 2));
  // A unique cache is required because npm caches local `file:` resolution by
  // package name/version; repeated verification of the same candidate can
  // otherwise reuse the pathname of a tarball from an already-removed fixture.
  run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--cache', join(tempRoot, 'npm-cache'), tarball,
  ], consumerRoot);

  const consumerCheck = join(consumerRoot, 'verify.mjs');
  await writeFile(consumerCheck, `
import { LifecycleProjector, normalizeLifecycleEvent } from ${JSON.stringify(packageJson.name)};
import { normalizeHermesDelegationEvent } from ${JSON.stringify(`${packageJson.name}/hermes-delegation-reconciliation`)};

const hermesInput = normalizeHermesDelegationEvent({
  type: 'subagent.spawn_requested',
  child_id: 'hermes-child-1',
  session_id: 'hermes-session-1',
  observed_at: '2026-08-24T09:00:00.000Z',
});
if (hermesInput.kind !== 'created' || hermesInput.state !== 'created') {
  throw new Error('public Hermes delegation reconciliation adapter failed');
}

const events = [
  {
    schemaVersion: 1,
    eventId: 'consumer-created',
    source: 'consumer',
    sourceEpoch: 'epoch-1',
    childId: 'child-1',
    lineage: { rootChildId: 'child-1', attempt: 0, external: false },
    kind: 'created',
    state: 'created',
    observedAt: '2026-08-24T09:00:00.000Z',
    sequence: 1,
  },
  {
    schemaVersion: 1,
    eventId: 'consumer-started',
    source: 'consumer',
    sourceEpoch: 'epoch-1',
    childId: 'child-1',
    lineage: { rootChildId: 'child-1', attempt: 0, external: false },
    kind: 'state_changed',
    state: 'starting',
    observedAt: '2026-08-24T09:00:01.000Z',
    sequence: 2,
  },
];
const projector = new LifecycleProjector();
for (const event of events) projector.apply(normalizeLifecycleEvent(event));
if (projector.snapshot('consumer', 'child-1')?.state !== 'starting') {
  throw new Error('public lifecycle replay API failed');
}
console.log('fresh consumer imports, Hermes adapter normalization, and lifecycle replay OK');
`);
  run(process.execPath, [consumerCheck], consumerRoot);
  console.log(`package consumer verification OK (${basename(tarball)})`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
