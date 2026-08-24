import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const readme = await read('README.md');
const routing = await read('skills/model-routing/SKILL.md');
const lifecycle = await read('skills/agent-lifecycle/SKILL.md');

function section(source, heading) {
  const start = source.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing ## ${heading}`);
  const rest = source.slice(start + heading.length + 3);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

test('package README lists every discovered skill with description and detail link', async () => {
  const skillNames = (await import('node:fs/promises')).readdir(new URL('skills/', root), { withFileTypes: true });
  for (const entry of await skillNames) {
    if (!entry.isDirectory()) continue;
    const manifest = await read(`skills/${entry.name}/SKILL.md`);
    const description = manifest.match(/^description:\s*["']?([^"'\n]+)["']?$/m)?.[1];
    assert.ok(description, `${entry.name} description missing`);
    assert.match(readme, new RegExp(`skills/${entry.name}/SKILL\\.md`));
    assert.ok(readme.includes(description), `${entry.name} README description differs from frontmatter`);
  }
});

test('README carries the theme-aware CUE++ pack header and maker footer', () => {
  assert.match(readme, /prefers-color-scheme: dark/);
  assert.match(readme, /prefers-color-scheme: light/);
  assert.match(readme, /assets\/cue-logo-dark\.svg/);
  assert.match(readme, /assets\/cue-logo-light\.svg/);
  assert.match(readme, /Agent skills pack/);
  assert.match(readme, /package of agent skills published by \*\*CUE\+\+\*\*/);
  assert.match(readme, /Made by CUE\+\+/);
});

test('README has a how-to and concrete examples for both skills', () => {
  const howTo = section(readme, 'How to use the skills');
  for (const phrase of ['Show routing', 'Set up routing', 'Use the active routing profile', 'Show the current child lifecycle status']) {
    assert.ok(howTo.includes(phrase), `README how-to missing: ${phrase}`);
  }
  assert.match(howTo, /model-routing/);
  assert.match(howTo, /agent-lifecycle/);
});

test('model-routing skill contains invocation examples and expected routing behavior', () => {
  const examples = section(routing, 'Usage Examples');
  for (const phrase of ['Show routing', 'Set up routing', 'Use the active routing profile', 'deterministic local tools', 'BUILDER']) {
    assert.ok(examples.includes(phrase), `routing example missing: ${phrase}`);
  }
});

test('agent-lifecycle skill contains integration and end-user visibility examples', () => {
  const examples = section(lifecycle, 'Usage Examples');
  for (const phrase of ['Show the current child lifecycle status', 'running', 'waiting', 'completed', 'DISPLAY ONLY']) {
    assert.ok(examples.includes(phrase), `lifecycle example missing: ${phrase}`);
  }
});

test('frontmatter stays compatible with Agent Skills and skills.sh discovery', () => {
  for (const [name, source] of [['model-routing', routing], ['agent-lifecycle', lifecycle]]) {
    assert.match(source, new RegExp(`^---\\nname: ${name}\\n`));
    const description = source.match(/^description:\s*["']?([^"'\n]+)["']?$/m)?.[1] ?? '';
    assert.ok(description.length > 0 && description.length <= 1024);
    assert.match(description, /(?:route|child|lifecycle|delegat)/i);
  }
});
