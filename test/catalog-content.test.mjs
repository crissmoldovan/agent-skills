import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const readme = await read('README.md');
const routing = await read('skills/model-routing/SKILL.md');
const lifecycle = await read('skills/agent-lifecycle/SKILL.md');
const blocks = await read('skills/blocks/SKILL.md');
const requestBlocksReview = await read('skills/request-blocks-review/SKILL.md');
const secureCredentialSetup = await read('skills/secure-credential-setup/SKILL.md');
const deriveCodebaseContext = await read('skills/derive-codebase-context/SKILL.md');
const publishAgentSkill = await read('skills/publish-agent-skill/SKILL.md');

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

test('README carries the theme-aware pack header and public-author footer', () => {
  assert.match(readme, /prefers-color-scheme: dark/);
  assert.match(readme, /prefers-color-scheme: light/);
  assert.match(readme, /assets\/cue-logo-dark\.svg/);
  assert.match(readme, /assets\/cue-logo-light\.svg/);
  assert.match(readme, /Agent skills pack/);
  assert.match(readme, /package of agent skills published by \*\*Criss Moldovan\*\*/);
  assert.match(readme, /Made by Criss Moldovan/);
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

test('blocks skill documents GitHub review interaction and bounded waiting', () => {
  const examples = section(blocks, 'Usage Examples');
  assert.match(examples, /Blocks|session|status/i);
  assert.match(blocks, /REST Sessions API/i);
  assert.match(blocks, /bounded wait|await visibly/i);
  assert.match(blocks, /Generic Blocks interaction primitives/i);
  assert.doesNotMatch(blocks, /\bCUE\b|\bRGC\b/);
});

test('request-blocks-review uses blocks and loops completed PRs until current-head green', () => {
  assert.match(requestBlocksReview, /final code-review gate/i);
  assert.match(requestBlocksReview, /Load the public `blocks` skill/i);
  assert.match(requestBlocksReview, /Repeat until green/i);
  assert.match(requestBlocksReview, /current head clean/i);
  assert.doesNotMatch(requestBlocksReview, /\bCUE\b|\bRGC\b/);
});

test('secure-credential-setup requests one secret at a time without disclosure', () => {
  assert.match(secureCredentialSetup, /one credential at a time/i);
  assert.match(secureCredentialSetup, /Never request a secret in chat/i);
  assert.match(secureCredentialSetup, /two stages/i);
  assert.match(secureCredentialSetup, /verify.*authentication/i);
  assert.match(secureCredentialSetup, /explicit profile/i);
  assert.match(secureCredentialSetup, /references\/terminal-entry-patterns\.md/);
});

test('publish-agent-skill is generic and external targets are explicit opt-ins', () => {
  assert.match(publishAgentSkill, /author.*validat.*review.*releas/is);
  assert.match(publishAgentSkill, /discover.*repository.*owner.*target/is);
  assert.match(publishAgentSkill, /external|sidecar/i);
  assert.match(publishAgentSkill, /explicitly (?:asks|requested|mentions)|opt[- ]in/i);
  assert.match(publishAgentSkill, /must not infer|do not infer|never infer/i);
  assert.match(publishAgentSkill, /repository policy.*(?:cannot|must not).*(?:select|authorize)|(?:cannot|must not).*(?:select|authorize).*repository policy/is);
  assert.doesNotMatch(publishAgentSkill, /cueplusplus\/skills|crissmoldovan\/agent-skills|cue:/i);
});

test('frontmatter stays compatible with Agent Skills and skills.sh discovery', () => {
  for (const [name, source] of [['model-routing', routing], ['agent-lifecycle', lifecycle], ['blocks', blocks], ['request-blocks-review', requestBlocksReview], ['secure-credential-setup', secureCredentialSetup], ['derive-codebase-context', deriveCodebaseContext], ['publish-agent-skill', publishAgentSkill]]) {
    assert.match(source, new RegExp(`^---\\nname: ${name}\\n`));
    const description = source.match(/^description:\s*["']?([^"'\n]+)["']?$/m)?.[1] ?? '';
    assert.ok(description.length > 0 && description.length <= 1024);
    assert.match(description, /(?:route|child|lifecycle|delegat|Blocks|review|secret|credential|context|codebase|publish|release)/i);
  }
});
