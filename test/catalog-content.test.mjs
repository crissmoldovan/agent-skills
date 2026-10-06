import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp-dir.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const readme = await read('README.md');
const releases = await read('docs/releases.md');
const changelogText = await read('CHANGELOG.md');
const architecture = await read('docs/architecture.md');
const composition = await read('docs/composition.md');
const codeowners = await read('.github/CODEOWNERS');
const rootPackage = JSON.parse(await read('package.json'));
const rootLock = JSON.parse(await read('package-lock.json'));
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
const investigateCodebase = await read('skills/investigate-codebase/SKILL.md');
const blastArea = await read('skills/blast-area/SKILL.md');
const visualiseBlastArea = await read('skills/visualise-blast-area/SKILL.md');
const landComplexChange = await read('skills/land-complex-change/SKILL.md');
const resolveProblemReport = await read('skills/resolve-problem-report/SKILL.md');
const layerRepositoryDocs = await read('skills/layer-repository-docs/SKILL.md');
const isolatedChangeValidation = await read('skills/isolated-change-validation/SKILL.md');
const onboardProject = await read('skills/onboard-project/SKILL.md');
const onboardProjectFitSignals = await read('skills/onboard-project/references/fit-signals.md');
const onboardProjectWrites = await read('skills/onboard-project/references/what-gets-written.md');
const isolatedChangeValidationEvidence = await read('skills/isolated-change-validation/references/evidence-contract.md');
const isolatedChangeValidationHandoff = await read('skills/isolated-change-validation/references/handoff-bundle.md');
const layerRepositoryDocsEntryPoints = await read('skills/layer-repository-docs/references/entry-points.md');
const layerRepositoryDocsEvaluation = await read('docs/layer-repository-docs/evaluation.md');
const newUxDiscovery = await read('skills/new-ux-discovery/SKILL.md');
const releaseNotes = await read('skills/release-notes/SKILL.md');

// A description may be a double-quoted scalar containing apostrophes, a single-quoted
// scalar, or a bare value; all three forms yield the exact published description.
function descriptionOf(source) {
  const match = source.match(/^description:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\n]+?))[ \t]*$/m);
  return match ? (match[1] ?? match[2] ?? match[3]) : '';
}

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
    const description = descriptionOf(manifest);
    assert.ok(description, `${entry.name} description missing`);
    assert.match(readme, new RegExp(`skills/${entry.name}/SKILL\\.md`));
    assert.ok(readme.includes(description), `${entry.name} README description differs from frontmatter`);
  }
});

test('v0.27.1 release metadata, catalog, and review ownership cover the complete pack', async () => {
  assert.equal(rootPackage.version, '0.27.1');
  assert.equal(rootLock.version, '0.27.1');
  assert.equal(rootLock.packages[''].version, '0.27.1');

  const entries = await (await import('node:fs/promises')).readdir(new URL('skills/', root), { withFileTypes: true });
  const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.equal(skillNames.length, 30);
  for (const name of skillNames) assert.ok(releases.includes(`\`${name}\``), `release catalog missing: ${name}`);
  assert.match(architecture, /now ships thirty skills/i);
  assert.match(composition, /catalog ships thirty skills/i);

  assert.match(codeowners, /@crissmoldovan/);
  assert.doesNotMatch(codeowners, /@cueplusplus\/maintainers/);
});

test('README carries the pack header and public-author footer, and no CUE++ branding', () => {
  // The pack is published under the maintainer's own name; the CUE++ marks
  // were removed deliberately and must not drift back in.
  assert.doesNotMatch(readme, /cue-logo|CUE\+\+/i);
  assert.match(readme, /Agent skills pack/);
  assert.match(readme, /public package by \*\*Criss Moldovan\*\*/);
  assert.match(readme, /Made by Criss Moldovan/);
  assert.match(readme, /<h1 align="center">Agent skills pack<\/h1>/);
});

