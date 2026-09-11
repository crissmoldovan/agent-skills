import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const skillDirectory = fileURLToPath(new URL('skills/report-progress/', root));

// A missing SKILL.md must surface as a readable assertion in every test below,
// not as one module-load stack trace that hides which contract terms are unmet.
async function readOrEmpty(path) {
  try {
    return await readFile(new URL(path, root), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

const skill = await readOrEmpty('skills/report-progress/SKILL.md');
const lifecycle = await readOrEmpty('skills/agent-lifecycle/SKILL.md');

// Prose is hard-wrapped in this pack, so a sentence-level assertion is made against a
// whitespace-collapsed copy: reflowing a paragraph is allowed, losing the sentence is not.
const flat = skill.replace(/\s+/g, ' ');

function descriptionOf(source) {
  const match = source.match(/^description:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\n]+?))[ \t]*$/m);
  return match ? (match[1] ?? match[2] ?? match[3]) : '';
}

function frontmatterField(source, key) {
  const match = source.match(new RegExp(`^${key}:[ \\t]*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\n]+?))[ \\t]*$`, 'm'));
  return match ? (match[1] ?? match[2] ?? match[3]) : '';
}

// Mirrors scripts/verify-skills.mjs: the cap applies to the body, not the file.
function bodyLineCount(source) {
  if (!source.startsWith('---\n')) return source.split('\n').length;
  const close = source.indexOf('\n---\n', 4);
  if (close < 0) return source.split('\n').length;
  const body = source.slice(close + 5);
  if (body === '') return 0;
  return body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
}

