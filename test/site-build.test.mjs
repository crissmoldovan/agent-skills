import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSite, collectSkills, stripFrontmatter } from '../scripts/build-site.mjs';
import { tempDir } from './helpers/temp-dir.mjs';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const skillNames = (await readdir(path.join(root, 'skills'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const out = await tempDir('agent-skills-site-');
const result = await buildSite({ root, out });
const index = await readFile(path.join(out, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));

const exists = async (file) => {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
};

test('the site carries every skill in the pack, and invents none', () => {
  assert.deepEqual(
    manifest.skills.map((skill) => skill.name).sort(),
    skillNames,
    'the manifest and the skills directory must name the same skills',
  );
  assert.equal(manifest.skills.length, 29);
});

test("each entry states the description a runtime matches, copied from the skill's own frontmatter", async () => {
  for (const skill of manifest.skills) {
    const source = await readFile(path.join(root, 'skills', skill.name, 'SKILL.md'), 'utf8');
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, `${skill.name} must open with frontmatter`);
    assert.ok(
      frontmatter[1].includes(skill.description.replace(/\s+/g, ' ').slice(0, 60)),
      `${skill.name}'s site description must come from its frontmatter, not be written for the site`,
    );
    assert.ok(skill.description.length > 40, `${skill.name} needs its real description`);
  }
});

test('each entry carries the install command for that one skill', () => {
  for (const skill of manifest.skills) {
    assert.ok(skill.install.length >= 1, `${skill.name} needs an install command`);
    assert.ok(
      skill.install[0].includes(`--skill ${skill.name}`),
      `${skill.name}'s first install step must install ${skill.name}`,
    );
  }
});

test("an entry shows the skill's own asks and commands, verbatim, and invents neither", async () => {
  // A skill publishes its Usage Examples as fenced blocks: a `text` block is a prompt somebody
  // types, a `bash` block is a command they run. Anything else there is illustrative output — a
  // sample release note, for instance — and is not an ask, so the site does not present it as one.
  const blocks = (source, language) => {
    const lines = source.split('\n');
    let index = lines.findIndex((line) => /^## Usage Examples\s*$/.test(line));
    if (index === -1) return null;
    const found = [];
    let fence = null;
    let current = null;
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      const open = line.match(/^(```+|~~~+)([a-z]*)\s*$/);
      if (open && !fence) {
        fence = open[1];
        current = open[2] === language ? [] : null;
        continue;
      }
      if (fence && line.startsWith(fence)) {
        if (current) found.push(current.join('\n').trim());
        fence = null;
        current = null;
        continue;
      }
      if (!fence && /^## /.test(line)) break;
      if (current) current.push(line);
    }
    return found;
  };

  for (const skill of manifest.skills) {
    const source = await readFile(path.join(root, 'skills', skill.name, 'SKILL.md'), 'utf8');
    assert.deepEqual(
      skill.examples,
      blocks(source, 'text') ?? [],
      `${skill.name}'s asks must be the text blocks of its own Usage Examples, verbatim`,
    );
    assert.deepEqual(
      skill.commands,
      blocks(source, 'bash') ?? [],
      `${skill.name}'s commands must be the bash blocks of its own Usage Examples, verbatim`,
    );
  }

  const withAsks = manifest.skills.filter((skill) => skill.examples.length);
  assert.ok(withAsks.length >= 25, 'nearly every skill publishes asks; the site must carry them');
});

test('a skill whose examples are not prompts is shown without invented ones', async () => {
  // Every skill publishes a Usage Examples section, but not every block in one is a prompt:
  // decision-journal's are commands, and release-notes shows a sample note in a `markdown`
  // block. Neither is an ask, so neither is presented as one — the card shows what the skill
  // has, and nothing else.
  const journal = manifest.skills.find((skill) => skill.name === 'decision-journal');
  assert.deepEqual(journal.examples, [], 'its examples are commands, not prompts');
  assert.ok(journal.commands.length >= 1, 'so its commands are what the card shows');

  const notes = manifest.skills.find((skill) => skill.name === 'release-notes');
  const source = await readFile(path.join(root, 'skills/release-notes/SKILL.md'), 'utf8');
  assert.ok(source.includes('```markdown'), 'this test is only meaningful while that holds');
  assert.deepEqual(notes.examples, [], 'a sample note is output, not an ask');
  assert.deepEqual(notes.commands, []);

  const withAsks = manifest.skills.filter((skill) => skill.examples.length);
  assert.equal(withAsks.length, 27, 'every other skill publishes prompts, and the site shows them');
});

test('every document the site links is written into the output', async () => {
  const docs = [...manifest.skills.flatMap((skill) => skill.documents), ...manifest.documents];
  assert.ok(docs.length >= 29 + 85, 'the skills and their references both belong on the site');
  for (const doc of docs) {
    assert.ok(
      await exists(path.join(out, 'content', doc.path)),
      `${doc.path} is linked but was not written`,
    );
  }
});

test('the page needs no install and no build step, and shows its text with no network', () => {
  assert.ok(
    index.includes('cdn.jsdelivr.net/npm/marked@'),
    'the renderer is pinned and comes from a CDN, so a reader installs nothing',
  );
  assert.ok(
    /id="fallback"|pre class="raw"/.test(index),
    'with no network the page must still show the text',
  );
  assert.ok(!/<\/script/i.test(JSON.stringify(manifest)), 'no manifest value may close the script');
  assert.equal(result.skills, 29);
});

test('the shell needs no build step of its own: no bundler, no framework, no npm dependency', () => {
  assert.ok(!index.includes('type="module" src="./'), 'no local module graph to bundle');
  const scripts = [...index.matchAll(/<script[^>]*src="([^"]+)"/g)].map((match) => match[1]);
  for (const src of scripts) {
    assert.ok(src.startsWith('https://cdn.jsdelivr.net/'), `${src} is not an allowed source`);
  }
});

// The shell's script is written inside a template literal, where an escape meant for the emitted
// JavaScript is one backslash away from being interpreted while the page is generated. That
// happened: a `join('\n\n')` came out as a string broken across two lines, and every card on the
// page was lost to one syntax error. Parsing the emitted script is what notices.
test('the script the page ships parses as JavaScript', () => {
  const scripts = [...index.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 1, 'the page ships an inline script');
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), 'the emitted script must parse');
  }
});

test('the manifest the page reads parses as JSON, and names every skill', () => {
  const embedded = index.match(
    /<script id="manifest" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assert.ok(embedded, 'the page embeds its manifest');
  const parsed = JSON.parse(embedded[1]);
  assert.deepEqual(
    parsed.skills.map((skill) => skill.name).sort(),
    skillNames,
    'the embedded manifest must carry the same skills as the file beside it',
  );
});

test('a skill body is rendered without the frontmatter a renderer would draw as a heading', async () => {
  const source = await readFile(path.join(root, 'skills/request-answers/SKILL.md'), 'utf8');
  const body = stripFrontmatter(source);
  assert.ok(source.startsWith('---\n'), 'this test is only meaningful for a document with one');
  assert.ok(!body.includes('name: request-answers'), 'the frontmatter must be gone');
  assert.ok(!body.includes('allowed-tools:'), 'every frontmatter key must be gone');
  assert.ok(body.startsWith('# '), 'the body must open with its own first heading');
  assert.equal(stripFrontmatter('# No frontmatter\n\nbody\n'), '# No frontmatter\n\nbody\n');
  assert.equal(stripFrontmatter('---\nonly: an unterminated block\n'), '---\nonly: an unterminated block\n');
  assert.ok(index.includes('stripFrontmatter'), 'the page must run the same stripping');
});
