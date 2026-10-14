import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  /^1\. \*\*Pin the head under review, and review exactly its bytes/,
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
  /^12\. \*\*Stop when a round returns only lowest-severity findings, and leave a reviewed head to merge/,
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
  assert.match(bash, /\(cd "\$2" && codex review --base origin\/main\) > "\$log" 2>&1 &$/m, 'the review does not run in the background to a file');
  assert.match(bash, /^\s*awk '\/\^codex\$\/\{buf=""\}/m, 'the examples do not keep only the last block');
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
  assert.match(steps[12], /each find a class of defect no earlier round found/);
  assert.match(steps[12], /propose a split/);
});

// Review round 1: fixing the stop round's lowest-severity findings made a head nobody reviewed. The
// head that merges must itself have been reviewed, so the stop rule and the merge rule must agree.
test('the stop rule leaves a reviewed head to merge, and the merge rule names that head', () => {
  const steps = procedureSteps(skill);
  const stop = steps[11];
  assert.match(stop, /any commit made now is unreviewed/);
  assert.match(stop, /\*\*Defer and merge\.\*\* Record every finding as deferred, with where it is tracked, and merge the head that round reviewed/);
  assert.match(stop, /\*\*Fix, then confirm once\.\*\*[^*]*run one confirmation round on the new head/);
  assert.match(stop, /anything it reports at the lowest severity is deferred, not fixed/);
  assert.match(stop, /If it returns anything above the lowest severity, the loop resumes at step 4/);
  assert.match(stop, /the head that will merge is the head of a round that returned only lowest-severity findings — the stop round's, or its one confirmation round's — with no commit after it/);
  assert.doesNotMatch(stop, /The loop is done; the pull request is reviewed at that head and no later one/);
  assert.match(steps[4], /In the round that stops the loop, step 12 decides instead/);
  assert.match(steps[13], /confirm that the pull request's head is the head the last round reviewed — under step 12, the stop round's head or its confirmation round's, with no commit after it;/);
  assert.match(record, /that head merges only after one confirmation round has reviewed it/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /fixed and then reviewed by exactly one confirmation round, whose own lowest-severity findings were deferred/);
});

// Review round 1, the same class as a file naming its own commit: a record committed with the fixes
// it names cannot carry their sha, and one committed after the last round is an unreviewed head.
test('records never name their own commit and never follow the last review', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[9], /never with them — a file cannot name the commit that adds it/);
  assert.match(steps[9], /The last round's record always goes on the pull request: a commit after the last review is a head nobody reviewed/);
  assert.doesNotMatch(steps[9], /the record is committed with the fixes/);
  assert.match(record, /commits each one \*\*after\*\* the fixes it describes, never together with them/);
  assert.doesNotMatch(record, /One record per round, committed with that round's fixes/);
  assert.doesNotMatch(read('references/review-record.md'), /round <n\+1> on <sha>/);
});

test('merging is pinned to the reviewed head, with its required checks run on that commit', () => {
  const mergeStep = procedureSteps(skill)[13];
  assert.match(mergeStep, /every required check completed and passed on that exact commit/);
  assert.match(mergeStep, /No checks is not a pass/);
  assert.match(mergeStep, /`--match-head-commit`/);
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /gh pr checks "\$1" --required --json bucket --jq 'length > 0 and all\(\.\[\]; \.bucket == "pass"\)'/);
  assert.match(bash, /^\s*gh pr merge "\$1" --squash --match-head-commit "\$2"$/m);
  assert.match(merge, /\*\*no pull-request run is dispatched at all\*\*/);
  assert.match(merge, /commits\/<sha>\/check-runs/);
  assert.match(merge, /Retarget it to the real base first/);
});

test('the Blocks-hosted loop stays with request-blocks-review', () => {
  assert.match(skill, /^\| The review loop with Blocks as the reviewer \| `request-blocks-review` \|/m);
  assert.match(section(skill, 'When to Use'), /Do not use it for the\s+Blocks-hosted loop/);
});

// Review round 2. The example's two recipes are run, not read: review_round and merge_if_ready are
// taken from the skill's own Usage Examples and driven with a stub reviewer and a stub gh, so the
// guard is on what they do. A stub gh never merges; it reports that it would have.
const exampleBash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
function exampleFunction(name) {
  const start = exampleBash.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `the Usage Examples no longer define ${name}`);
  return exampleBash.slice(start, exampleBash.indexOf('\n}\n', start) + 3);
}
function runBash(script) {
  const dir = mkdtempSync(join(tmpdir(), 'review-loop-'));
  const file = join(dir, 'run.sh');
  writeFileSync(file, `REVIEW_LOGS=${JSON.stringify(dir)}\n${exampleFunction('review_round')}\n${exampleFunction('merge_if_ready')}\n${script}\n`);
  const run = spawnSync('bash', [file], { encoding: 'utf8' });
  return { status: run.status, out: run.stdout + run.stderr };
}

