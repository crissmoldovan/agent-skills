import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertCatalogueShape, fenced, procedureSteps, readSkill, section } from './helpers/skill-contract.mjs';
import { removeOnExit } from './helpers/temp-dir.mjs';

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
  /^3\. \*\*Read only the final review/,
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
  assert.match(bash, /\(cd "\$2" && codex exec review --base origin\/main -o "\$final"\) > "\$log" 2>&1 &$/m, 'the review does not run in the background, with its final message to a file');
  // The marker cut stays documented as a fallback, with its flaw stated.
  assert.match(record, /awk '\/\^codex\$\/\{buf=""\}/);
  assert.match(record, /a line that equals the marker inside quoted output — a file the review shows, a command's output — restarts the cut there/);
});

test('only the final review is read, and every claim is checked before it is acted on', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[2], /writes the final message, and only that, to the file `-o` names: read that file/);
  assert.match(steps[2], /a quoted line that equals the marker restarts the cut and silently drops the findings before it/);
  assert.match(steps[2], /the record says how it was taken — the `-o` file, or a marker cut with its marker count/);
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
  const dir = removeOnExit(mkdtempSync(join(tmpdir(), 'review-loop-')));
  const file = join(dir, 'run.sh');
  writeFileSync(file, `REVIEW_LOGS=${JSON.stringify(dir)}\n${exampleFunction('review_round')}\n${exampleFunction('merge_if_ready')}\n${script}\n`);
  const run = spawnSync('bash', [file], { encoding: 'utf8' });
  return { status: run.status, out: run.stdout + run.stderr };
}

// Blocks on #100: a line reading exactly "codex" inside quoted output restarted a marker cut and
// dropped the findings before it. The final review now comes from the file the reviewer writes.
test('a round counts only on a zero exit and a non-empty final review, taken from the -o file', () => {
  const stub = (body) => `codex() { local out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; ${body}; }`;
  const reviewer = {
    clean: `printf 'log\\ncodex\\n'; printf '[P3] A small thing\\n' > "$out"; return 0`,
    crashed: `printf 'codex\\npartial\\n' > "$out"; return 1`,
    'no output': `printf 'Error: not logged in\\nRun the login command and try again\\n'; return 0`,
    'empty review': `printf '   \\n' > "$out"; return 0`,
  };
  const results = {};
  for (const [name, body] of Object.entries(reviewer)) {
    const { status } = runBash(`${stub(body)}\nreview_round 1 .`);
    results[name] = status === 0 ? 'counted' : 'failed';
  }
  assert.deepEqual(results, { clean: 'counted', crashed: 'failed', 'no output': 'failed', 'empty review': 'failed' });

  // A review that quotes a line reading exactly "codex" keeps every finding before it.
  const quoted = runBash(`${stub(`printf 'log\\ncodex\\n'; printf '[P1] A real finding\\nquoted output:\\ncodex\\nend of quote\\n' > "$out"; return 0`)}
review_round 1 . && cat "$REVIEW_LOGS/round-1.final.txt"`);
  assert.equal(quoted.status, 0, quoted.out);
  assert.match(quoted.out, /\[P1\] A real finding/, 'a finding before an embedded marker was lost');

  // A final-review file left by an earlier round never stands in for this one.
  const stale = runBash(`printf '[P2] From an earlier round\\n' > "$REVIEW_LOGS/round-1.final.txt"
${stub(`printf 'log only\\n'; return 0`)}
review_round 1 .`);
  assert.notEqual(stale.status, 0, 'a stale final-review file counted as this round');

  const steps = procedureSteps(skill);
  assert.match(steps[1], /the reviewer exited zero, and its full output is in the round's log file — or the round is recorded as failed and run again/);
  assert.match(steps[2], /A final review that is missing or empty is a \*\*failed round\*\*, not a clean one/);
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
  assert.match(exampleBash, /^review_round "\$ROUND" "\$tree"/m);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /Each round reviewed a tree whose `git status --porcelain` was empty at that sha/);
});

