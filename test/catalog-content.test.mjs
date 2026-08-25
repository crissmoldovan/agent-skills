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
const updateAgentSkills = await read('skills/update-agent-skills/SKILL.md');
const releaseLedger = await read('skills/release-ledger/SKILL.md');
const githubWebhooks = await read('skills/github-webhooks/SKILL.md');
const describeChanges = await read('skills/describe-changes/SKILL.md');

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
  assert.match(readme, /public package by \*\*Criss Moldovan\*\*/);
  assert.match(readme, /Made by Criss Moldovan/);
  assert.match(readme, /<h1 align="center">Agent skills pack<\/h1>/);
});

test('README presents the complete pack and human, agent, and update paths', () => {
  assert.match(readme, /eleven public, portable Agent Skills/i);
  assert.match(readme, /Install — for humans/);
  assert.match(readme, /Install — for agents and LLMs/);
  assert.match(readme, /Update the pack/);
  assert.match(readme, /npx skills list --global --json/);
  assert.match(readme, /npx skills update --project --yes/);
  assert.match(readme, /npx skills update --global --yes/);
  assert.match(readme, /--agent '\*'/);
  assert.match(readme, /All-plane update contract/);
  assert.match(readme, /Native plugin\/package/);
  assert.match(readme, /Unsupported client/);
  assert.match(readme, /manual action required/);
  assert.doesNotMatch(readme.slice(0, readme.indexOf('## What is in the pack')), /DRIVER|BUILDER|SWEEPER|Fable|Opus|Haiku/);
});

