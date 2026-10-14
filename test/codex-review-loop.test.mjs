import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCatalogueShape, fenced, procedureSteps, readSkill, section } from './helpers/skill-contract.mjs';

const name = 'codex-review-loop';
const loaded = readSkill(name);
const { skill, read, fit } = loaded;
const flat = skill.replace(/\s+/g, ' ');
const record = read('references/review-record.md').replace(/\s+/g, ' ');
const arming = read('references/arming-a-fix.md').replace(/\s+/g, ' ');
const merge = read('references/merge-preconditions.md').replace(/\s+/g, ' ');

const PROCEDURE_ORDER = [
  /^1\. \*\*Pin the head under review/,
  /^2\. \*\*Start the reviewer in the background, writing to a file/,
  /^3\. \*\*Read only the last review block/,
  /^4\. \*\*Check every finding against the code or the data before acting on it/,
  /^5\. \*\*Fix every verified finding above the lowest severity/,
  /^6\. \*\*Arm every fix/,
  /^7\. \*\*Diff shared code against the base after every fix/,
  /^8\. \*\*Measure each finding's effect on any published result/,
  /^9\. \*\*Run the tests and the reproduce script on the fixed tree/,
  /^10\. \*\*Write the round's review record/,
  /^11\. \*\*Push, and review the new head/,
  /^12\. \*\*Stop when a round returns only lowest-severity findings/,
  /^13\. \*\*Split the pull request when rounds keep finding new kinds of bug/,
  /^14\. \*\*Merge only the head that was reviewed and checked/,
];

test('codex-review-loop carries the catalogue shape', () => {
  assertCatalogueShape(name, loaded);
  assert.equal(fit.kind, 'general');
});

test('the procedure runs its fourteen acts in order', () => {
  const steps = procedureSteps(skill);
  assert.equal(steps.length, PROCEDURE_ORDER.length, `expected ${PROCEDURE_ORDER.length} steps, found ${steps.length}`);
  PROCEDURE_ORDER.forEach((pattern, index) => assert.match(steps[index], pattern, `step ${index + 1} is not the expected act`));
});

test('it is reviewer-agnostic, with codex review --base origin/main as the main example', () => {
  assert.match(flat, /It is reviewer-agnostic/);
  assert.match(flat, /`codex review --base origin\/main`/);
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /^codex review --base origin\/main > \S+ 2>&1 &$/m, 'the review does not run in the background to a file');
  assert.match(bash, /^awk '\/\^codex\$\/\{buf=""\}/m, 'the examples do not keep only the last block');
});

test('only the last block is read, and every claim is checked before it is acted on', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[2], /Extracting from the first block instead of the last presents earlier rounds' findings as this round's/);
  assert.match(steps[2], /how many earlier blocks were discarded/);
  assert.match(steps[3], /A reviewer's claim about the codebase can be wrong/);
  assert.match(steps[3], /rejected, with the evidence that refutes it/);
  assert.match(record, /Keep raw logs outside the repository/);
});

test('every fix above the lowest severity is armed, restored from a byte copy, and its effect measured', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[4], /At the lowest severity, fix the cheap ones and record the rest/);
  assert.match(steps[5], /break the fix on purpose, run the check and watch it fail/);
  assert.match(steps[5], /Never restore with `git checkout --` or `git restore`/);
  assert.match(steps[5], /restore checked with `cmp`/);
  assert.match(steps[7], /Write "no effect" only when that comparison shows no change, and name the command that showed it/);
  assert.match(steps[9], /The earlier record is never edited/);
  assert.match(arming, /Failing for the right reason/);
  assert.match(arming, /Arming the other side/);
  assert.match(record, /"None" is a result of that diff, not a judgement about the fix/);
});

test('the loop has a stop rule and a split rule', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[11], /the last round's findings are all at the lowest severity, each fixed or recorded/);
  assert.match(steps[12], /each find a class of defect no earlier round found/);
  assert.match(steps[12], /propose a split/);
});

test('merging is pinned to the reviewed head, with its required checks run on that commit', () => {
  const mergeStep = procedureSteps(skill)[13];
  assert.match(mergeStep, /every required check completed and passed on that exact commit/);
  assert.match(mergeStep, /No checks is not a pass/);
  assert.match(mergeStep, /`--match-head-commit`/);
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /^gh pr checks <pr> --required$/m);
  assert.match(bash, /^gh pr merge <pr> --squash --match-head-commit /m);
  assert.match(merge, /\*\*no pull-request run is dispatched at all\*\*/);
  assert.match(merge, /commits\/<sha>\/check-runs/);
  assert.match(merge, /Retarget it to the real base first/);
});

test('the Blocks-hosted loop stays with request-blocks-review', () => {
  assert.match(skill, /^\| The review loop with Blocks as the reviewer \| `request-blocks-review` \|/m);
  assert.match(section(skill, 'When to Use'), /Do not use it for the\s+Blocks-hosted loop/);
});