test('README presents the complete pack and human, agent, and update paths', () => {
  assert.match(readme, /thirty public, portable Agent Skills/i);
  assert.match(readme, /^Thirty skills\. Each one below/m);
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
  for (const name of ['model-routing', 'agent-lifecycle', 'request-blocks-review', 'secure-credential-setup', 'derive-codebase-context', 'publish-agent-skill', 'update-agent-skills', 'release-ledger', 'github-webhooks', 'describe-changes', 'investigate-codebase', 'blast-area', 'visualise-blast-area', 'land-complex-change', 'resolve-problem-report', 'new-ux-discovery', 'decision-journal', 'delphi-ground', 'delphi-imagine', 'workspace-governance', 'report-progress', 'work-in-external-repo', 'release-notes', 'isolated-change-validation', 'onboard-project', 'mine-session-transcripts']) {
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
  // Projects adapt a skill by citing its ids, so moving one breaks them (docs/project-adaptation.md).
  assert.match(publishAgentSkill, /where a skill declares `## Bindings`, its\s+binding-slot, hard-line and step ids[\s\S]{0,80}renaming\s+or removing one is a major change for that skill/i);
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

// A project adapts a pack skill by composing it (docs/project-adaptation.md), and this skill owns
// that install. Its tests are test/adapt-project-skills.test.mjs; what is held here is that the
// skill and its guide keep saying how a copy is composed, checked and moved, that `skills update`
// never moves one, and that the guide stays free of a machine path, a real address or a real zone.
// Names have no shape a public test can hold; scripts/scan-denylist.mjs reads for those.
// Check 10 as both the guide and docs/project-adaptation.md state it: every link is read, fenced
// code included, and why; an example writes a path as code. Neither says a fenced link is skipped.
const CHECK_10_WORDS = [
  "A link inside fenced code is checked like any other, as the pack's verifier checks a skill's files",
  'a link the check skipped would be checked by nothing, and no reading of fences by hand matches CommonMark',
  'An example that shows a path writes it as code, such as `docs/guide.md`, not as a link',
  'A link written from the root, such as `/docs/guide.md`, is refused: it is written from the file that holds it',
];
const NO_FENCE_EXEMPTION = /is an example and is not checked|so it is not\s+checked|skipped only when every reading|read every way it could\s+be meant|carried as written/;
// Check 5's heading rule, as both documents state it: outside the addition to a hard line, no
// heading in any shape names its id, wherever it sits and however far it is indented, fenced or
// not, and no line opens with one in bold. Nothing about a heading is left to review alone.
const CHECK_5_HEADING_WORDS = [
  'wherever the id sits in it, in any shape Markdown gives a heading: a `#` heading at any level, in a quote or a list item, an underlined paragraph, a paragraph that is only bold, or an HTML heading, at any indent, fenced or not',
  'opens with one in bold, the form a skill declares it in',
];
// What check 5 reads an id and an exception in: a sentence whole, as a reader sees it.
const CHECK_5_READING_WORDS = [
  'in the same sentence, read whole over the lines it wraps across, or opening the sentence after it',
  'read as a reader sees them: through emphasis, character references, invisible characters and markup between letters',
];
const CHECK_5_NO_REVIEW_ONLY = /listed for review, and refused when it or the paragraph under it|indented up to three columns|opens a heading with one|every heading that names one/;
const wrapped = (words) => new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
// The overlay rules both documents state: a fence closes inside its part, or the overlay is
// refused, and an addition's heading starts at the left margin.
const OVERLAY_FENCE_WORDS = 'Fenced code in the overlay closes inside the addition or section it opens in';
const OVERLAY_HEADING_WORDS = "An addition's heading starts at the left margin";

test('update-agent-skills composes, checks and lists adapted copies, and keeps them out of skills update', async () => {
  const adapting = await read('skills/update-agent-skills/references/adapting.md');
  const adaptation = await read('docs/project-adaptation.md');
  const contributing = await read('CONTRIBUTING.md');

  assert.match(descriptionOf(updateAgentSkills), /adapt a pack skill to this project/);
  assert.match(updateAgentSkills, /^compatibility: .*Node\.js 22 or newer and git for the composer, scripts\/adapt\.mjs/m);
  const adapt = section(updateAgentSkills, 'Adapting a Pack Skill to One Project');
  assert.match(adapt, /\]\(references\/adapting\.md\)/);
  for (const command of ['compose', 'check', 'outdated']) assert.match(adapt, new RegExp(`adapt\\.mjs ${command} --repo`));
  assert.match(adapt, /writes nothing without `--write`/);
  assert.match(adapt, /--discard-hand-edits/);
  assert.match(adapt, /never a branch/);
  assert.match(adapt, /`skills update` never moves an adapted copy/);
  assert.match(adapt, /check-pack-freshness\.mjs --repo/);
  // The composer is vendored as it ran, never fetched and run, so the skill says how it moves with a pin.
  assert.match(adapt, /The composer moves with the pin only when a person runs the new one/);
  assert.match(adapt, /<clone>\/skills\/update-agent-skills\/scripts\/adapt\.mjs compose --repo <project> --pack <clone>/);
  assert.match(section(updateAgentSkills, 'Inventory Every Requested Plane'), /adapted copies a project composed/);

  // The guide names all ten checks, and the two identities a pin is refused for.
  const checks = section(adapting, 'The checks');
  for (let number = 1; number <= 10; number += 1) assert.match(checks, new RegExp(`^\\| ${number} \\|`, 'm'), `the guide does not hold check ${number}`);
  // Check 10 reads every link, fenced code included, and says why. Check 5 reads an addition's
  // heading with its text.
  const fifth = checks.match(/^\| 5 \|.*$/m)?.[0] ?? '';
  assert.match(fifth, /no addition to a hard line, its heading included, or paragraph naming one/);
  for (const words of [...CHECK_5_HEADING_WORDS, ...CHECK_5_READING_WORDS]) assert.ok(fifth.includes(words), `check 5 in the guide does not say: ${words}`);
  assert.doesNotMatch(adapting, CHECK_5_NO_REVIEW_ONLY);
  const linkCheck = checks.match(/^\| 10 \|.*$/m)?.[0] ?? '';
  for (const words of CHECK_10_WORDS) assert.ok(linkCheck.includes(words), `check 10 in the guide does not say: ${words}`);
  assert.doesNotMatch(adapting, NO_FENCE_EXEMPTION);
  for (const words of [OVERLAY_FENCE_WORDS, OVERLAY_HEADING_WORDS, 'a fence in the overlay that does not close inside its addition or section', 'an indented `###` heading whose first word is an id']) {
    assert.match(adapting, new RegExp(words.replace(/ /g, '\\s+')), `the guide does not say: ${words}`);
  }
  assert.match(adapting, /every\s+relative\s+link\s+in\s+it,\s+fenced\s+code\s+included,\s+is\s+rewritten\s+for\s+that\s+place/);
  assert.match(adapting, /warn\s+and\s+name\s+each\s+such\s+link,\s+because\s+only\s+an\s+edit\s+to\s+the\s+skill\s+can\s+change\s+it/);
  assert.match(adapting, /A branch is refused, because it moves, and so is an abbreviated sha/);
  assert.match(adapting, /never edited by hand/);
  assert.match(adapting, /`outdated --verify` fetches the pinned commit and compares every carried\s+file/);
  // A refusal names the check a reader looks up, or says it is the pin's or the adapter folder's.
  assert.match(checks, /`\[adapter\]`, an adapter\s+folder that does not read as one/);
  assert.match(checks, /`\[pin\]`, a pin\s+that cannot be taken/);
  assert.match(adapting, /\*\*Which composer is vendored\.\*\*/);
  // A git setting that rewrites GitHub addresses to ssh is common, and the composer refuses it.
  assert.match(section(adapting, 'Failure modes'), /`url\.<base>\.insteadOf`.*`--pack`/);
  // Rule 7 as the guide states it: no pre-approval reaches a copy unless its adapter names it, and why.
  assert.match(adapting, wrapped('carries no `allowed-tools` line unless `allowedTools` names the tools, and then exactly those'));
  assert.match(adapting, wrapped('a pre-approval granted by a shared skill would apply in every project that adapts it'));
  assert.match(checks.match(/^\| 9 \|.*$/m)?.[0] ?? '', /an `allowed-tools` line added by hand/);
  assert.doesNotMatch(adapting, /widenTools|widened only/);

  assert.match(adaptation, /\]\(\.\.\/skills\/update-agent-skills\/scripts\/adapt\.mjs\)/);
  assert.doesNotMatch(adaptation, /No tool in the\s+pack does that yet/);
  // The README's update path for an adapted copy is the guide's "Moving a pin": a recorded
  // `base.commit` or `base.tree` guard moves with the ref, or compose refuses the new ref.
  const adaptedPlane = readme.match(/^\| Adapted copy of a pack skill \|.*$/m)?.[0] ?? '';
  assert.match(adaptedPlane, /change `base\.ref` \(and `base\.commit` and `base\.tree`, if recorded\)/);
  assert.match(adapting, /Change `base\.ref` \(and `base\.commit` and `base\.tree`, if recorded\)/);
  assert.match(contributing, /`update-agent-skills` owns moving installed copies wherever they live, and composing,\s+checking and listing the adapted copy/);
  assert.match(releases, /`update-agent-skills` moves installed copies wherever they live, and owns the adapted copy/);

  for (const [where, text] of [['SKILL.md', updateAgentSkills], ['references/adapting.md', adapting]]) {
    // The other organisation marker the blocks above name is on the contributors' private
    // denylist, which scan-denylist.mjs reads before every push, so a new line does not restate it.
    assert.doesNotMatch(text, /\bCUE\b/, `${where} names an organisation`);
    assert.doesNotMatch(text, /~\/work\//, `${where} carries a machine path`);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/, `${where} carries a real address`);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/, `${where} names a real zone`);
  }
});

test('frontmatter stays compatible with Agent Skills and skills.sh discovery', () => {
  for (const [name, source] of [['model-routing', routing], ['agent-lifecycle', lifecycle], ['blocks', blocks], ['request-blocks-review', requestBlocksReview], ['secure-credential-setup', secureCredentialSetup], ['derive-codebase-context', deriveCodebaseContext], ['publish-agent-skill', publishAgentSkill], ['update-agent-skills', updateAgentSkills], ['release-ledger', releaseLedger], ['github-webhooks', githubWebhooks], ['describe-changes', describeChanges], ['investigate-codebase', investigateCodebase], ['blast-area', blastArea], ['visualise-blast-area', visualiseBlastArea], ['land-complex-change', landComplexChange], ['resolve-problem-report', resolveProblemReport], ['new-ux-discovery', newUxDiscovery], ['release-notes', releaseNotes]]) {
    assert.match(source, new RegExp(`^---\\nname: ${name}\\n`));
    const description = descriptionOf(source);
    assert.ok(description.length > 0 && description.length <= 1024);
    assert.match(description, /(?:route|child|lifecycle|delegat|Blocks|review|secret|credential|context|codebase|publish|release|update|webhook|change)/i);
  }
});

// `lifecycle` in a skill's metadata is the skill's own maturity, not the stage of the work it serves
// (CONTRIBUTING, "What every skill carries"), and every skill this catalogue publishes is released.
// agent-lifecycle and workspace-governance keep the frontmatter of their own releases, which has no
// lifecycle field.
test("every skill's metadata lifecycle is its maturity, and every published skill's is release", async () => {
  const ownReleaseForm = new Set(['agent-lifecycle', 'workspace-governance']);
  const wrong = [];
  for (const entry of await readdir(new URL('skills/', root), { withFileTypes: true })) {
    if (!entry.isDirectory() || ownReleaseForm.has(entry.name)) continue;
    const metadata = (await read(`skills/${entry.name}/SKILL.md`)).match(/^metadata: "([^"\n]*)"$/m)?.[1] ?? '';
    const value = metadata.match(/(?:^|;\s*)lifecycle=([^;]*)/)?.[1]?.trim();
    if (value !== 'release') wrong.push(`${entry.name}: ${value ?? 'no lifecycle'}`);
  }
  assert.deepEqual(wrong, [], 'lifecycle is the skill\'s maturity, not a work stage');
});

// A skill's version is its own, and any change to its files moves it from the version last released
// (CONTRIBUTING, "What every skill carries"). Held against the newest catalogue tag HEAD descends
// from, and against the working tree, so an unstaged change counts. A checkout without that history
// (CI's shallow clone fetches no tags) has nothing to hold it against, and skips saying so.
test('a skill changed since the last catalogue tag moves its version', async (t) => {
  const git = (...args) => execFileSync('git', args, { cwd: fileURLToPath(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let tag;
  try {
    tag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD');
  } catch {
    t.skip('no catalogue tag in this checkout\'s history');
    return;
  }
  const versionOf = (source) => source.match(/^metadata: "[^"\n]*\bversion=(\d+\.\d+\.\d+)/m)?.[1]
    ?? source.match(/^version: (\d+\.\d+\.\d+)$/m)?.[1];
  const newer = (now, before) => {
    const [a, b] = [now, before].map((version) => version.split('.').map(Number));
    const i = a.findIndex((part, index) => part !== b[index]);
    return i !== -1 && a[i] > b[i];
  };
  const unmoved = [];
  for (const entry of await readdir(new URL('skills/', root), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = `skills/${entry.name}`;
    let released;
    try {
      released = git('show', `${tag}:${path}/SKILL.md`);
    } catch {
      continue; // new since the tag: its first version is its own
    }
    try {
      git('diff', '--quiet', tag, '--', path);
      continue; // unchanged since the tag
    } catch {
      // changed since the tag
    }
    const [before, now] = [versionOf(released), versionOf(await read(`${path}/SKILL.md`))];
    if (!before || !now || !newer(now, before)) unmoved.push(`${entry.name}: ${before} at ${tag}, ${now} now`);
  }
  assert.deepEqual(unmoved, [], `changed since ${tag} without moving its version`);
});

// A description is what a runtime matches, and the README says each one is written as the
// triggering condition: what the skill does, when to fire it, and what it is not for. These three
// were bare until 0.27.1. Each stays on SKILL.md's line 3; the README carries it word for word
// (the first test in this file).
test('publish-agent-skill, request-blocks-review and github-webhooks describe when to fire and what they are not for', () => {
  for (const [name, source] of [['publish-agent-skill', publishAgentSkill], ['request-blocks-review', requestBlocksReview], ['github-webhooks', githubWebhooks]]) {
    const description = descriptionOf(source);
    assert.equal(source.split('\n')[2], `description: "${description}"`, `${name}: the description is not on line 3`);
    assert.match(description, /\bSymptoms: |\bUse when /, `${name}: the description does not say when to fire`);
    assert.match(description, /\bNot for /, `${name}: the description does not say what it is not for`);
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

test('investigate-codebase scores before spending and refuses uncontrolled absence', () => {
  assert.match(investigateCodebase, /a top-tier driver is not the default/);
  assert.match(investigateCodebase, /complexity/i);
  assert.match(investigateCodebase, /control/i);
  assert.match(investigateCodebase, /inconclusive/);
  assert.match(investigateCodebase, /contradiction table/i);
  assert.match(investigateCodebase, /references\/complexity-rubric\.md/);
  assert.match(investigateCodebase, /references\/documenting-the-run\.md/);
  assert.doesNotMatch(investigateCodebase, /\bCUE\b|\bRGC\b/);
});

test('blast-area states when each break surfaces and what the map cannot see', () => {
  assert.match(blastArea, /compile time, runtime, or silently/);
  assert.match(blastArea, /deploy ordering/i);
  assert.match(blastArea, /What this map cannot see/);
  assert.match(blastArea, /searched negative/i);
  assert.match(blastArea, /references\/surface-checklist\.md/);
  assert.match(blastArea, /references\/documenting-the-run\.md/);
  assert.doesNotMatch(blastArea, /\bCUE\b|\bRGC\b/);
});

test('visualise-blast-area draws flowcharts and puts blind spots on the page', () => {
  assert.match(visualiseBlastArea, /flowchart LR/);
  assert.match(visualiseBlastArea, /Always `flowchart`, never/);
  assert.match(visualiseBlastArea, /blind spots occupy space on the page/i);
  assert.match(visualiseBlastArea, /blast-area/);
  assert.match(visualiseBlastArea, /references\/mermaid-contract\.md/);
  assert.match(visualiseBlastArea, /references\/documenting-the-run\.md/);
  assert.doesNotMatch(visualiseBlastArea, /\bCUE\b|\bRGC\b/);
});

test('land-complex-change budgets the touch-set and arms a gate per surface', () => {
  assert.match(landComplexChange, /side-effect budget/i);
  assert.match(landComplexChange, /watch it fail/i);
  assert.match(landComplexChange, /unguarded surface/i);
  assert.match(landComplexChange, /outside the budget/i);
  assert.match(landComplexChange, /references\/side-effect-budget\.md/);
  assert.match(landComplexChange, /references\/regression-gates\.md/);
  assert.match(landComplexChange, /references\/documenting-the-run\.md/);
  assert.doesNotMatch(landComplexChange, /\bCUE\b|\bRGC\b/);
});

test('resolve-problem-report gates the arc and delegates landing, description, and review', () => {
  assert.match(resolveProblemReport, /G0[\s\S]*G1[\s\S]*G2[\s\S]*G3[\s\S]*G4[\s\S]*G5/);
  assert.match(resolveProblemReport, /falsif/i);
  assert.match(resolveProblemReport, /land-complex-change/);
  assert.match(resolveProblemReport, /describe-changes/);
  assert.match(resolveProblemReport, /request-blocks-review/);
  assert.match(resolveProblemReport, /references\/gate-contracts\.md/);
  assert.match(resolveProblemReport, /references\/documenting-the-run\.md/);
  assert.doesNotMatch(resolveProblemReport, /\bCUE\b|\bRGC\b/);
});

test('resolve-problem-report assesses a report on three separate questions, and does not call a released fix verified', async () => {
  const assessing = await read('skills/resolve-problem-report/references/assessing-a-report.md');
  // SKILL.md is at the body cap, so it gains no lines: G0 points to the reference, G5 names where the
  // reader meets the fix, prerequisite 1 asks where the date came from, and the checklist holds both.
  assert.match(resolveProblemReport, /Answer severity, priority\s+and effort separately, each by its owner: \[assessing a report\]\(references\/assessing-a-report\.md\)/);
  assert.match(resolveProblemReport, /its date and the source it was taken from/);
  assert.match(resolveProblemReport, /nor the fix being released[\s\S]{0,200}requires and, once released, where\s+the reader meets it/);
  assert.match(resolveProblemReport, /\| \*\*G5 verify \+ describe\*\* \|[^\n]*\(a released fix also where its reader meets it\)/);
  assert.match(resolveProblemReport, /close the report \(a fix only\s+once it is verified where its reader meets it\)/);
  assert.match(resolveProblemReport, /severity, priority and effort are three answers, each with its owner/);
  assert.match(resolveProblemReport, /a released fix where its\s+reader meets it/);
  assert.match(section(resolveProblemReport, 'Deeper reading'), /\[assessing a report\]\(references\/assessing-a-report\.md\)/);
  // Adaptable on its own: its own slots, hard lines and steps (the skill's first ids), its skill
  // named in backticks rather than linked, and the guide by a URL that resolves from any copy.
  assert.match(assessing, /^## Bindings$/m);
  for (let slot = 1; slot <= 9; slot += 1) assert.match(assessing, new RegExp(`^\\| B${slot} \\|`, 'm'));
  for (let line = 1; line <= 3; line += 1) assert.match(assessing, new RegExp(`^- \\*\\*H${line}\\. `, 'm'));
  for (let step = 1; step <= 6; step += 1) assert.match(assessing, new RegExp(`^\\d+\\. \\*\\*S${step}\\. `, 'm'));
  const declared = new Set([...assessing.matchAll(/^(?:\| (B\d+) \||- \*\*(H\d+)\. |\d+\. \*\*(S\d+)\. )/gm)].map((m) => m[1] ?? m[2] ?? m[3]));
  for (const id of assessing.match(/\b[BHS][1-9]\d*\b/g)) assert.ok(declared.has(id), `the reference cites ${id}, which it does not declare`);
  assert.match(assessing, /\| B1 \|[^\n]*\| skill \| `resolve-problem-report` \|/);
  assert.match(assessing, /\| B9 \|[^\n]*\| value \| ask once \|/);
  assert.doesNotMatch(assessing, /\]\([^)]*SKILL\.md/);
  assert.match(assessing, /\(https:\/\/github\.com\/crissmoldovan\/agent-skills\/blob\/main\/docs\/project-adaptation\.md\)/);
  // Three questions, each with its owner, answered at G0 and kept apart from the arc's own measures.
  assert.match(assessing, /\*\*H1\. Severity, priority and effort are three questions, and no answer sets another\.\*\*/);
  assert.match(assessing, /Answer the three questions at G0, before G1's deep work/);
  assert.match(assessing, /"first estimate"/);
  assert.match(assessing, /recorded as proposed/);
  assert.match(assessing, /Severity is not the band's cost of being wrong/);
  assert.match(assessing, /Effort is not a candidate's size/);
  assert.match(assessing, /worst credible reader/);
  assert.match(assessing, /keep the old answer beside the new one/);
  // Priority's check is cited to its source and leaves the level to who is waiting, not to the harm.
  assert.match(assessing, /\[triage best practices\]\(https:\/\/www\.chromium\.org\/for-testers\/bug-reporting-guidelines\/triage-best-practices\/\)/);
  assert.match(assessing, /The\s+level follows from that answer, not from the harm \(H1\)/);
  // `now` is the call of the person who rules priority, never the harm's: harm that continues is
  // evidence for severity and a reason to ask for that call at once, and the agent's own level stays
  // proposed until it comes.
  const nowRow = assessing.match(/^\| \*\*now\*\* \|([^\n]*)\|$/m);
  assert.ok(nowRow, 'the priority table has no `now` row');
  assert.doesNotMatch(nowRow[1], /harm/i, 'the `now` row lets the harm set the priority, against H1');
  assert.match(nowRow[1], /The person bound as B2 has called it urgent/);
  assert.match(assessing, /Harm that is continuing for readers is evidence for severity, not a\s+priority/);
  assert.match(assessing, /only their call makes it `now`/);
  // The real date, with its source; nothing backfilled.
  assert.match(assessing, /Date the report from its source/);
  assert.match(assessing, /\*\*H3\. Nothing is dated or judged from memory\.\*\*/);
  // A commit or a tracker says when someone wrote the report down, never when it was reported, so B7
  // takes the date only from a source that states it, and with none the date is unknown.
  const dateSources = assessing.match(/^\| B7 \|([^\n]*)\|$/m);
  assert.ok(dateSources, 'the reference has no B7 row');
  assert.doesNotMatch(dateSources[1], /commit|tracker/i, 'B7 dates a report from when someone wrote it down');
  const assessingFlat = assessing.replace(/\s+/g, ' ');
  assert.match(assessingFlat, /is when someone wrote it down: a recording date, never the report's/);
  assert.match(assessingFlat, /With no source that states when it was reported, the date is unknown \(H3\)/);
  // Released is not verified: in the release first, then checked where the reader meets it, even when
  // told to close.
  assert.match(assessing, /\*\*H2\. A released fix is not a verified one\.\*\*/);
  assert.match(assessing, /even when someone says to close it/);
  assert.match(assessing, /git merge-base --is-ancestor <fix commit> <released commit>/);
  assert.match(assessing, /the merge or squash commit, not the branch's own/);
  assert.match(assessing, /the one the release records as built or served, not a branch tip/);
  assert.match(assessing, /cherry-pick or a backport[\s\S]{0,120}by its\s+patch id/);
  assert.match(assessing, /\*\*S5\. Once the fix is released, verify where the reader meets it \(B8\)/);
  assert.match(assessing, /A surface no check reached is not verified/);
  assert.match(assessing, /Close a fix as fixed only once it is verified/);
  // A fix that has landed but is not released has a state of its own, and G5's close waits for it.
  assert.match(assessing, /It is\s+landed once it is on the line a release is cut from, released once S4 passes, and verified once\s+S5's checks reach where the reader meets it/);
  assert.match(assessing, /G5 can describe and review\s+a landed fix, but its close waits for verification/);
  // It assesses one report; the register of every report is not this skill's.
  assert.match(assessing, /keeps no register of every report/);
  // The organisation markers are read from the block above rather than restated, so a change to that
  // pattern reaches this file too, with a guard that every marker it checks is checked here.
  const markerSource = (await read('test/catalog-content.test.mjs')).match(/assert\.doesNotMatch\(resolveProblemReport, \/(.+?)\/\);/);
  assert.ok(markerSource, "resolve-problem-report's block no longer checks for organisation markers");
  assert.ok(markerSource[1].split('|').length >= 2, 'every marker that block checks is checked here, not only the first');
  const organisationMarkers = new RegExp(markerSource[1]);
  for (const text of [resolveProblemReport, assessing]) {
    assert.doesNotMatch(text, organisationMarkers);
    assert.doesNotMatch(text, /~\/work\//);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
  }
});

test('new-ux-discovery gates every candidate and keeps the dropped ones on record', () => {
  assert.match(newUxDiscovery, /NOT-ALREADY-IMPLEMENTED/);
  assert.match(newUxDiscovery, /NO-CONFUSION/);
  assert.match(newUxDiscovery, /DROPPED/);
  assert.match(newUxDiscovery, /NOT SWEPT|NOT-SWEPT/);
  assert.match(newUxDiscovery, /investigate-codebase/);
  assert.match(newUxDiscovery, /blast-area/);
  assert.match(newUxDiscovery, /references\/gates\.md/);
  assert.match(newUxDiscovery, /references\/documenting-the-run\.md/);
  assert.doesNotMatch(newUxDiscovery, /\bCUE\b|\bRGC\b/);
});

test('release-notes owns the semver call, the destinations, and the limits of its gate', () => {
  assert.match(releaseNotes, /What.*Why.*Impact/s);
  assert.match(releaseNotes, /breaking → major|additive → minor/);
  assert.match(releaseNotes, /dist-tag/);
  assert.match(releaseNotes, /every place the project records releases/i);
  assert.match(releaseNotes, /describe-changes/);
  assert.match(releaseNotes, /release-ledger/);
  // The gate is documented as a floor, and as something only a user installs.
  assert.match(releaseNotes, /adapters\/claude-code\/release-notes-gate\.sh/);
  assert.match(releaseNotes, /off until a user installs it/);
  assert.match(releaseNotes, /It is a floor\./);
  assert.doesNotMatch(releaseNotes, /\bCUE\b|\bRGC\b/);
});

test('release-notes versions a product with no API, treats a bump judge as advice, and can be adapted', async () => {
  const versioning = await read('skills/release-notes/references/versioning-a-product.md');
  assert.match(releaseNotes, /references\/versioning-a-product\.md/);
  // The slots, hard lines and steps a project's overlay cites, each under its id.
  assert.match(releaseNotes, /^## Bindings$/m);
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']) assert.match(releaseNotes, new RegExp(`^\\| ${id} \\|`, 'm'));
  for (const id of ['H1', 'H2', 'H3', 'H4']) assert.match(releaseNotes, new RegExp(`^- \\*\\*${id}\\. `, 'm'));
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) assert.match(releaseNotes, new RegExp(`^\\d+\\. \\*\\*${id}\\. `, 'm'));
  assert.match(releaseNotes, /\| B6 \|[^\n]*\| skill \| `describe-changes` \|/);
  assert.match(releaseNotes, /\| B7 \|[^\n]*\| skill \| `release-ledger` \|/);
  assert.match(releaseNotes, /\| B8 \| where a product with no API keeps its was-and-now ledger \| value \|/);
  assert.match(versioning, /takes it as the slot B8/);
  // An installed copy carries no docs/, so the guide is cited by a URL that resolves anywhere.
  assert.match(releaseNotes, /\(https:\/\/github\.com\/crissmoldovan\/agent-skills\/blob\/main\/docs\/project-adaptation\.md\)/);
  // A number ruled against the impact analysis ships with both readings, never unexplained, and
  // only a person a project names may rule it: unbound, the analysis alone sets the number.
  assert.match(releaseNotes, /\| B5 \|[^\n]*\| value \| nobody: the impact analysis alone sets the number/);
  assert.match(releaseNotes, /records both readings and the\s+ruling of the person bound as B5/);
  // The ruling counts once the person has seen what the analysis found and kept their number.
  assert.match(releaseNotes, /show them what the analysis found, and if they keep their number,\s+stamp theirs/);
  assert.match(versioning, /show them what it found, and the words a judge quoted if one\s+ran/);
  // A person who cannot be shown it is waited for: neither number is the agent's to stamp.
  assert.match(releaseNotes, /the release waits for their answer: stamping either number\s+without it would be the agent's ruling/);
  assert.match(versioning, /the release waits for their answer: stamping\s+their number unseen, or the analysis's instead, would be the agent's ruling/);
  // A judge is weighed against the analysis, never against a ruled number, and a judge found right
  // corrects the analysis as well as the number, so S3's check can still pass.
  assert.match(versioning, /\*\*the analysis is wrong\*\*: correct it, then fix the number/);
  assert.match(versioning, /never with a number the person bound as B5 has ruled/);
  assert.match(releaseNotes, /correct the analysis and the number, or overrule the\s+judge on the\s+record/);
  assert.match(releaseNotes, /judge \(B4\)\s+is advice/);
  // Untrue words are corrected on the record; words are never reworded to move the number.
  assert.match(releaseNotes, /never reworded to move its number/);
  assert.match(versioning, /A\s+correction makes the words true; a rewording only makes the judge agree/);
  assert.match(versioning, /what does a reader rely on/i);
  assert.match(versioning, /false, broken or never\s+seen/);
  assert.match(versioning, /Write the ledger first, as was and now/);
  assert.match(versioning, /## A bump judge is advice/);
  assert.match(versioning, /Never reword the ledger to move the number/);
  assert.match(versioning, /records both readings/);
  assert.match(versioning, /name the number they become/);
  assert.match(versioning, /restart is recorded once/);
  assert.match(versioning, /leave one out/);
  // The reference against the same organisation markers as release-notes' own block above, read
  // from that block so the two cannot drift and a new line need not restate them.
  const ownSource = await read('test/catalog-content.test.mjs');
  const markerSource = ownSource.match(/assert\.doesNotMatch\(releaseNotes, \/(.+?)\/\);/);
  assert.ok(markerSource, "release-notes' block no longer checks for organisation markers");
  const organisationMarkers = new RegExp(markerSource[1]);
  assert.match(' CUE ', organisationMarkers, 'the markers read from that block are the pattern the blocks above use');
  assert.ok(markerSource[1].split('|').length >= 2, 'every marker that block checks is checked here, not only the first');
  for (const text of [releaseNotes, versioning]) {
    assert.doesNotMatch(text, organisationMarkers);
    assert.doesNotMatch(text, /~\/work\//);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
  }
});

const documentingRunCarriers = ['investigate-codebase', 'blast-area', 'visualise-blast-area', 'land-complex-change', 'resolve-problem-report', 'new-ux-discovery'];

async function assertRunRecordCopiesIdentical(directory) {
  const { createHash } = await import('node:crypto');
  const hashes = new Map();
  for (const skill of documentingRunCarriers) {
    const bytes = await readFile(new URL(`skills/${skill}/references/documenting-the-run.md`, directory));
    hashes.set(skill, createHash('sha256').update(bytes).digest('hex'));
  }
  const [reference] = hashes.values();
  for (const [skill, digest] of hashes) {
    assert.equal(digest, reference, `${skill} carries a divergent documenting-the-run.md (${digest} vs ${reference})`);
  }
  return reference;
}

test('every --document skill carries a byte-identical run-record reference', async () => {
  const digest = await assertRunRecordCopiesIdentical(root);
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test('the byte-identity assertion fails when one carried copy is altered', async () => {
  const { cp, mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const scratch = await tempDir('run-record-mutation-');
  await cp(new URL('skills/', root), path.join(scratch, 'skills'), { recursive: true });
  const target = path.join(scratch, 'skills', 'blast-area', 'references', 'documenting-the-run.md');
  const original = await readFile(target, 'utf8');
  await writeFile(target, `${original.slice(0, 1)}${original.charCodeAt(1) === 32 ? '\t' : ' '}${original.slice(2)}`);

  const mutated = pathToFileURL(`${scratch}${path.sep}`);
  await assert.rejects(
    () => assertRunRecordCopiesIdentical(mutated),
    /blast-area carries a divergent documenting-the-run\.md/,
  );
});

// The convention file marks one block "copy verbatim" and one sentence "exactly"; both are
// embedded in every carrier's body so the rules survive a reader who never opens the file.
// Nothing else asserted that the embedded copies still match the convention they came from.
function fencedBlockAfter(source, marker, label) {
  const anchor = source.indexOf(marker);
  assert.ok(anchor >= 0, `documenting-the-run.md no longer contains the ${label} marker: ${marker}`);
  const open = source.indexOf('```markdown\n', anchor);
  assert.ok(open >= 0, `documenting-the-run.md has no fenced ${label} block after its marker`);
  const start = open + '```markdown\n'.length;
  const close = source.indexOf('\n```', start);
  assert.ok(close > start, `documenting-the-run.md leaves the ${label} block unterminated`);
  return source.slice(start, close);
}

const runRecordConvention = await read('skills/investigate-codebase/references/documenting-the-run.md');
const inBodyCoreTemplate = fencedBlockAfter(runRecordConvention, '## In-body core (copy verbatim)', 'in-body core');
const pointerMarker = 'Follow it, in the same section, with the sentence below, word for word,';
const runRecordPointer = fencedBlockAfter(runRecordConvention, pointerMarker, 'pointer sentence');

test('every --document skill embeds the verbatim in-body core and the exact pointer sentence', () => {
  assert.ok(inBodyCoreTemplate.includes('<skill-name>'), 'the in-body core template lost its <skill-name> placeholder');
  assert.ok(inBodyCoreTemplate.split('\n').length > 5, 'the in-body core template is too short to be the core block');

  const sources = new Map([
    ['investigate-codebase', investigateCodebase],
    ['blast-area', blastArea],
    ['visualise-blast-area', visualiseBlastArea],
    ['land-complex-change', landComplexChange],
    ['resolve-problem-report', resolveProblemReport],
    ['new-ux-discovery', newUxDiscovery],
  ]);
  assert.deepEqual([...sources.keys()], documentingRunCarriers);

  // The convention gives the sentence's words in the fence and names, as code, the words that link
  // and the path they link to from the skill's root: a link written in the fence would resolve from
  // references/, where that path names nothing.
  assert.doesNotMatch(runRecordPointer, /\]\(|^ {0,3}\[[^\]]+\]:/m, 'the pointer sentence in documenting-the-run.md is written as a link, which resolves from references/');
  const anchor = runRecordConvention.indexOf(pointerMarker);
  const lead = runRecordConvention.slice(anchor, runRecordConvention.indexOf('```markdown\n', anchor));
  const named = lead.match(/linking the words\s+`([^`]+)`\s+to\s+`([^`]+)`/);
  assert.ok(named, 'documenting-the-run.md does not say to link, naming as code, the words of the pointer sentence that link and the path they link to');
  const [, words, target] = named;
  assert.equal(runRecordPointer.split(words).length, 2, `the pointer sentence holds "${words}" exactly once`);
  const pointer = runRecordPointer.replace(words, `[${words}](${target})`);

  for (const [name, source] of sources) {
    const expected = inBodyCoreTemplate.replaceAll('<skill-name>', name);
    assert.ok(source.includes(expected), `${name}/SKILL.md does not embed the verbatim in-body core block from documenting-the-run.md`);
    assert.ok(!source.includes(inBodyCoreTemplate), `${name}/SKILL.md left the <skill-name> placeholder unsubstituted`);
    assert.ok(source.includes(pointer), `${name}/SKILL.md does not carry the exact run-record pointer sentence, ${pointer}`);
  }
});

// A RELEASED VERSION'S PROSE MUST NOT STILL BE STAGED AS UNRELEASED.
//
// ── WHAT WAS OBSERVED ────────────────────────────────────────────────────────
// Three times running, a release shipped and its `## Unreleased` prose was left
// in place: v0.12.0's two entries were still staged when v0.13.0 was cut, and
// v0.13.0's and v0.13.1's were still staged after both had shipped. Each time
// the next tag would have republished work that was already out, and each time
// it was caught by reading the file rather than by anything failing.
//
// The invariant that makes it mechanical: prose sits under `## Unreleased`
// while the work is unreleased. A release commit bumps package.json AND writes
// the CHANGELOG entry for that version. So if package.json's version already
// has a CHANGELOG heading, the release is cut — and nothing may remain staged.
test('a released version leaves no prose staged as unreleased', async () => {
  const version = rootPackage.version
  const changelog = await read('CHANGELOG.md')
  const released = new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?([\\s]|$)`, 'm')
    .test(changelog)
  if (!released) return   // mid-cycle: the bump has not happened yet, staging is correct
  const start = releases.indexOf('## Unreleased')
  assert.notEqual(start, -1, 'docs/releases.md must keep its ## Unreleased section')
  const end = releases.indexOf('\n## ', start + 5)
  const staged = releases.slice(start, end === -1 ? undefined : end)
  const entries = staged.match(/^### .*/gm) ?? []
  assert.deepEqual(
    entries, [],
    `package.json is ${version} and CHANGELOG.md has its entry, so ${version} is released — `
    + `but docs/releases.md still stages ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}: `
    + `${entries.join(' | ')}. Move them into the release notes, or clear them if they already shipped.`,
  )
})

// A project adapts a skill by citing its ids and pinning it by tag, so the page that defines the
// ids and the merge rules, the tag policy the pins rely on, and the rule that moving an id is a
// major change have to stay written down, and the page has to stay free of a machine path, a real
// address or a real zone. The verifier's half of the contract is in verify-skills.test.mjs.
test('project adaptation: the ids, the merge rules and the tag policy stay written down', async () => {
  const adaptation = await read('docs/project-adaptation.md');
  const contributing = await read('CONTRIBUTING.md');

  for (const id of ['`B1`', '`H1`', '`S1`']) assert.ok(adaptation.includes(id), `the page does not name ${id}`);
  assert.match(adaptation, /^\| id \| slot \| kind \| default \|$/m);
  assert.match(adaptation, /Every handoff to a sibling skill is a slot\s+of kind `skill`/);
  assert.match(adaptation, /\*\*ask once\*\*/);
  assert.match(adaptation, /An id is a name, not a position/);

  const rules = section(adaptation, 'The merge rules');
  assert.match(rules, /A binding replaces the default, and nothing else/);
  assert.match(rules, /An addition extends its step/);
  assert.match(rules, /A hard line is never relaxed/);
  assert.match(rules, /`replaces:`[\s\S]*It is refused on an `H` id/);
  assert.match(rules, /never takes its skill's name/);
  // Rule 2 where a project adapts one skill twice: any of its copies is a binding, and a copy over
  // SKILL.md may name itself for a slot that hands work back to its own skill.
  assert.match(rules, wrapped('Where the project adapts it more than once, any of those copies is a binding.'));
  assert.match(rules, wrapped("may name the copy it sits in when that copy is over the skill's `SKILL.md`"));
  // Rule 7: a copy pre-approves only the tools the project names, because a shared skill's would
  // apply in every project that adapts it.
  assert.match(rules, wrapped('`allowed-tools` never comes from the skill'));
  assert.match(rules, wrapped('a pre-approval granted by a shared skill would apply in every project that adapts it'));
  assert.doesNotMatch(adaptation, /widenTools|widens the tools/);

  assert.match(adaptation, /A branch is refused, because it moves/);
  assert.match(adaptation, /\]\(releases\.md#tags\)/);
  const tags = section(releases, 'Tags');
  assert.match(tags, /A published tag is never moved or deleted/);
  assert.match(tags, /`<skill>-vX\.Y\.Z`/);
  // A credential is revoked and the tag stays; personal or client data cannot be revoked.
  assert.match(tags, /A credential is revoked[\s\S]*the tag\s+stays/);
  assert.match(tags, /Personal or client data cannot be revoked[\s\S]*deleted/);
  assert.match(section(releases, 'Versioning'), /renaming or removing one of their ids is a major change for that skill/);
  assert.match(section(releases, 'Versioning'), /below 1\.0\.0, a major change moves its middle number/);

  // Which number a change to an id moves, and how each kind of change is classed.
  const changing = section(adaptation, 'Changing a skill that projects adapt');
  assert.match(changing, /The number that moves\*\* is the catalogue's version/);
  assert.match(changing, /Below 1\.0\.0,\s+a major change moves the middle number/);
  assert.match(changing, /adding a slot that is `required` from the\s+start/);
  assert.match(changing, /changing what a step, a hard line or a slot means/);
  assert.match(changing, /relaxing or dropping a hard line/);

  // What the copy carries, a reference file as its entry, and how an id is cited rather than declared.
  const copy = section(adaptation, 'The adapted copy');
  assert.match(copy, /`LICENSE`, the MIT text/);
  // The record lists the sha256 of the files the copy carries; it cannot list its own, since writing
  // that digest would change it.
  assert.match(copy, /the record of its pin \(below\), with the sha256 of every other file it\s+carries/);
  assert.match(copy, /The record does not\s+hash itself/);
  // A SKILL.md entry's text is its body: the copy's frontmatter is the merged one, written once.
  assert.match(copy, /For a `SKILL\.md` entry that text is its\s+body, everything after the `---` that closes its frontmatter, since item 1 is the copy's only\s+frontmatter/);
  assert.match(section(adaptation, 'Pinning a skill'), /\*\*sha256 of every file\*\* carried, but for the record that holds them/);
  assert.match(copy, /### When the entry is a reference file/);
  assert.match(copy, /relative\s+link\s+in\s+it,\s+fenced\s+code\s+included,\s+is\s+rewritten\s+for\s+its\s+new\s+place/);
  assert.doesNotMatch(adaptation, NO_FENCE_EXEMPTION);
  // That check 10 reads every link, and why, wherever the page wraps it.
  for (const words of CHECK_10_WORDS) {
    assert.match(copy, new RegExp(words.replace(/[.]/g, '\\.').replace(/ /g, '\\s+')), `docs/project-adaptation.md does not say: ${words}`);
  }
  // And what the overlay holds its fences to, beside the overlay's own parts.
  for (const words of [OVERLAY_FENCE_WORDS, OVERLAY_HEADING_WORDS]) {
    assert.match(adaptation, new RegExp(words.replace(/ /g, '\\s+')), `docs/project-adaptation.md does not say: ${words}`);
  }
  assert.match(adaptation, wrapped('adds to one in the words of an exception, in its heading or under it, names one in a heading or opens a line with one in bold outside the addition to it,'));
  for (const words of CHECK_5_HEADING_WORDS) assert.match(rules, wrapped(words), `the merge rules do not say: ${words}`);
  assert.doesNotMatch(adaptation, CHECK_5_NO_REVIEW_ONLY);
  assert.match(adaptation, /or\s+leaves\s+a\s+fence\s+open\s+past\s+the\s+addition\s+or\s+section\s+it\s+opens\s+in\./);
  assert.match(copy, /An id declared only in the\s+skill's `SKILL\.md` is refused/);
  assert.match(adaptation, /\*\*Only a declaration opens with an id\.\*\*/);

  for (const [where, text] of [['CONTRIBUTING.md', contributing], ['README.md', readme], ['docs/architecture.md', architecture]]) {
    assert.match(text, /project-adaptation\.md/, `${where} does not point at docs/project-adaptation.md`);
  }

  // Names have no shape a public test can hold; scripts/scan-denylist.mjs reads for those.
  assert.doesNotMatch(adaptation, /~\/work\//);
  for (const address of adaptation.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
  assert.doesNotMatch(adaptation, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
});

// The adaptation page names the skills a project can adapt. That is a claim about the pack, so the
// claim is what is tested: the named skills are exactly those with a file that declares Bindings.
test('the project-adaptation page names every skill that declares Bindings, and no other', async () => {
  const adaptation = await read('docs/project-adaptation.md');
  const claim = adaptation.match(/^\S.* skills in this catalogue declare the section:([\s\S]*?)\.\n\n/m);
  assert.ok(claim, 'the page no longer says which skills declare the section');
  const named = [...claim[1].matchAll(/`([a-z0-9-]+)`/g)].map(([, name]) => name).sort();
  const unfenced = (text) => {
    let fence = null;
    return text.split('\n').filter((line) => {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (open && !fence) { fence = open[1]; return false; }
      if (fence) {
        if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') fence = null;
        return false;
      }
      return true;
    }).join('\n');
  };
  const declaring = [];
  for (const entry of await readdir(new URL('skills/', root), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = (await readdir(new URL(`skills/${entry.name}/`, root), { recursive: true })).filter((file) => file.endsWith('.md'));
    for (const file of files) {
      if (/^## Bindings\s*$/m.test(unfenced(await read(`skills/${entry.name}/${file}`)))) { declaring.push(entry.name); break; }
    }
  }
  assert.deepEqual(named, declaring.sort());
});

test('layer-repository-docs carries no organisation marks and states what it does not own', () => {
  assert.doesNotMatch(layerRepositoryDocs, /\bCUE\b|\bRGC\b/);
  // CONTRIBUTING requires a new skill to say which shipped skills it does not duplicate.
  for (const sibling of ['derive-codebase-context', 'investigate-codebase', 'workspace-governance']) {
    assert.match(layerRepositoryDocs, new RegExp(sibling));
  }
});

test('layer-repository-docs states three entry points, the announcement, and the report contract', () => {
  // A word after the skill name binds to nothing unless the body says what it selects: six graded
  // trial runs each cut the procedure into a different subset, and two runs given the identical
  // word produced reports that could not be compared.
  const entryPoints = layerRepositoryDocs.slice(
    layerRepositoryDocs.indexOf('\n## Entry points'),
    layerRepositoryDocs.indexOf('\n## When to Use'),
  );
  assert.notEqual(entryPoints, '', 'SKILL.md must carry an "## Entry points" section before "## When to Use"');
  const rows = entryPoints.split('\n').filter((line) => /^\| `/.test(line));
  assert.equal(rows.length, 3, 'the entry-points table must carry exactly one row per entry point');
  for (const [index, name] of ['audit', 'draft', 'update'].entries()) {
    assert.match(rows[index], new RegExp('^\\| `' + name));
    // Selected by, scope, what it may write, what it hands back: a row missing one of those is
    // the guesswork the entry points exist to remove.
    assert.equal(rows[index].split('|').filter((cell) => cell.trim() !== '').length, 5);
  }
  assert.match(entryPoints, /Announce the entry point in one line before the first read, and never ask which to run/);
  assert.match(entryPoints, /\[entry points\]\(references\/entry-points\.md\)/);

  // Each entry point's own section states all four, so a run knows where it must stop.
  for (const label of ['\\*\\*Scope\\.\\*\\*', '\\*\\*May write\\.\\*\\*', '\\*\\*Runs\\.\\*\\*', '\\*\\*Hands back\\.\\*\\*']) {
    const matches = layerRepositoryDocsEntryPoints.match(new RegExp(label, 'g')) ?? [];
    assert.equal(matches.length, 3, `references/entry-points.md must state ${label} for each of the three entry points`);
  }
  for (const name of ['audit', 'draft', 'update']) {
    assert.match(layerRepositoryDocsEntryPoints, new RegExp('^## `' + name, 'm'));
  }

  // One report shape for all three: a trial run's findings existed only as counts, and the run
  // reported them delivered.
  const contract = layerRepositoryDocs.slice(
    layerRepositoryDocs.indexOf('\n## The report contract'),
    layerRepositoryDocs.indexOf('\n## Usage Examples'),
  );
  assert.notEqual(contract, '', 'SKILL.md must carry a "## The report contract" section');
  assert.match(contract, /80 lines/);
  assert.match(contract, /If no file can be written, the four parts above go\s+inline/);
  assert.match(contract, /a total whose rows exist nowhere is a failed run/);
  assert.match(layerRepositoryDocs, /- \[ \] The entry point was announced in one line before the first read/);
});

test('layer-repository-docs publishes how it is evaluated, and says what is unmeasured', () => {
  assert.doesNotMatch(layerRepositoryDocsEvaluation, /\bCUE\b|\bRGC\b/);
  assert.doesNotMatch(layerRepositoryDocsEntryPoints, /\bCUE\b|\bRGC\b/);
  // The catalogue's other checks never run a skill; this page is the record of one that does.
  for (const claim of [
    'claude plugin eval',
    'skill-doctor',
    'What is not settled',
    'make-docs-fixture',
  ]) {
    assert.match(layerRepositoryDocsEvaluation, new RegExp(claim));
  }
  assert.match(readme, /\[Entry points\]\(skills\/layer-repository-docs\/references\/entry-points\.md\)/);
  assert.match(readme, /\[its evaluation protocol\]\(docs\/layer-repository-docs\/evaluation\.md\)/);
  // The release record, not the staged prose: docs/releases.md empties when a release is cut.
  assert.match(changelogText, /\(docs\/layer-repository-docs\/evaluation\.md\)/);
});

test('the architecture page names the report-progress gate by the hooks its installer writes now', () => {
  // Stale from 0.17.0 until it was caught: the page kept calling the gate "a PostToolUse marker
  // writer plus a Stop hook" after the installer stopped writing that pair at coverage 2 — and
  // this page is where the repository says what its hooks are.
  const start = architecture.indexOf('- `adapters/claude-code/report-progress-gate.mjs`');
  assert.notEqual(start, -1, 'docs/architecture.md must keep its report-progress gate entry');
  const end = architecture.indexOf('\n- ', start + 3);
  const entry = architecture.slice(start, end === -1 ? undefined : end);
  assert.doesNotMatch(entry, /a `PostToolUse` marker writer plus a `Stop` hook/);
  assert.match(entry, /`Stop` hook/);
  assert.match(entry, /coverage\s+1/);
  assert.match(entry, /`PostToolUse`\s+matcher\s+`Agent`/);
  assert.match(entry, /coverage\s+2/);
  assert.match(entry, /`SubagentStart`/);
  assert.match(entry, /install-report-progress-gate\.mjs/);
  assert.match(entry, /test\/report-progress-gate\.test\.mjs/);
});

test('no page says the report-progress gate cannot block twice at coverage 1', async () => {
  // These sentences shipped, and they were false: an Agent dispatch after a block re-armed coverage 1
  // exactly as a subagent re-armed coverage 2, and through 0.19.0 only the harness's stop_hook_active
  // held the second Stop at both levels (test/report-progress-gate.test.mjs still pins that behaviour
  // for a gate installed without the UserPromptSubmit hook). Released CHANGELOG entries are history
  // and are not checked here.
  const { readFileSync } = await import('node:fs');
  for (const page of ['README.md', 'adapters/claude-code/README.md', 'skills/report-progress/SKILL.md']) {
    const text = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /coverage 1 does not have this shape|structurally incapable|a shape coverage 1 cannot/i, page);
    assert.doesNotMatch(text, /At coverage 2, once per turn is the intent/, page);
    // True through 0.19.0 and not since: a record of the spent block, cleared by a UserPromptSubmit hook
    // when each turn starts, holds the ceiling at both levels. Each page names that hook.
    assert.doesNotMatch(text, /once per turn is the intent rather than a guarantee|aims to act once per turn|that is the intent rather than a guarantee/i, page);
    assert.match(text, /UserPromptSubmit/, `${page} does not name the hook that keeps one block per turn`);
  }
});

test('isolated-change-validation carries no organisation marks and states what it does not own', () => {
  assert.doesNotMatch(isolatedChangeValidation, /\bCUE\b|\bRGC\b|claude-stream/i);
  // CONTRIBUTING requires a new skill to say which shipped skills it does not duplicate.
  for (const sibling of ['land-complex-change', 'blast-area', 'work-in-external-repo', 'request-blocks-review', 'agent-lifecycle', 'report-progress']) {
    assert.match(isolatedChangeValidation, new RegExp(sibling));
  }
  // Technical acceptance authorizes nothing: the boundary the skill exists to hold.
  assert.match(isolatedChangeValidation, /Technical acceptance is not landing authority/i);
  // The two lessons the carried references exist for.
  assert.match(isolatedChangeValidationHandoff, /Every lane is separate, and labelled by its acceptance state/);
  assert.match(isolatedChangeValidationEvidence, /unclassified_hits/);
  for (const reference of ['references/evidence-contract.md', 'references/handoff-bundle.md']) {
    assert.ok(isolatedChangeValidation.includes(reference), `SKILL.md does not link ${reference}`);
  }
});

test('onboard-project states its boundaries, its consent rule, and what it never edits', () => {
  assert.doesNotMatch(onboardProject, /\bCUE\b|\bRGC\b/);
  // CONTRIBUTING requires a new skill to say which shipped skills it does not duplicate.
  for (const sibling of ['update-agent-skills', 'derive-codebase-context', 'layer-repository-docs', 'workspace-governance', 'model-routing']) {
    assert.match(onboardProject, new RegExp(sibling));
  }
  // The two rules the design turns on: one yes, and nothing installed on the user's behalf.
  assert.match(onboardProject, /one yes/i);
  assert.match(onboardProject, /no skill may install it on their behalf/i);
  assert.match(onboardProject, /never edits CLAUDE\.md, AGENTS\.md/i);
  // The hook is always its own row, and always marked.
  assert.match(onboardProject, /affects all projects on this machine/i);
  for (const reference of ['references/fit-signals.md', 'references/what-gets-written.md']) {
    assert.ok(onboardProject.includes(reference), `SKILL.md does not link ${reference}`);
  }
  assert.match(onboardProjectFitSignals, /\*?\*?unknown\*?\*?, not zero/i);
  assert.match(onboardProjectWrites, /Undo/);
});

test('request-answers shows the screen each question is about, gives the reader the settled rows, and can be adapted', async () => {
  const requestAnswers = await read('skills/request-answers/SKILL.md');
  const screens = await read('skills/request-answers/references/pointing-at-the-screen.md');
  const answerSheet = await read('skills/request-answers/references/answer-sheet.md');
  const itemFile = await read('skills/request-answers/references/item-file.md');
  assert.ok(requestAnswers.includes('references/pointing-at-the-screen.md'), 'SKILL.md does not link the screen reference');
  // The slots, hard lines and steps a project's overlay cites, each under its id.
  assert.match(requestAnswers, /^## Bindings$/m);
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']) assert.match(requestAnswers, new RegExp(`^\\| ${id} \\|`, 'm'));
  for (const id of ['H1', 'H2', 'H3', 'H4', 'H5']) assert.match(requestAnswers, new RegExp(`^- \\*\\*${id}\\. `, 'm'));
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) assert.match(requestAnswers, new RegExp(`^\\d+\\. \\*\\*${id}\\. `, 'm'));
  // Who sends, who may be messaged and how a screen is rendered are the project's to bind; every
  // sibling the skill sends a request on to is a skill slot defaulting to the pack skill.
  assert.match(requestAnswers, /^\| B2 \| who sends an ask to a person/m);
  assert.match(requestAnswers, /^\| B3 \| who may be messaged at all \|/m);
  assert.match(requestAnswers, /^\| B4 \| how a screen is rendered and shot \|/m);
  assert.match(requestAnswers, /^\| B8 \| where a round's files are kept/m);
  assert.match(requestAnswers, /\| B5 \|[^\n]*\| skill \| `decision-journal` \|/);
  assert.match(requestAnswers, /\| B6 \|[^\n]*\| skill \| `report-progress` \|/);
  assert.match(requestAnswers, /\| B7 \|[^\n]*\| skill \| `delphi-ground` \|/);
  // An installed copy carries no docs/, so the guide is cited by a URL that resolves anywhere.
  assert.match(requestAnswers, /\(https:\/\/github\.com\/crissmoldovan\/agent-skills\/blob\/main\/docs\/project-adaptation\.md\)/);
  // Nothing goes to a person on the run's own word, whatever a project binds.
  assert.match(requestAnswers, /\*\*H3\. Nothing reaches a person on the run's own word\.\*\*/);
  // The base change: a question about a screen carries its shot at every depth, brief and normal
  // included, and the header example no longer promises a transcript-only brief.
  assert.match(requestAnswers, /A question about something on a screen carries its shot\*\*, attached as a file at\s+every depth, brief and normal included/);
  assert.doesNotMatch(requestAnswers, /no attached files/);
  assert.match(requestAnswers, /With no renderer here/);
  // The hunt-down pass: a decision with no standing ruling is a proposal, every claim that takes a
  // question off is refuted first, and a question the recipient asked is not one for them.
  assert.match(requestAnswers, /^- \*\*decided here\*\* — a judgement a standing ruling already settles/m);
  assert.match(requestAnswers, /the decision you would take is a proposal to the person bound as B1/);
  // While it waits on that ruling, the proposal is in neither part of the recipient's brief.
  assert.match(requestAnswers, /in neither\s+the recipient's open lines nor their settled rows/);
  assert.match(requestAnswers, /\*\*Every claim that takes a question off goes past a refuter\.\*\*/);
  assert.match(requestAnswers, /A question they asked\s+you is not a question for them/);
  // The reader gets the settled rows beside the open ones, and a question's number never moves.
  assert.match(requestAnswers, /^Five parts, in this order\.$/m);
  const parts = [...requestAnswers.matchAll(/^### (\d)\. (.+)$/gm)].map(([, number, title]) => `${number} ${title.split(' —')[0]}`);
  assert.deepEqual(parts, ['1 The header', '2 The answer sheet', '3 The detail', '4 Already settled', '5 Not for you']);
  // Brief depth leaves out the detail and nothing else, so a brief still carries the settled rows
  // and "Not for you": the depth table's shape cannot be read as header and sheet alone.
  const briefShape = requestAnswers.match(/^\| \*\*brief\*\* \| ([^|\n]+) \|/m)?.[1] ?? '';
  for (const part of ['Already settled', 'Not for you']) assert.ok(briefShape.includes(part), `brief depth's shape leaves out "${part}": ${briefShape}`);
  assert.match(briefShape, /but the detail/, `brief depth's shape does not say the detail is all it leaves out: ${briefShape}`);
  // The template's header says the same: a writer who fills it for brief depth is told the detail
  // is all that goes, never "sheet only", which reads as header and sheet alone.
  const headerMeaning = answerSheet.match(/\*\*\[N\] asks · depth: \[brief \| normal \| deep\]\*\* — \[([^\]]+)\]/)?.[1] ?? '';
  assert.doesNotMatch(headerMeaning, /sheet only/, `the template's header still says brief depth is the sheet only: ${headerMeaning}`);
  assert.match(headerMeaning, /all five parts but the detail/, `the template's header does not say brief depth is all five parts but the detail: ${headerMeaning}`);
  // A shot is two images in every variant, so the worked example names both for each layout.
  const exampleQ7 = answerSheet.slice(answerSheet.indexOf('## Worked example')).match(/^### Q7 · [\s\S]*?(?=^### )/m)?.[0] ?? '';
  for (const image of ['Q7-wide.png', 'Q7-wide.screen.png', 'Q7-narrow.png', 'Q7-narrow.screen.png']) {
    assert.ok(exampleQ7.includes(`\`${image}\``), `the worked example's Q7 does not name ${image}`);
  }
  assert.match(requestAnswers, /\*\*Ids never move\*\*/);
  for (const [where, from] of [['template', answerSheet.indexOf('## Template')], ['worked example', answerSheet.indexOf('## Worked example')]]) {
    const settled = answerSheet.indexOf('## Already settled — nothing here needs an answer', from);
    const notForYou = answerSheet.indexOf('## Not for you', from);
    assert.ok(from !== -1 && settled !== -1 && notForYou !== -1 && settled < notForYou, `the ${where} puts the settled rows before "Not for you"`);
  }
  assert.match(itemFile, /the shot by file name when the item is about a screen/);
  // How a shot is taken, checked, and left out.
  for (const lesson of [
    /\*\*Two images per target\.\*\*/,
    /\*\*Drawn by the renderer, in the page, before the capture\.\*\*/,
    /\*\*Serve its data here too\.\*\*/,
    /\*\*Pin the build the reader will look at\*\*/,
    /\*\*Block every other host\.\*\*/,
    /## When the target is not found, the shot fails/,
    /\*\*Never a whole-screen\s+stand-in\*\*/,
    /## Open every image/,
    /## Every variant the question applies to/,
    /\*\*A state only a signed-in reader sees\*\*/,
    /\*\*Anything, when there is no renderer\.\*\*/,
    /\*\*A screen there is no build of here\*\*/,
    /## What the shooting reveals/,
  ]) assert.match(screens, lesson);
  // The same organisation markers as onboard-project's block above, read from that block so the
  // two cannot drift and a new line need not restate them.
  const ownSource = await read('test/catalog-content.test.mjs');
  const markerSource = ownSource.match(/assert\.doesNotMatch\(onboardProject, \/(.+?)\/\);/);
  assert.ok(markerSource, "onboard-project's block no longer checks for organisation markers");
  assert.ok(markerSource[1].split('|').length >= 2, 'every marker that block checks is checked here, not only the first');
  const organisationMarkers = new RegExp(markerSource[1]);
  for (const text of [requestAnswers, screens, answerSheet, itemFile]) {
    assert.doesNotMatch(text, organisationMarkers);
    assert.doesNotMatch(text, /~\/work\//);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
  }
});

// A transcript holds every secret that passed through a session, so the skill that reads them is
// held to never printing one, to counting the queued messages a search for user turns misses, and
// to saying which shapes it saw on which harness. Names have no public pattern; scan-denylist.mjs
// reads for those. The script's own behaviour is in mine-session-transcripts.test.mjs.
test('mine-session-transcripts reads transcripts without printing them, and states what it does not own', async () => {
  const skill = await read('skills/mine-session-transcripts/SKILL.md');
  // An installed copy carries no docs/, so the guide is cited by a URL that resolves anywhere.
  assert.match(skill, /\(https:\/\/github\.com\/crissmoldovan\/agent-skills\/blob\/main\/docs\/project-adaptation\.md\)/);
  const shapes = await read('skills/mine-session-transcripts/references/record-shapes.md');
  const documented = await read('skills/mine-session-transcripts/references/documented-or-not.md');
  const fitText = await read('skills/mine-session-transcripts/references/fit.json');
  const fit = JSON.parse(fitText);
  const script = await read('skills/mine-session-transcripts/scripts/transcripts.mjs');
  // Every file the skill ships, the script and the fit file as much as the prose, against the same
  // organisation markers as onboard-project's block, read from that block so the two cannot drift.
  const ownSource = await read('test/catalog-content.test.mjs');
  const markerSource = ownSource.match(/assert\.doesNotMatch\(onboardProject, \/(.+?)\/\);/);
  assert.ok(markerSource, "onboard-project's block no longer checks for organisation markers");
  const organisationMarkers = new RegExp(markerSource[1]);
  assert.match(' CUE ', organisationMarkers, 'the markers read from that block are the pattern the blocks above use');
  assert.ok(markerSource[1].split('|').length >= 2, 'every marker that block checks is checked here, not only the first');
  for (const text of [skill, shapes, documented, fitText, script]) {
    assert.doesNotMatch(text, organisationMarkers);
    assert.doesNotMatch(text, /~\/work\//);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
  }
  // CONTRIBUTING requires a new skill to say which shipped skills it does not duplicate.
  for (const sibling of ['decision-journal', 'investigate-codebase', 'delphi-ground', 'onboard-project']) {
    assert.match(skill, new RegExp(sibling));
  }
  // Every handoff to a sibling is a slot of kind skill, so a project can route it to its own.
  const bindings = section(skill, 'Bindings');
  for (const sibling of ['decision-journal', 'investigate-codebase', 'delphi-ground']) {
    assert.match(bindings, new RegExp(`\\| skill \\| \`${sibling}\` \\|`));
  }
  assert.equal(fit.kind, 'requestOnly');

  // The three failures it exists for: printing the transcript, missing queued messages, and a
  // matcher that cannot match.
  assert.match(skill, /\*\*H1\. Never print a transcript\.\*\*/);
  assert.match(skill, /\*\*H5\. Not found is never "never said"\.\*\*/);
  assert.match(shapes, /`attachment\.type: "queued_command"`, `attachment\.commandMode: "prompt"`/);
  assert.match(shapes, /`origin\.kind: "human"`/);
  assert.match(documented, /## Symmetry is the whole trick/);
  assert.match(documented, /\*\*A positive control\.\*\*/);
  // The failures are described, not measured: a count from the history the skill was built on is
  // not one a reader can check, so none is quoted.
  for (const [where, text] of [['SKILL.md', skill], ['record-shapes.md', shapes], ['documented-or-not.md', documented]]) {
    assert.doesNotMatch(text, /\b\d+\s+of\s+(?:the\s+)?\d+\b/, `${where} quotes a measured count`);
  }
  // Observed, not assumed: every shape is tagged, and the harness versions are named.
  assert.match(shapes, /\*\*OBSERVED\*\*: read from real transcripts written by \*\*Claude Code 2\.1\.224 to 2\.1\.286\*\*/);
  assert.match(shapes, /\| NOT OBSERVED \|/);

  for (const carried of ['references/record-shapes.md', 'references/documented-or-not.md', 'scripts/transcripts.mjs']) {
    assert.ok(skill.includes(carried), `SKILL.md does not name ${carried}`);
  }
  assert.match(readme, /\[Record shapes\]\(skills\/mine-session-transcripts\/references\/record-shapes\.md\)/);
});

// A project adapts a pack skill with update-agent-skills' composer (docs/project-adaptation.md). The
// copy stands in for the skill it adapts, so onboard-project must not offer that skill for install,
// call it missing, or route a session to the generic copy. Its behaviour is held in
// test/onboard-cli.test.mjs and test/onboard-profile.test.mjs; what is held here is that the skill,
// its reference and the catalogue's prose keep saying so, and stay free of a machine path, a real
// address or a real zone. Names have no shape a public test can hold; scripts/scan-denylist.mjs
// reads for those.
test('onboard-project counts an adapted copy as the skill it adapts, and routes to the copy', async () => {
  const contributing = await read('CONTRIBUTING.md');
  const adaptation = await read('docs/project-adaptation.md');

  // The description is what a listing shows, and the README carries it word for word: it must not
  // still say the check speaks whenever a listed skill is not installed.
  const description = onboardProject.match(/^description: "(.*)"$/m)[1];
  assert.match(description, /says one line when a listed skill is neither installed nor adapted here, the repository's evidence or its adapted copies move/);
  assert.match(onboardProject, /\*\*A skill this repository has adapted is already here\.\*\*/);
  assert.match(onboardProject, /no install command, and a routing line that names the copy\s+instead of the skill/);
  assert.match(onboardProject, /^\| Composing, checking and re-pinning a project's adapted copy of a pack skill \| `update-agent-skills` \| .*Never composes, edits or re-pins one\. \|$/m);
  assert.match(onboardProject, /\*\*Sending a session to the generic skill when the repository has adapted it\.\*\*/);
  assert.match(section(onboardProject, 'Verification'), /A skill this repository has adapted got no install command/);

  assert.match(onboardProjectWrites, /^- `adapted` records every adapted copy in this repository, keyed by the skill it adapts\./m);
  assert.match(onboardProjectWrites, /`adapted` \(the scan did not match it, and\s+this repository holds an adapted copy of it, which is the evidence\)/);
  assert.match(onboardProjectWrites, /→ `ask-the-owner`, this repository's adapted copy of `request-answers`/);
  assert.match(onboardProjectWrites, /unless one of four things is true/);
  assert.match(onboardProjectWrites, /renders exactly as it did before 1\.1\.0/);

  assert.match(contributing, /which names a\s+project's adapted copy of a skill rather than the skill it adapts/);
  // The release record, not the staged prose: docs/releases.md empties when a release is cut.
  assert.match(changelogText, /^\*\*\d+\. `onboard-project` counts an adapted copy as the skill it adapts, and routes to the copy\*\*$/m);
  assert.match(adaptation, /A repository onboarded with `onboard-project` counts the adapted copy as the skill\s+it adapts/);
  // The check compares each copy's ref and tree, so a pin moved without a refresh is reported at
  // every session start; the procedure that moves a pin has to say so, not only this skill.
  const adapting = await read('skills/update-agent-skills/references/adapting.md');
  assert.match(section(adapting, 'Moving a pin'), /In a repository onboarded with `onboard-project`, refresh its profile in that same change/);
  assert.match(changelogText, /names them at every\s+session start until a refresh\s+records them/);
  // Composing a first copy or removing one moves the check just as a re-pin does, so the commands
  // and the skill's own pin rule say so too, not only the procedure that moves a pin.
  assert.match(section(adapting, 'Commands'), /refresh its profile in the change that composes\s+a first copy, removes one, or moves a pin/);
  assert.match(updateAgentSkills, /refresh its profile in the\s+change that moves a pin, composes a first copy or removes one/);
  // Each kind of `adapted copy:` line says what to do with it, and a lock version this skill does
  // not read is not sent to the composer, whose own check would pass it.
  assert.match(onboardProject, /when the problem is a lock version this skill does not read, update\s+onboard-project/);
  assert.match(onboardProject, /`<copy> adapts <skill>, which this catalogue does not carry`/);
  // A skill listed only for its copy leaves with it, and a copy lifts a decline.
  assert.match(onboardProject, /except a skill listed only as `adapted`, which leaves with its last\s+copy/);
  assert.match(onboardProject, /composing a copy of a declined skill lifts\s+the decline/);
  assert.match(onboardProjectWrites, /The exception is a skill listed only as `adapted`/);
  assert.doesNotMatch(onboardProjectWrites, /whole text/, 'the routing paragraph says a copy over one file carries the whole skill');

  for (const [where, text] of [['SKILL.md', onboardProject], ['references/what-gets-written.md', onboardProjectWrites]]) {
    assert.doesNotMatch(text, /~\/work\//, `${where} carries a machine path`);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/, `${where} carries a real address`);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/, `${where} names a real zone`);
  }
});

// Blocks caught this on the catalog rewrite: the `blocks` entry's first ask read
// "Use request-blocks-review on this finished PR…", so a reader who installed `blocks` and typed
// the example would invoke a sibling skill they may not have. Nothing failed, because the tests
// checked that each description and link appeared, never that an ask belonged to its own entry.
test("no skill's example ask tells the reader to use a different skill", () => {
  const entries = [...readme.matchAll(/^### `([a-z0-9-]+)`$([\s\S]*?)(?=^### |^## )/gm)];
  const names = entries.map(([, name]) => name);
  assert.equal(names.length, 30, 'every skill has a catalog entry');
  for (const [, name, entry] of entries) {
    const asks = entry.match(/^- \*".*"\*$/gm) ?? [];
    for (const ask of asks) {
      for (const other of names) {
        if (other === name) continue;
        assert.doesNotMatch(
          ask,
          new RegExp(`\\bUse ${other}\\b`),
          `${name}'s ask tells the reader to use ${other}: ${ask}`,
        );
      }
    }
  }
});

// The README tells a reader that the fuller examples "are in each skill's own Usage Examples
// section". That was true of 27 skills: workspace-governance had none, so a reader who followed
// the sentence for that skill found nothing. Blocks caught it on the catalog rewrite. The promise
// is the invariant, so the invariant is what is tested.
test('every skill publishes a Usage Examples section, as the README promises', async () => {
  const names = (await readdir(new URL('skills/', root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(names.length, 30, 'the sweep must cover the whole pack');
  for (const name of names) {
    const source = await read(`skills/${name}/SKILL.md`);
    assert.match(
      source,
      /^## Usage Examples$/m,
      `${name} has no Usage Examples section, so the README's promise is false for it`,
    );
    const section = source.split(/^## Usage Examples$/m)[1];
    assert.match(
      section,
      /```/,
      `${name}'s Usage Examples section shows no example a reader can copy`,
    );
  }
});

// Blocks found this twice and it shipped anyway: the flat list's last two entries read
// `work-in-external-repo · handoff-prompt` under a line promising "in the order they appear
// above", while the catalog put `handoff-prompt` first. It was graded severity 7 on one head
// and severity 5 on the next, so the check went green and #68 merged with the defect in it.
// A severity number is a judgement; this is not. The list makes a claim about itself, so the
// claim is what is tested.
test('the flat skill list is in the catalog order it claims, and covers the pack', async () => {
  const sentinel = readme.match(/^The thirty, in the order they appear above:$/m);
  assert.ok(sentinel, 'the flat list no longer announces itself as catalog-ordered');

  const after = readme.slice(readme.indexOf(sentinel[0]) + sentinel[0].length);
  const listLine = after.split('\n').find((line) => line.trim() !== '');
  assert.ok(listLine, 'the sentence promising catalog order is followed by no list');
  const flat = [...listLine.matchAll(/`([a-z0-9-]+)`/g)].map(([, name]) => name);

  const onDisk = (await readdir(new URL('skills/', root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const catalog = [...readme.matchAll(/^### `([a-z0-9-]+)`$/gm)]
    .map(([, name]) => name)
    .filter((name) => onDisk.includes(name));

  assert.deepEqual(
    flat,
    catalog,
    'the flat list promises the catalog order and does not match it',
  );
  assert.deepEqual([...flat].sort(), onDisk, 'the flat list and the pack differ');
});