function section(source, heading) {
  const start = source.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing ## ${heading}`);
  const rest = source.slice(start + heading.length + 3);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

function subsection(source, heading) {
  const start = source.indexOf(`### ${heading}`);
  assert.notEqual(start, -1, `missing ### ${heading}`);
  const rest = source.slice(start + heading.length + 4);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

// The five rules are the skill's substance. Each is asserted by its exact published
// name, because a rewording that loosens one ("prefer verified numbers") is precisely
// the silent drift this file exists to catch.
const FIVE_RULES = [
  'Verified and claimed are different words',
  'Report state, not activity',
  'Name the user-facing consequence, not the code change',
  'Corrections are first-class and plain',
  'Nothing-to-report is a valid report; invention never is',
];

test('report-progress is a discoverable skill within the catalogue field limits', () => {
  assert.ok(skill, 'skills/report-progress/SKILL.md does not exist');
  assert.match(skill, /^---\nname: report-progress\n/);
  const description = descriptionOf(skill);
  assert.ok(description.length > 0, 'frontmatter description missing');
  assert.ok([...description].length <= 1024, 'description exceeds the 1024-character limit');
  const compatibility = frontmatterField(skill, 'compatibility');
  assert.ok([...compatibility].length <= 500, 'compatibility exceeds the 500-character limit');
  assert.ok(bodyLineCount(skill) <= 484, `body is ${bodyLineCount(skill)} lines; the cap is 484`);
});

test('report-progress keeps the pack section order', () => {
  const order = ['## When to Use', '## Prerequisites', '## Procedure', '## Usage Examples', '## Pitfalls', '## Verification'];
  let previous = -1;
  for (const heading of order) {
    const at = skill.indexOf(heading);
    assert.notEqual(at, -1, `missing ${heading}`);
    assert.ok(at > previous, `${heading} is out of order`);
    previous = at;
  }
});

test('every procedure step states when it is complete', () => {
  const procedure = section(skill, 'Procedure');
  const steps = procedure.split(/\n(?=\d+\. )/).filter((chunk) => /^\d+\. /.test(chunk.trim()));
  assert.ok(steps.length >= 6, `expected a numbered procedure, found ${steps.length} steps`);
  for (const step of steps) {
    const label = step.trim().split('\n')[0].slice(0, 60);
    assert.ok(step.includes('**Complete when:**'), `procedure step has no completion clause: ${label}`);
  }
});

test('all five reporting rules are present by name', () => {
  for (const rule of FIVE_RULES) {
    assert.ok(flat.includes(rule), `missing rule: ${rule}`);
  }
  // The rules must be numbered so the worked examples and pitfalls can cite them.
  for (let index = 1; index <= 5; index += 1) {
    assert.match(skill, new RegExp(`rule ${index}\\b`), `nothing cites rule ${index}`);
  }
});

test('the skill is honest that instructions cannot enforce anything at runtime', () => {
  assert.ok(flat.includes('A skill is instructions'), 'the scope limit is not stated');
  assert.match(flat, /cannot make a model do anything/);
  assert.match(flat, /no ambiguity about what was owed/);
  assert.match(flat, /no way to claim compliance without/);
  // Overclaiming a runtime guarantee would be the same failure the skill forbids.
  assert.doesNotMatch(skill, /\b(?:guarantees|ensures|enforces at runtime|makes the agent|forces the agent|forces the model)\b/i);
});

test('"what is running" is sourced from agent-lifecycle, with its exact fallback sentence', () => {
  const fallback = lifecycle.match(/state exactly:\s*\n`([^`]+)`/);
  assert.ok(fallback, 'agent-lifecycle no longer publishes an exact no-evidence sentence');
  const sentence = fallback[1];
  assert.ok(sentence.length > 20, 'the extracted lifecycle sentence looks wrong');
  assert.ok(skill.includes('agent-lifecycle'), 'the lifecycle composition is not named');
  assert.ok(skill.includes(sentence), `report-progress must carry the lifecycle sentence verbatim: ${sentence}`);
  assert.match(skill, /lifecycle evidence/);
});

test('the trigger points and the counter-triggers are both explicit', () => {
  const when = section(skill, 'When to Use');
  for (const trigger of [/phase or milestone boundary/i, /background/i, /status/i, /already reported was wrong/i]) {
    assert.match(when, trigger, `missing trigger: ${trigger}`);
  }
  assert.match(when, /Do not use it/);
  assert.match(when, /single-step/i);
  assert.match(when, /no phases/i);
  assert.match(when, /ceremony/i);
});

test('the usage examples carry a copyable good report and a named-failure bad one', () => {
  const examples = section(skill, 'Usage Examples');
  const fenced = [...examples.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]);
  assert.ok(fenced.length >= 3, `expected pasteable text blocks, found ${fenced.length}`);

  const good = subsection(skill, 'A report that works');
  assert.match(good, /Done — verified/);
  assert.match(good, /Done — claimed/);
  assert.match(good, /Running:/);
  assert.match(good, /Next:/);
  assert.match(good, /\b\d+ of \d+\b/, 'the good example has no count with a denominator');

  const bad = subsection(skill, 'The same moment, reported badly');
  assert.match(bad, /```text\n[\s\S]*?\n```/, 'the bad example is not a pasteable block');
  assert.match(bad, /rule \d/, 'the bad example does not name which rule it breaks');
  assert.ok(
    [...bad.matchAll(/rule \d/g)].length >= 3,
    'the bad example names fewer than three specific failures',
  );
});

test('pitfalls name a failure and its consequence', () => {
  const pitfalls = section(skill, 'Pitfalls');
  const bullets = [...pitfalls.matchAll(/^- \*\*[^*]+\*\*/gm)];
  assert.ok(bullets.length >= 6, `expected at least six named pitfalls, found ${bullets.length}`);
  for (const pattern of [/child/i, /silent repair/i, /predict/i]) {
    assert.match(pitfalls, pattern, `missing pitfall: ${pattern}`);
  }
});

test('verification is a checklist a reviewer can run over a written report', () => {
  const verification = section(skill, 'Verification');
  const boxes = [...verification.matchAll(/^- \[ \] /gm)];
  assert.ok(boxes.length >= 8, `expected at least eight checklist items, found ${boxes.length}`);
  for (const pattern of [/claim/i, /lifecycle/i, /correction/i, /has not happened yet/i, /count or a named artefact/i]) {
    assert.match(verification, pattern, `missing checklist item: ${pattern}`);
  }
});

test('the skill promises no carried file it does not ship, and no local path', () => {
  assert.ok(skill, 'skills/report-progress/SKILL.md does not exist');
  const carried = /(?:^|[^A-Za-z0-9._/-])((?:references|scripts|assets)\/[A-Za-z0-9._/-]+)/g;
  for (const match of skill.matchAll(carried)) {
    const token = match[1].replace(/[.,;:)\]]+$/, '');
    assert.ok(existsSync(resolve(skillDirectory, token)), `names a carried file the skill does not carry: ${token}`);
  }
  assert.doesNotMatch(skill, /(?:\/Users\/|\/home\/|C:\\Users\\)/);
  assert.doesNotMatch(skill, /\bCUE\b|\bRGC\b/);
});
