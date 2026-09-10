#!/usr/bin/env node
/**
 * Bundle the agent-journal CLI into one self-contained file inside the
 * decision-journal skill, so that installing the skill installs the tool.
 *
 * One file rather than the 25 compiled modules: the catalogue accepts skill files
 * one level deep, and a skill folder of index.js and paths.js beside an installer
 * would be unreadable. esbuild because it needs no configuration for this; it is a
 * devDependency, used only here, and never by the program it builds.
 *
 * The header format and both hashes come from scripts/verify-journal-bundle.mjs,
 * so there is exactly one definition of what "current" means.
 */
import * as esbuild from 'esbuild';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { BUNDLE_PATH, ROOT, SOURCE_DIR, renderHeader, sourceHash } from '../../../scripts/verify-journal-bundle.mjs';

const result = await esbuild.build({
  entryPoints: [join(SOURCE_DIR, 'bin.ts')],
  // Fixed, so the module-boundary comments esbuild writes read the same whichever
  // directory this is run from — otherwise the body changes with the caller's cwd.
  absWorkingDir: join(SOURCE_DIR, '..'),
  outfile: BUNDLE_PATH,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});

let body = result.outputFiles[0].text;
// esbuild keeps the entry file's own hashbang. A second one below the header would
// be a syntax error, so the header carries the only one.
if (body.startsWith('#!')) body = body.slice(body.indexOf('\n') + 1);

const text = renderHeader({ source: sourceHash(), body }) + body;
mkdirSync(dirname(BUNDLE_PATH), { recursive: true });
writeFileSync(BUNDLE_PATH, text);
chmodSync(BUNDLE_PATH, 0o755);
console.log(`Wrote ${relative(ROOT, BUNDLE_PATH)} (${(Buffer.byteLength(text) / 1024).toFixed(1)} KB)`);
