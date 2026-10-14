import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The parts of a skill's contract that every skill in this catalogue shares (CONTRIBUTING, "What
 * every skill carries"), read the way the per-skill tests read them. A missing file reads as empty,
 * so each assertion that depends on it fails readably instead of the module failing to load.
 */

const root = new URL('../../', import.meta.url);

export function readSkill(name) {
  const directory = fileURLToPath(new URL(`skills/${name}/`, root));
  const read = (path) => {
    const file = resolve(directory, path);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  };
  const references = existsSync(resolve(directory, 'references'))
    ? readdirSync(resolve(directory, 'references')).filter((file) => file.endsWith('.md'))
    : [];
  const fitSource = read('references/fit.json');
  return {
    directory,
    skill: read('SKILL.md'),
    read,
    references,
    fit: fitSource ? JSON.parse(fitSource) : {},
    readme: readFileSync(new URL('README.md', root), 'utf8'),
  };
}

export function frontmatterField(source, key) {
  const match = source.match(new RegExp(`^${key}:[ \\t]*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\n]+?))[ \\t]*$`, 'm'));
  return match ? (match[1] ?? match[2] ?? match[3]) : '';
}

// Mirrors scripts/verify-skills.mjs: the cap applies to the body, not the file.
export function bodyLineCount(source) {
  if (!source.startsWith('---\n')) return source.split('\n').length;
  const close = source.indexOf('\n---\n', 4);
  if (close < 0) return source.split('\n').length;
  const body = source.slice(close + 5);
  if (body === '') return 0;
  return body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
}

export function section(source, heading) {
  const start = source.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `missing ## ${heading}`);
  const rest = source.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

// Steps come back whitespace-collapsed: the pack hard-wraps prose, and a requirement broken across
// two lines is still the requirement.
export function procedureSteps(source) {
  return section(source, 'Procedure')
    .split(/\n(?=\d+\. )/)
    .filter((chunk) => /^\d+\. /.test(chunk.trim()))
    .map((chunk) => chunk.trim().replace(/\s+/g, ' '));
}

export function prerequisiteItems(source) {
  return section(source, 'Prerequisites')
    .split(/\n(?=\d+\. )/)
    .filter((chunk) => /^\d+\. /.test(chunk.trim()))
    .map((chunk) => chunk.trim().replace(/\s+/g, ' '));
}

export function fenced(source, language) {
  return [...source.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```', 'g'))].map((match) => match[1]);
}

/** The shape every skill in the catalogue carries, held for one skill. */
export function assertCatalogueShape(name, { skill, references, fit, readme }) {
  assert.ok(skill, `skills/${name}/SKILL.md does not exist`);
  assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`));
  const description = frontmatterField(skill, 'description');
  assert.ok(description.length > 0 && [...description].length <= 1024, 'description missing or over 1024 characters');
  assert.ok(readme.includes(description), 'the README does not carry the exact description');
  assert.match(description, /Symptoms:/, 'the description gives no symptoms a person would type');
  const compatibility = frontmatterField(skill, 'compatibility');
  assert.ok(compatibility.length > 0 && [...compatibility].length <= 500, 'compatibility missing or over 500 characters');
  assert.equal(frontmatterField(skill, 'license'), 'MIT');
  assert.match(frontmatterField(skill, 'metadata'), /^group=workflow; lifecycle=release; version=\d+\.\d+\.\d+; author=crissmoldovan$/);
  assert.ok(frontmatterField(skill, 'allowed-tools'), 'allowed-tools missing');
  assert.ok(bodyLineCount(skill) <= 484, `body is ${bodyLineCount(skill)} lines; the cap is 484`);

  const order = ['## When to Use', '## Prerequisites', '## Procedure', '## Usage Examples', '## What it looks like', '## Pitfalls', '## Verification', '## Deeper reading'];
  let previous = -1;
  for (const heading of order) {
    const at = skill.indexOf(`\n${heading}\n`);
    assert.notEqual(at, -1, `missing ${heading}`);
    assert.ok(at > previous, `${heading} is out of order`);
    previous = at;
  }

  for (const item of prerequisiteItems(skill)) {
    assert.ok(item.includes('**Complete when:**'), `prerequisite has no completion clause: ${item.slice(0, 60)}`);
  }
  for (const step of procedureSteps(skill)) {
    assert.ok(step.includes('**Complete when:**'), `procedure step has no completion clause: ${step.slice(0, 60)}`);
  }

  // It says which shipped skills own the jobs beside it, and each one it names is shipped.
  const ownersAt = skill.indexOf('### What this skill does not own');
  assert.notEqual(ownersAt, -1, 'no "What this skill does not own" section');
  const owners = skill.slice(ownersAt, skill.indexOf('\n## When to Use\n'));
  assert.ok(owners.includes('| The job | Whose it is | What this skill does with it |'), 'no "what this skill does not own" table');
  for (const [, sibling] of owners.matchAll(/^\| [^|]+ \| `([a-z0-9-]+)` \|/gm)) {
    assert.ok(existsSync(fileURLToPath(new URL(`skills/${sibling}/SKILL.md`, root))), `names a sibling the catalogue does not ship: ${sibling}`);
  }

  // Every reference it carries is linked, so a reader and the site can reach it.
  for (const reference of references) {
    assert.ok(skill.includes(`](references/${reference})`), `SKILL.md does not link references/${reference}`);
  }
  assert.ok(['signals', 'general', 'requestOnly'].includes(fit.kind), 'references/fit.json has no valid kind');

  // The README's entry leads with an ask that names the skill.
  assert.ok(readme.includes(`- *"Use ${name}`), `the README entry has no lead "Use ${name}" ask`);

  // Public and portable: no machine path, no real address, no real zone. Names have no shape a
  // public test can hold; scripts/scan-denylist.mjs reads for those against a private list.
  const everything = [skill, ...references.map((reference) => readFileSync(resolve(fileURLToPath(new URL(`skills/${name}/references/`, root)), reference), 'utf8'))];
  for (const text of everything) {
    assert.doesNotMatch(text, /(?:\/Users\/|\/home\/|C:\\Users\\|~\/work\/)/);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
  }
}
