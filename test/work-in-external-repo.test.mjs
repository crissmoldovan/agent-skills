import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const skillDirectory = fileURLToPath(new URL('skills/work-in-external-repo/', root));

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

const skill = await readOrEmpty('skills/work-in-external-repo/SKILL.md');

// Prose is hard-wrapped in this pack, so sentence-level assertions are made against a
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

// Steps are returned whitespace-collapsed: the pack hard-wraps prose, and a command or a
// requirement broken across two lines is still the command or the requirement.
function procedureSteps(source) {
  const procedure = section(source, 'Procedure');
  return procedure
    .split(/\n(?=\d+\. )/)
    .filter((chunk) => /^\d+\. /.test(chunk.trim()))
    .map((chunk) => chunk.trim().replace(/\s+/g, ' '));
}

// The eight acts, in the order the skill performs them. Order is part of the contract:
// locating after cloning, or branching before fetching, is exactly the drift that produced
// the incidents recorded in the Pitfalls section.
const PROCEDURE_ORDER = [
  /establish the target/i,
  /locate before creating/i,
  /before cloning/i,
  /refresh the base ref/i,
  /dedicated worktree/i,
  /forbidden operations/i,
  /name the destination/i,
  /clean up/i,
];

// Never run against a tree another session may be holding. Each must be named literally;
// "avoid destructive git commands" is the loosening this list exists to catch.
const FORBIDDEN_OPERATIONS = ['git stash', 'git reset', 'git checkout --'];

test('work-in-external-repo is a discoverable skill within the catalogue field limits', () => {
  assert.ok(skill, 'skills/work-in-external-repo/SKILL.md does not exist');
  assert.match(skill, /^---\nname: work-in-external-repo\n/);
  const description = descriptionOf(skill);
  assert.ok(description.length > 0, 'frontmatter description missing');
  assert.ok([...description].length <= 1024, 'description exceeds the 1024-character limit');
  assert.match(description, /repositor/i, 'the description does not say what is being worked in');
  const compatibility = frontmatterField(skill, 'compatibility');
  assert.ok([...compatibility].length <= 500, 'compatibility exceeds the 500-character limit');
  assert.ok(bodyLineCount(skill) <= 484, `body is ${bodyLineCount(skill)} lines; the cap is 484`);
});

test('work-in-external-repo keeps the pack section order', () => {
  const order = ['## When to Use', '## Prerequisites', '## Procedure', '## Usage Examples', '## Pitfalls', '## Verification'];
  let previous = -1;
  for (const heading of order) {
    const at = skill.indexOf(heading);
    assert.notEqual(at, -1, `missing ${heading}`);
    assert.ok(at > previous, `${heading} is out of order`);
    previous = at;
  }
});

test('the procedure runs the eight acts in order, each with a completion clause', () => {
  const steps = procedureSteps(skill);
  assert.ok(steps.length >= 8, `expected at least eight numbered steps, found ${steps.length}`);
  for (const step of steps) {
    const label = step.slice(0, 60);
    assert.ok(step.includes('**Complete when:**'), `procedure step has no completion clause: ${label}`);
  }
  PROCEDURE_ORDER.forEach((pattern, index) => {
    assert.match(steps[index] ?? '', pattern, `procedure step ${index + 1} is not the expected act: ${pattern}`);
  });
});

test('the current repository is never assumed to be the target', () => {
  assert.ok(
    flat.includes('Never assume the current repository is the target'),
    'the skill no longer states the assumption it exists to break',
  );
  assert.match(procedureSteps(skill)[0] ?? '', /by name/i, 'step 1 does not require naming the target');
});

test('the locate step proves the checkout by its origin remote and refuses to guess', () => {
  const locate = procedureSteps(skill)[1] ?? '';
  assert.match(locate, /git (?:-C \S+ )?worktree list/, 'existing worktrees are not consulted');
  assert.match(locate, /remote get-url origin/, 'the origin remote is not read');
  assert.match(
    flat,
    /right name is not proof|name is not proof|matching name is not proof/i,
    'the skill does not say that a matching directory name proves nothing',
  );
  assert.match(locate, /\bask the user\b/i, 'the ambiguous case does not escalate to the user');
  assert.match(locate, /zero|none/i, 'the zero-candidate case is not handled');
  assert.match(locate, /several|more than one|multiple/i, 'the several-candidate case is not handled');
  assert.match(locate, /before (?:writing|editing|any write)/i, 'confirmation is not required before writing');
});

