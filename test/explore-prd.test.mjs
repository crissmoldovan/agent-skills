import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { assertCatalogueShape } from './helpers/skill-contract.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

// Reuse the pack's discovery contract. The carried scenario cards are manual
// maintenance exercises; this test checks catalogue shape, not workflow behavior.
test('explore-prd carries the catalogue discovery and reference contract', async () => {
  const references = await readdir(new URL('skills/explore-prd/references/', root));
  assertCatalogueShape('explore-prd', {
    skill: await read('skills/explore-prd/SKILL.md'),
    references,
    fit: JSON.parse(await read('skills/explore-prd/references/fit.json')),
    readme: await read('README.md'),
  });
});