// Blocks on #100 (severity 7): the -o path was taken relative to the reviewed tree, so a relative
// REVIEW_LOGS wrote the final review into the tree under review, and an unset one into /. The recipe
// now refuses anything but an absolute directory outside the tree; proven on a real detached worktree.
test('the final review and the log stay outside the reviewed tree, a detached worktree included', () => {
  const base = removeOnExit(mkdtempSync(join(tmpdir(), 'review-tree-')));
  const repo = join(base, 'repo');
  const tree = join(base, 'repo-wt');
  const logs = join(base, 'logs');
  const stub = `codex() { local out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done; printf '[P3] A small thing\\n' > "$out"; return 0; }`;
  const setup = [
    `git init -q ${JSON.stringify(repo)}`,
    `printf 'x\\n' > ${JSON.stringify(join(repo, 'file.txt'))}`,
    `git -C ${JSON.stringify(repo)} add file.txt`,
    `git -C ${JSON.stringify(repo)} -c user.email=reviewer@example.com -c user.name=reviewer commit -qm base`,
    `git -C ${JSON.stringify(repo)} worktree add -q --detach ${JSON.stringify(tree)} HEAD`,
  ].join('\n');

  const relative = runBash(`${setup}\n${stub}\nREVIEW_LOGS=review-logs\nreview_round 1 ${JSON.stringify(tree)}`);
  assert.notEqual(relative.status, 0, 'a relative REVIEW_LOGS was accepted');
  assert.match(relative.out, /REVIEW_LOGS must be an absolute path/);

  const inside = runBash(`${stub}\nREVIEW_LOGS=${JSON.stringify(join(tree, 'logs'))}\nreview_round 1 ${JSON.stringify(tree)}`);
  assert.notEqual(inside.status, 0, 'a REVIEW_LOGS inside the reviewed tree was accepted');
  assert.match(inside.out, /REVIEW_LOGS is inside the reviewed tree/);

  const outside = runBash(`${stub}\nREVIEW_LOGS=${JSON.stringify(logs)}\nreview_round 1 ${JSON.stringify(tree)} && git -C ${JSON.stringify(tree)} status --porcelain && cat ${JSON.stringify(join(logs, 'round-1.final.txt'))}`);
  assert.equal(outside.status, 0, outside.out);
  assert.equal(outside.out.trim(), '[P3] A small thing', 'the worktree is not clean, or the final review is not in the log directory');

  const steps = procedureSteps(skill);
  assert.match(steps[1], /The log directory is an absolute path, checked to lie outside the reviewed tree/);
  assert.match(exampleBash, /: "\$\{REVIEW_LOGS:\?set REVIEW_LOGS to an absolute directory outside the repository\}"/);
});

// Codex round 1 on #100. The whole example block is run, end to end, against a real git origin and
// clone, a stub reviewer, and a stub gh that reports a merge instead of making one.
function runExample({ mode, dirty = false, breakFetch = false }) {
  const base = removeOnExit(mkdtempSync(join(tmpdir(), 'review-e2e-')));
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  const logs = join(base, 'logs');
  const tmp = join(base, 'tmp');
  mkdirSync(tmp);
  const git = (...args) => execFileSync('git', args, { cwd: work, stdio: 'pipe', encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', origin], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', origin, work], { stdio: 'pipe' });
  writeFileSync(join(work, 'file.txt'), 'x\n');
  git('add', 'file.txt');
  git('-c', 'user.email=reviewer@example.com', '-c', 'user.name=reviewer', 'commit', '-qm', 'base');
  git('push', '-q', '-u', 'origin', 'HEAD');
  const sha = git('rev-parse', 'HEAD');
  if (dirty) writeFileSync(join(work, 'untracked.txt'), 'not committed\n');
  if (breakFetch) git('remote', 'set-url', 'origin', join(base, 'no-such-origin.git'));
  const stubs = `codex() { local out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
  pwd -P > "$REVIEW_LOGS/codex-cwd"
  case "$CODEX_MODE" in clean) printf '[P3] A small thing\\n' > "$out";; p1) printf '[P1] A real defect\\n' > "$out";; crash) return 1;; esac; }
gh() { case "$1 $2" in "pr view") echo "$(cat "$REVIEW_LOGS/round-$ROUND.head") main MERGEABLE";; "pr checks") echo true;; "pr merge") echo "MERGED $*";; esac; }`;
  const script = join(base, 'run.sh');
  writeFileSync(script, `${stubs}\n${exampleBash}\n`);
  const run = spawnSync('bash', [script], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, REVIEW_LOGS: logs, PR: '7', ROUND: '1', TMPDIR: tmp, CODEX_MODE: mode } });
  const cwdFile = join(logs, 'codex-cwd');
  return { status: run.status, out: run.stdout + run.stderr, sha, tmp: realpathSync(tmp), reviewedIn: existsSync(cwdFile) ? readFileSync(cwdFile, 'utf8').trim() : null };
}

