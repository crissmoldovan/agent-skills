#!/usr/bin/env node
/**
 * Validate committed decision digests under `docs/decisions/`.
 *
 * This checks SHAPE, and cannot check freshness. §6.2 puts the journal at
 * `~/.agents/journal/` — on a developer's machine, deliberately outside the
 * repo, because segments carry hostnames and home paths. A CI runner therefore
 * has nothing to render from and no way to know whether a committed digest
 * still matches the journal it came from. A reader should not take a passing
 * run as "this digest is current"; it means "this digest is intact".
 *
 * What that is still worth catching: a digest that was hand-edited, truncated
 * mid-write, or committed with its coverage statement removed. §10.3 makes the
 * coverage statement this design's honesty control — a digest without one looks
 * complete while saying nothing about what it could not see, which is the one
 * failure mode a rendered artifact must not have.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const digestDir = join(root, 'docs', 'decisions');
const failures = [];
const fail = (message) => failures.push(message);

/** Lines every digest carries, from `renderDigest`. Kept as substrings rather
 *  than a whole-file comparison: a digest's body is the point, and pinning it
 *  exactly would make this script fail on every real change. */
const REQUIRED = [
  { needle: '# Decision digest', why: 'the title renderDigest emits' },
  { needle: 'This is a rendered artifact, never the source of truth.', why: '§6.4\'s own disclaimer' },
  { needle: '## Coverage', why: '§10.3\'s coverage statement — the honesty control' },
  { needle: '- sessions observed:', why: 'the coverage block\'s first real figure' },
  {
    needle: '`not assessed` is not `none`',
    why: 'the line distinguishing NOT ASSESSED from assessed-and-empty',
  },
];

if (!existsSync(digestDir)) {
  console.log('No docs/decisions/ directory; nothing to validate.');
  process.exit(0);
}

const files = readdirSync(digestDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.md'))
  .map((e) => join(digestDir, e.name));

if (files.length === 0) {
  console.log('docs/decisions/ contains no digests; nothing to validate.');
  process.exit(0);
}

for (const file of files) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');

  if (statSync(file).size === 0) {
    fail(`${rel}: empty. A digest with nothing in it is worse than none — it reads as "no decisions".`);
    continue;
  }

  for (const { needle, why } of REQUIRED) {
    if (!text.includes(needle)) fail(`${rel}: missing ${why} (expected to contain ${JSON.stringify(needle)})`);
  }

  // The coverage block must be the LAST section. renderDigest puts it there so
  // a reader who stops early has still seen every entry; a digest with content
  // after it has been appended to by hand.
  const coverageAt = text.lastIndexOf('## Coverage');
  if (coverageAt !== -1) {
    const after = text.slice(coverageAt);
    if (/\n## (?!Coverage)/.test(after)) {
      fail(`${rel}: content appears after the coverage block — it was edited by hand, and a digest is generated, never written.`);
    }
  }

  // Two coverage blocks means one was forged: an entry's own content can render
  // a second `## Coverage` heading with fabricated counts above the real one.
  // renderDigest sanitises for this; a committed file can still carry it.
  const coverageCount = (text.match(/^## Coverage$/gm) ?? []).length;
  if (coverageCount > 1) {
    fail(`${rel}: ${coverageCount} coverage blocks. Only one is real; the rest are forged counts a reader would believe.`);
  }
}

if (failures.length > 0) {
  console.error(`Digest validation failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const message of failures) console.error(`- ${message}`);
  console.error('\nRegenerate with: agent-journal digest --workspace <id> --out docs/decisions/<id>.md');
  console.error('This checks shape only — a passing run does NOT mean a digest is current.');
  process.exitCode = 1;
} else {
  console.log(`Digest validation passed: ${files.length} digest${files.length === 1 ? '' : 's'} intact (shape only, not freshness).`);
}
