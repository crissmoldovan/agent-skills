import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const skill = await read('skills/coding-teacher/SKILL.md');
const learner = await read('skills/coding-teacher/references/learner-and-comparisons.md');
const sources = await read('skills/coding-teacher/references/sources.md');
const lessonPages = await read('skills/coding-teacher/references/lesson-pages.md');
const library = await read('skills/coding-teacher/references/learning-library.md');
const template = await read('skills/coding-teacher/assets/lesson-page.html');
const fit = JSON.parse(await read('skills/coding-teacher/references/fit.json'));
const readme = await read('README.md');

const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)[1];
const description = frontmatter.match(/^description: "([^"\n]*)"$/m)?.[1] ?? '';
const body = skill.slice(skill.indexOf('\n---\n', 4) + 5);

function section(source, heading) {
  const start = source.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `missing ## ${heading}`);
  const rest = source.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

test('coding-teacher: the description says what it does, when to fire, and what it is not for', () => {
  assert.match(frontmatter, /^name: coding-teacher$/m);
  assert.ok(description.length > 0 && description.length <= 1024, `description is ${description.length} characters`);
  assert.match(description, /plain language/i);
  assert.match(description, /Symptoms:/);
  assert.match(description, /changes nothing/i);
  for (const sibling of ['investigate-codebase', 'layer-repository-docs']) {
    assert.match(description, new RegExp(sibling), `the description does not hand ${sibling}'s job over`);
  }
  assert.match(frontmatter, /^metadata: "group=workflow; lifecycle=release; version=1\.0\.0; author=crissmoldovan"$/m);
  assert.match(frontmatter, /^license: MIT$/m);
  // A teaching skill pre-approves no writing tool: it changes nothing in the project.
  const tools = frontmatter.match(/^allowed-tools: (.+)$/m)?.[1] ?? '';
  assert.doesNotMatch(tools, /\b(?:Write|Edit|NotebookEdit)\b/);
});

test('coding-teacher: the learner is described by their own field, asked once or inferred', () => {
  const bindings = section(skill, 'Bindings');
  assert.match(bindings, /\| B1 \| who is being taught[^|]*\| value \| ask once/);
  assert.match(skill, /comparison/i);
  // A comparison that only matches the mood teaches something false: it has to match the mechanism
  // and say where it stops.
  assert.match(skill, /\*\*H\d+\. A comparison matches the mechanism, and says where it stops\.\*\*/);
  assert.match(learner, /where it stops/i);
  assert.match(learner, /one question/i);
  // Worked across several fields, so no single field reads as the skill's audience.
  const fields = (learner.match(/^\| Concept \|(.*)\|$/m)?.[1] ?? '').split('|').map((cell) => cell.trim()).filter(Boolean);
  assert.ok(fields.length >= 4, `the comparison table covers ${fields.length} fields; it needs at least three and a stop column`);
});

test('coding-teacher: every claim about the project is grounded in its real files, read first', () => {
  assert.match(skill, /\*\*H\d+\. Read it before you name it\.\*\*/);
  assert.match(skill, /the code wins/i);
  assert.match(sources, /the code wins/i);
  assert.match(sources, /Read more/);
});

test('coding-teacher: the answer has its shape and the depth ladder has four rungs', () => {
  const shape = section(skill, 'The shape of an answer');
  for (const label of ['Short answer', 'How it works', 'In this project', 'Go deeper', 'Quick check']) {
    assert.ok(shape.includes(label), `the answer shape does not name ${label}`);
  }
  const ladder = section(skill, 'Depth ladder');
  for (const level of ['1. Idea', '2. In this project', '3. Under the hood', '4. Hands on']) {
    assert.ok(ladder.includes(level), `the depth ladder has no ${level}`);
  }
});

test('coding-teacher: it explains and changes nothing, and never shows a secret', () => {
  assert.match(skill, /\*\*H1\. Teaching changes nothing\.\*\*/);
  assert.match(skill, /\*\*H\d+\. No secret value, ever\.\*\*/);
  assert.match(skill, /production[^.]*never a sandbox/i);
  // A change the learner asks for is a separate task, sent where the project's own path says.
  assert.match(section(skill, 'Bindings'), /\| B\d+ \| where a change the learner asks for goes/);
});

test('coding-teacher: a lesson page has one question per component, pictures, the big picture and a glossary', () => {
  for (const phrase of [/one plain question per component/i, /inline SVG/i, /prefers-reduced-motion/, /the big picture/i, /glossary/i, /one line/i]) {
    assert.match(lessonPages, phrase);
  }
  assert.match(skill, /one plain question per component/i);
  assert.match(lessonPages, /Pause motion/);
});