test('the example fails fast, and merges only after a terminal round on the reviewed head', () => {
  const clean = runExample({ mode: 'clean' });
  assert.equal(clean.status, 0, clean.out);
  assert.match(clean.out, new RegExp(`MERGED pr merge 7 --squash --match-head-commit ${clean.sha}`));

  const open = runExample({ mode: 'p1' });
  assert.notEqual(open.status, 0, 'a round with a P1 left merged');
  assert.doesNotMatch(open.out, /MERGED/);
  assert.match(open.out, /NOT TERMINAL/);

  const crash = runExample({ mode: 'crash' });
  assert.notEqual(crash.status, 0, 'a failed round merged');
  assert.doesNotMatch(crash.out, /MERGED/);
  assert.match(crash.out, /ROUND 1 FAILED/);

  const noFetch = runExample({ mode: 'clean', breakFetch: true });
  assert.notEqual(noFetch.status, 0, 'a failed fetch did not stop the recipe');
  assert.equal(noFetch.reviewedIn, null, 'the reviewer ran after the fetch failed');
  assert.doesNotMatch(noFetch.out, /MERGED/);

  assert.match(exampleBash, /^set -euo pipefail$/m);
  assert.match(exampleBash, /^terminal_round "\$ROUND"/m);
});

test('a dirty tree is reviewed in an allocated, absolute REVIEW_TREE outside the repository', () => {
  const dirty = runExample({ mode: 'clean', dirty: true });
  assert.equal(dirty.status, 0, dirty.out);
  assert.ok(dirty.reviewedIn && dirty.reviewedIn.startsWith(dirty.tmp) && dirty.reviewedIn.endsWith('/tree'),
    `the dirty tree was reviewed in ${dirty.reviewedIn}, not in a fresh tree under the allocated temporary directory`);
  assert.match(exampleBash, /^: "\$\{REVIEW_TREE:=\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/review-tree\.XXXXXX"\)\/tree\}"$/m);
  assert.match(exampleBash, /case "\$REVIEW_TREE" in \/\*\) ;; \*\) echo "REFUSE: REVIEW_TREE must be an absolute path"; exit 1;; esac/);
});

test('nothing above the lowest grade is deferred; an owner override blocks the stop and the merge', () => {
  assert.doesNotMatch(record, /deferral needs the owner's agreement/);
  assert.match(record, /\*\*Only a lowest-severity finding can be deferred\.\*\*/);
  assert.match(record, /until it is fixed, or re-scored and graded no higher by a later round's final review, it blocks the stop rule and the merge/);
  assert.match(procedureSteps(skill)[4], /Nothing above the lowest severity is deferred\. An owner who disputes a grade re-scores the finding explicitly, with the reason in the record/);
});

test('the review record uses the same absolute, outside-tree REVIEW_LOGS as the main recipe', () => {
  const raw = read('references/review-record.md');
  for (const block of fenced(raw, 'bash')) {
    assert.doesNotMatch(block, /(?:^|[\s>])round-\d\.(?:log|final\.txt)/m, `a review-record example writes a relative log path:\n${block}`);
  }
  assert.match(raw, /: "\$\{REVIEW_LOGS:\?set REVIEW_LOGS to an absolute directory outside the repository\}"/);
});

test('the specimen record meets its own contract: effect for every finding, verification and arming for every fix', () => {
  const specimen = fenced(section(skill, 'What it looks like'), 'text')[0];
  const findings = specimen.split(/\n(?=\[P\d\])/).filter((chunk) => /^\[P\d\]/.test(chunk));
  assert.ok(findings.length >= 3, 'the specimen has too few findings to show the contract');
  for (const finding of findings) {
    const title = finding.split('\n')[0];
    assert.match(finding, /\n {2}verified: /, `no verified line: ${title}`);
    assert.match(finding, /\n {2}effect: /, `no effect line: ${title}`);
    if (/\n {2}disposition: fixed/.test(finding)) assert.match(finding, /\n {2}armed: /, `a fix with no armed line: ${title}`);
  }
});

test('every temporary directory these tests create is registered for removal', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const made = source.match(/mkdtempSync\(/g).length - 1;  // less this test's own pattern
  const registered = source.match(/removeOnExit\(mkdtempSync\(/g).length - 1;
  assert.equal(registered, made, 'a mkdtempSync is not wrapped in removeOnExit');
});