test('a missing checkout is cloned only to a confirmed destination', () => {
  const clone = procedureSteps(skill)[2] ?? '';
  assert.match(clone, /clone/i);
  assert.match(clone, /never invent|do not invent/i, 'inventing a parent directory is not forbidden');
  assert.match(clone, /confirm/i, 'the destination is not confirmed with the user');
});

test('the base ref is refreshed and ahead/behind is reported before any branch is cut', () => {
  const refresh = procedureSteps(skill)[3] ?? '';
  assert.match(refresh, /git (?:-C [^\s]+ )?fetch/, 'nothing fetches the base ref');
  assert.match(refresh, /rev-list --left-right --count/, 'ahead/behind is not measured with a named command');
  assert.match(refresh, /ahead/i);
  assert.match(refresh, /behind/i);
  assert.match(
    flat,
    /stale base is the default state|default state of a checkout/i,
    'the skill no longer treats staleness as the default rather than the exception',
  );
});

test('work happens in a dedicated worktree on a branch, never in the shared checkout', () => {
  const worktree = procedureSteps(skill)[4] ?? '';
  assert.match(worktree, /`git worktree add -b \S+ \S+ \S+`/, 'the documented worktree form carries no explicit base ref');
  assert.match(flat, /never in the shared checkout/i, 'the shared-checkout prohibition is gone');
  assert.match(worktree, /another session/i, 'the reason — a concurrent session — is not given');
});

test('the destructive operations are named literally and forbidden in a shared tree', () => {
  const forbidden = procedureSteps(skill)[5] ?? '';
  for (const operation of FORBIDDEN_OPERATIONS) {
    assert.ok(forbidden.includes(`\`${operation}\``), `the forbidden list no longer names ${operation}`);
  }
  assert.match(forbidden, /rebas/i, 'rebasing is not forbidden');
  assert.match(forbidden, /amend/i, 'amending commits the agent did not create is not forbidden');
  assert.match(forbidden, /stage[^.]*explicit path|explicit path/i, 'staging by explicit path is not required');
  assert.doesNotMatch(forbidden, /\bgit add -A\b|\bgit add \.\B/, 'the skill suggests a whole-tree stage');
});

test('every result names the repository, branch, worktree path and commits', () => {
  const report = procedureSteps(skill)[6] ?? '';
  const completion = report.split('**Complete when:**')[1] ?? '';
  for (const pattern of [/repositor/i, /branch/i, /worktree/i, /commit/i]) {
    assert.match(report, pattern, `the destination report omits: ${pattern}`);
    // The four are what the step is finished by, not a list it mentions in passing.
    assert.match(completion, pattern, `the step can be called complete without: ${pattern}`);
  }
  assert.match(
    flat,
    /assume (?:it is )?the current one|assume the current repository/i,
    'the skill does not say what an unnamed destination invites the reader to assume',
  );
  const landed = subsection(skill, 'A result that names where the work landed');
  assert.match(landed, /```text\n[\s\S]*?\n```/, 'the destination report is not a pasteable block');
  for (const label of [/^Repository:/m, /^Branch:/m, /^Worktree:/m, /^Commits:/m]) {
    assert.match(landed, label, `the worked destination report has no ${label} line`);
  }
});

test('the run ends with the worktree removed or its survival stated', () => {
  const cleanup = procedureSteps(skill)[7] ?? '';
  assert.match(cleanup, /git (?:-C \S+ )?worktree remove/, 'no removal command is given');
  assert.match(cleanup, /hand(?:ed)? over|remains|left in place/i, 'the hand-over alternative is missing');
  assert.match(flat, /blocks the branch from being deleted|cannot be deleted/i, 'the cost of a forgotten worktree is gone');
});