test('README has concrete examples across the pack', () => {
  const howTo = section(readme, 'Use the skills');
  for (const name of ['model-routing', 'agent-lifecycle', 'request-blocks-review', 'secure-credential-setup', 'derive-codebase-context', 'publish-agent-skill', 'update-agent-skills', 'release-ledger', 'github-webhooks', 'describe-changes']) {
    assert.ok(howTo.includes(name), `README use examples missing: ${name}`);
  }
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
  assert.match(publishAgentSkill, /provenance/i);
  assert.match(publishAgentSkill, /global.*project|project.*global/is);
  assert.match(publishAgentSkill, /all supported agents|every supported agent/i);
  assert.match(publishAgentSkill, /copy.*symlink|symlink.*copy/is);
  assert.match(publishAgentSkill, /managed.*unmanaged|unmanaged.*managed/is);
  assert.match(publishAgentSkill, /native plugin|plugin-native/i);
  assert.match(publishAgentSkill, /manual|upload/i);
  assert.match(publishAgentSkill, /unsupported/i);
  assert.match(publishAgentSkill, /npx skills (?:list|ls).*--json/is);
  assert.match(publishAgentSkill, /npx skills update.*--global.*--yes/is);
  assert.match(publishAgentSkill, /npx skills update.*--project.*--yes/is);
  assert.match(publishAgentSkill, /--agent ['"]?\*['"]?/i);
  assert.match(publishAgentSkill, /restart|reload/i);
  assert.match(publishAgentSkill, /installed bytes|byte.*published|hash/i);
  assert.match(publishAgentSkill, /catalog(?:ue)? README|repository README/i);
  assert.match(publishAgentSkill, /release notes/i);
  assert.match(publishAgentSkill, /human.*(?:outcome|reader|changed)|(?:outcome|reader|changed).*human/is);
  assert.match(publishAgentSkill, /encourage.*update|update guidance|how to update/i);
  assert.match(publishAgentSkill, /explicitly (?:asks|requested|mentions)|opt[- ]in/i);
  assert.match(publishAgentSkill, /must not infer|do not infer|never infer/i);
  assert.match(publishAgentSkill, /repository policy.*(?:cannot|must not).*(?:select|authorize)|(?:cannot|must not).*(?:select|authorize).*repository policy/is);
  assert.doesNotMatch(publishAgentSkill, /cueplusplus\/skills|crissmoldovan\/agent-skills|cue:/i);
});

test('update-agent-skills maintains communication and every local plane', () => {
  assert.match(updateAgentSkills, /inventory/i);
  assert.match(updateAgentSkills, /global.*project|project.*global/is);
  assert.match(updateAgentSkills, /all supported agents|every supported agent/i);
  assert.match(updateAgentSkills, /copy.*symlink|symlink.*copy/is);
  assert.match(updateAgentSkills, /managed.*unmanaged|unmanaged.*managed/is);
  assert.match(updateAgentSkills, /native plugin|plugin-native/i);
  assert.match(updateAgentSkills, /manual action required|manual\/upload/i);
  assert.match(updateAgentSkills, /unsupported/i);
  assert.match(updateAgentSkills, /changelog/i);
  assert.match(updateAgentSkills, /catalog(?:ue)? README|repository README/i);
  assert.match(updateAgentSkills, /release notes/i);
  assert.match(updateAgentSkills, /encourage.*update|update guidance|how to update/i);
  assert.match(updateAgentSkills, /npx skills update.*--global.*--yes/is);
  assert.match(updateAgentSkills, /npx skills update.*--project.*--yes/is);
  assert.match(updateAgentSkills, /restart|reload/i);
  assert.match(updateAgentSkills, /installed bytes|byte.*published|hash/i);
  assert.match(updateAgentSkills, /explicitly (?:asks|requested|mentions)|opt[- ]in/i);
  assert.doesNotMatch(updateAgentSkills, /cueplusplus\/skills|crissmoldovan\/agent-skills|cue:/i);
});

test('frontmatter stays compatible with Agent Skills and skills.sh discovery', () => {
  for (const [name, source] of [['model-routing', routing], ['agent-lifecycle', lifecycle], ['blocks', blocks], ['request-blocks-review', requestBlocksReview], ['secure-credential-setup', secureCredentialSetup], ['derive-codebase-context', deriveCodebaseContext], ['publish-agent-skill', publishAgentSkill], ['update-agent-skills', updateAgentSkills], ['release-ledger', releaseLedger], ['github-webhooks', githubWebhooks], ['describe-changes', describeChanges]]) {
    assert.match(source, new RegExp(`^---\\nname: ${name}\\n`));
    const description = source.match(/^description:\s*["']?([^"'\n]+)["']?$/m)?.[1] ?? '';
    assert.ok(description.length > 0 && description.length <= 1024);
    assert.match(description, /(?:route|child|lifecycle|delegat|Blocks|review|secret|credential|context|codebase|publish|release|update|webhook|change)/i);
  }
});

test('release-ledger onboards a system rather than shipping a library', () => {
  assert.match(releaseLedger, /implementation\.md/);
  assert.match(releaseLedger, /watermark/i);
  assert.match(releaseLedger, /github-webhooks/);
  assert.match(releaseLedger, /describe-changes/);
  assert.match(releaseLedger, /npx skills add crissmoldovan\/agent-skills/);
  assert.match(releaseLedger, /references\/onboarding-checklist\.md/);
  assert.doesNotMatch(releaseLedger, /\bCUE\b|\bRGC\b/);
});

test('github-webhooks verifies before routing and documents real event types', () => {
  assert.match(githubWebhooks, /HMAC-SHA256/);
  assert.match(githubWebhooks, /constant-time/i);
  assert.match(githubWebhooks, /X-Hub-Signature-256/);
  assert.match(githubWebhooks, /X-GitHub-Event/);
  assert.match(githubWebhooks, /references\/event-types\.md/);
  assert.doesNotMatch(githubWebhooks, /\bCUE\b|\bRGC\b/);
});

test('describe-changes classifies once and anchors claims in the diff', () => {
  assert.match(describeChanges, /feature.*bug_fix.*improvement.*security.*ops.*docs.*breaking/s);
  assert.match(describeChanges, /short.*medium.*detail/is);
  assert.match(describeChanges, /never claim a change does something the diff does not show/i);
  assert.match(describeChanges, /references\/output-contract\.md/);
  assert.doesNotMatch(describeChanges, /\bCUE\b|\bRGC\b/);
});