test('coding-teacher: the lesson-page template is one self-contained page that respects reduced motion', () => {
  assert.match(template, /^<!doctype html>/i);
  assert.match(template, /<title>[^<]+<\/title>/);
  // Light and dark: tokens on :root, dark guarded so an explicit light theme wins, and a forced dark.
  assert.match(template, /@media \(prefers-color-scheme: ?dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(template, /:root\[data-theme="dark"\]/);
  // Reduced motion in both places motion comes from: CSS animations, and the script's own movement.
  assert.match(template, /@media \(prefers-reduced-motion: ?reduce\)/);
  assert.match(template, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(template, /id="motion"[^>]*aria-pressed="false"/);
  // Pause motion stops everything, the journey's own stepping included: its handler stops the
  // journey timer as well as the animations, and reduced motion starts with neither running.
  const motionHandler = template.match(/motionBtn\.addEventListener\('click', function \(\) \{([\s\S]*?)\n  \}\);/)?.[1] ?? '';
  assert.match(motionHandler, /still = !still;/);
  assert.match(motionHandler, /playing = !still;/, 'Pause motion leaves the journey stepping');
  assert.match(motionHandler, /setTimer\(\);/, 'Pause motion leaves the journey timer running');
  assert.match(template, /still = reduce, playing = !reduce/);
  // Revealing on scroll never hides anything from a reader whose script did not run.
  assert.match(template, /documentElement\.classList\.add\('js'\)/);
  assert.match(template, /\.js \.reveal\{/);
  // Inline SVG, every one either described or hidden from assistive technology.
  const svgs = [...template.matchAll(/<svg\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(svgs.length >= 4, `the template carries ${svgs.length} inline SVGs`);
  for (const tag of svgs) {
    assert.ok(/role="img"[^>]*aria-label="[^"]+"/.test(tag) || /aria-hidden="true"/.test(tag), `an SVG is neither described nor hidden: ${tag}`);
  }
  // No script is loaded from anywhere: the page works from one file.
  assert.doesNotMatch(template, /<script[^>]+src=/i);
  for (const part of ['class="lesson"', 'class="quiz"', 'class="sofar"', 'The big picture', 'class="glossary"', 'class="pair"']) {
    assert.ok(template.includes(part), `the template has no ${part}`);
  }
});

test('coding-teacher: it declares where it fits, links what it carries, and carries no organisation marks', async () => {
  assert.equal(fit.kind, 'general');
  assert.ok(fit.useWhen.length > 20);
  for (const carried of ['references/learner-and-comparisons.md', 'references/sources.md', 'references/lesson-pages.md', 'references/learning-library.md', 'assets/lesson-page.html']) {
    assert.ok(skill.includes(`](${carried})`), `SKILL.md does not link ${carried}`);
  }
  const files = (await readdir(new URL('skills/coding-teacher/', root), { recursive: true })).filter((file) => /\.(?:md|html|json)$/.test(file));
  for (const file of files) {
    const text = await read(`skills/coding-teacher/${file}`);
    assert.doesNotMatch(text, /\bCUE\b|\bRGC\b/, `${file} carries an organisation mark`);
  }
  // CONTRIBUTING requires a new skill to say which shipped skills it does not duplicate.
  for (const sibling of ['investigate-codebase', 'layer-repository-docs', 'visualise-blast-area']) {
    assert.match(body, new RegExp(`\`${sibling}\``));
  }
});

test('coding-teacher: the README entry carries the exact description, its install command and its asks', () => {
  const entry = readme.match(/^### `coding-teacher`$([\s\S]*?)(?=^### |^## )/m)?.[1] ?? '';
  assert.ok(entry.includes(description), 'the README entry does not carry the description word for word');
  assert.match(entry, /npx skills add crissmoldovan\/agent-skills --skill coding-teacher/);
  const asks = entry.match(/^- \*".*"\*$/gm) ?? [];
  assert.ok(asks.length >= 1 && asks.length <= 3, `the entry has ${asks.length} asks`);
  const examples = section(skill, 'Usage Examples');
  for (const ask of asks) {
    const text = ask.slice(4, -2).replace(/…$/, '');
    assert.ok(examples.replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' ')), `README ask is not one of the skill's own examples: ${ask}`);
  }
});