test('both grounding incidents survive, each with its consequence', () => {
  const pitfalls = section(skill, 'Pitfalls');
  assert.match(pitfalls, /228 commits behind/, 'the stale-checkout incident is gone');
  assert.match(pitfalls, /two generations|two-generations/i, 'the stale-checkout consequence is gone');
  assert.match(pitfalls, /conflict/i, 'the stale-checkout incident no longer says what the pull request looked like');
  assert.match(pitfalls, /`git stash`/, 'the shared-worktree incident no longer names the command');
  assert.match(pitfalls, /revert/i, 'the shared-worktree incident no longer says what happened to the files');
  assert.match(pitfalls, /uncommitted/i, 'the shared-worktree incident no longer says which files were lost');
  assert.match(pitfalls, /(?:other|second|another) agent/i, 'the shared-worktree incident no longer has a second agent in it');
  // Both incidents are real and public; neither may carry a person, a machine, or a path.
  assert.doesNotMatch(skill, /(?:\/Users\/|\/home\/|C:\\Users\\)/);
});

test('the trigger points and the counter-triggers are both explicit', () => {
  const when = section(skill, 'When to Use');
  for (const trigger of [/another repositor/i, /clone/i, /worktree/i]) {
    assert.match(when, trigger, `missing trigger: ${trigger}`);
  }
  assert.match(when, /Do not use it/);
  assert.match(when, /current repositor/i, 'work in the current repository is not excluded');
  assert.match(when, /read-only/i, 'read-only inspection is not excluded');
  assert.match(when, /without a worktree|no worktree/i, 'reading another repository is not allowed without ceremony');
});

test('the usage examples carry git commands an agent can run without inventing flags', () => {
  const examples = section(skill, 'Usage Examples');
  const fenced = [...examples.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]);
  assert.ok(fenced.length >= 4, `expected pasteable text blocks, found ${fenced.length}`);
  const commands = fenced.join('\n');
  for (const command of [
    /git -C \S+ remote get-url origin/,
    /git -C \S+ fetch \S+/,
    /git -C \S+ rev-list --left-right --count \S+/,
    /git -C \S+ worktree add -b \S+ \S+ \S+/,
    /git -C \S+ worktree remove \S+/,
  ]) {
    assert.match(commands, command, `the examples never show: ${command}`);
  }
});

test('pitfalls name a failure and its consequence', () => {
  const pitfalls = section(skill, 'Pitfalls');
  const bullets = [...pitfalls.matchAll(/^- \*\*[^*]+\*\*/gm)];
  assert.ok(bullets.length >= 6, `expected at least six named pitfalls, found ${bullets.length}`);
  for (const pattern of [/name/i, /stale/i, /shared/i, /clone/i]) {
    assert.match(pitfalls, pattern, `missing pitfall: ${pattern}`);
  }
});

test('verification is a checklist that covers every act of the procedure', () => {
  const verification = section(skill, 'Verification');
  const boxes = [...verification.matchAll(/^- \[ \] /gm)];
  assert.ok(boxes.length >= 8, `expected at least eight checklist items, found ${boxes.length}`);
  for (const pattern of [/origin/i, /ahead|behind/i, /worktree/i, /stash/i, /branch/i, /clean|remov|remains/i]) {
    assert.match(verification, pattern, `missing checklist item: ${pattern}`);
  }
});

test('the skill promises no carried file it does not ship, and no repository branding', () => {
  assert.ok(skill, 'skills/work-in-external-repo/SKILL.md does not exist');
  const carried = /(?:^|[^A-Za-z0-9._/-])((?:references|scripts|assets)\/[A-Za-z0-9._/-]+)/g;
  for (const match of skill.matchAll(carried)) {
    const token = match[1].replace(/[.,;:)\]]+$/, '');
    assert.ok(existsSync(resolve(skillDirectory, token)), `names a carried file the skill does not carry: ${token}`);
  }
  assert.doesNotMatch(skill, /\bCUE\b|\bRGC\b/);
});