test('a round counts only on a zero exit and a non-empty final block', () => {
  const reviewer = {
    clean: `printf 'thinking\\ncodex\\nold draft\\ncodex\\n[P3] A small thing\\n'; return 0`,
    crashed: `printf 'codex\\npartial\\n'; return 1`,
    'no marker': `printf 'Error: not logged in\\nRun the login command and try again\\n'; return 0`,
    'empty block': `printf 'working\\ncodex\\n   \\n'; return 0`,
  };
  const results = {};
  for (const [name, body] of Object.entries(reviewer)) {
    const { status } = runBash(`codex() { ${body}; }\nreview_round 1 .`);
    results[name] = status === 0 ? 'counted' : 'failed';
  }
  assert.deepEqual(results, { clean: 'counted', crashed: 'failed', 'no marker': 'failed', 'empty block': 'failed' });
  const steps = procedureSteps(skill);
  assert.match(steps[1], /the reviewer exited zero, and its full output is in the round's log file — or the round is recorded as failed and run again/);
  assert.match(steps[2], /is a \*\*failed round\*\*, not a clean one/);
  assert.match(record, /## A failed round is not a clean round/);
});

test('the merge recipe is a gate: gh pr merge runs only when every predicate holds', () => {
  const gh = (state, checks, checksStatus = 0) => `gh() { case "$1 $2" in
    "pr view") echo "${state}";;
    "pr checks") echo "${checks}"; return ${checksStatus};;
    "pr merge") echo "MERGED $*";;
  esac; }`;
  const attempt = (stubs) => runBash(`${stubs}\nmerge_if_ready 7 abc main`);
  const ready = attempt(gh('abc main MERGEABLE', 'true'));
  assert.equal(ready.status, 0, ready.out);
  assert.match(ready.out, /MERGED pr merge 7 --squash --match-head-commit abc/);
  for (const [why, stubs] of [
    ['the head moved', gh('def main MERGEABLE', 'true')],
    ['the base differs', gh('abc develop MERGEABLE', 'true')],
    ['it is not mergeable', gh('abc main CONFLICTING', 'true')],
    ['a required check did not pass', gh('abc main MERGEABLE', 'false')],
    ['no required checks are declared', gh('abc main MERGEABLE', 'no required checks reported', 1)],
  ]) {
    const run = attempt(stubs);
    assert.notEqual(run.status, 0, `the gate let a merge through when ${why}`);
    assert.doesNotMatch(run.out, /MERGED/, `gh pr merge ran when ${why}`);
    assert.match(run.out, /REFUSE/, `the gate did not say why it refused when ${why}`);
  }
  assert.match(procedureSteps(skill)[13], /Run these as a \*\*gate\*\*, not a report: each predicate is tested, and the merge command runs only if every one holds/);
  assert.match(merge, /\*\*exits 0\*\*, with `"bucket": "fail"`/);
});

test("the threshold comes from the reviewer's declared scale: Codex grades P0 to P3", () => {
  const prerequisite = section(skill, 'Prerequisites').replace(/\s+/g, ' ');
  assert.match(prerequisite, /The Codex CLI grades P0 to P3, so with it P0, P1 and P2 are fixed and a round with only P3 findings stops the loop/);
  assert.match(prerequisite, /Take the scale from the reviewer itself/);
  assert.doesNotMatch(skill, /P0 to P2 scale|only P2s/);
  assert.match(section(skill, 'Usage Examples').replace(/\s+/g, ' '), /Fix every P0, P1 and P2 with a check you have watched fail.*only P3s/);
  assert.match(section(skill, 'What it looks like'), /^\[P3\] A log line misspells an arm label$/m);
});

test('each round reviews a clean tree at the pushed sha, or a fresh worktree checked out there', () => {
  const first = procedureSteps(skill)[0];
  assert.match(first, /`git status --porcelain` is empty and `HEAD` is the pushed head; otherwise the round runs in a fresh worktree checked out at the recorded sha/);
  assert.match(exampleBash, /\[ -z "\$\(git status --porcelain\)" \] && \[ "\$sha" = "\$\(git rev-parse '@\{upstream\}'\)" \]/);
  assert.match(exampleBash, /git worktree add --detach "\$tree" "\$sha"/);
  assert.match(exampleBash, /review_round 3 "\$tree"/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /Each round reviewed a tree whose `git status --porcelain` was empty at that sha/);
});
