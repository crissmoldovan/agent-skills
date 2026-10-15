import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  const functions = ['review_round', 'terminal_round', 'recorded_round', 'merge_if_ready'].map(exampleFunction).join('\n');
  writeFileSync(file, `REVIEW_LOGS=${JSON.stringify(dir)}\n${functions}\n${script}\n`);
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
  // The base branch's live tip comes from the remote; this stub plays the remote.
  const gh = (state, checks, checksStatus = 0, tip = 'b4se') => `gh() { case "$1 $2" in
    "pr view") echo "${state}";;
    "pr checks") echo "${checks}"; return ${checksStatus};;
    "pr merge") echo "MERGED $*";;
  esac; }
git() { [ "$1 $2 $3" = "ls-remote origin refs/heads/main" ] && printf '%s\\trefs/heads/main\\n' '${tip}'; }`;
  const attempt = (stubs, base = 'b4se') => runBash(`${stubs}\nmerge_if_ready 7 abc main ${base}`);
  const ready = attempt(gh('abc main MERGEABLE', 'true'));
  assert.equal(ready.status, 0, ready.out);
  assert.match(ready.out, /MERGED pr merge 7 --squash --match-head-commit abc/);
  for (const [why, stubs, base] of [
    ['the head moved', gh('def main MERGEABLE', 'true')],
    ['the base differs', gh('abc develop MERGEABLE', 'true')],
    ['it is not mergeable', gh('abc main CONFLICTING', 'true')],
    ['a required check did not pass', gh('abc main MERGEABLE', 'false')],
    ['no required checks are declared', gh('abc main MERGEABLE', 'no required checks reported', 1)],
    // Codex round 4 on #100: the gate read the base's name, never the sha the review diffed against.
    ['the base branch moved after the review', gh('abc main MERGEABLE', 'true', 0, 'm0ved')],
    ['no base was recorded', gh('abc main MERGEABLE', 'true', 0, ''), "''"],
  ]) {
    const run = attempt(stubs, base);
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
// clone, a stub reviewer, and a stub gh that reports a merge instead of making one. Codex round 4 on
// #100 split it into STEP=review and STEP=merge, with the findings' dispositions written between.
const FINDING = '[P3] A small thing — file.txt:1-1';
const REVIEWS = {
  p3: ['The change is mostly sound.', '', 'Full review comments:', '', `- ${FINDING}`, '  A detail.'],
  p3x2: ['Two small things.', '', 'Full review comments:', '', `- ${FINDING}`, '  A detail.', '- [P3] Another small thing — file.txt:1-1', '  Another detail.'],
  p1: ['A defect.', '', 'Full review comments:', '', '- [P1] A real defect — file.txt:1-1', '  It breaks.'],
  p4: ['Out of scale.', '', 'Full review comments:', '', `- ${FINDING}`, '- [P4] A grade outside the scale — file.txt:1-1'],
  prose: ['The change is correct and the tests cover it.'],
  garbled: ['Error: stream disconnected before completion'],
};
function exampleRepo({ ignored = false, dirty = false, hook = false, breakFetch = false, logsInCheckout = false } = {}) {
  const base = removeOnExit(mkdtempSync(join(tmpdir(), 'review-e2e-')));
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  const logs = logsInCheckout ? join(work, 'review-logs') : join(base, 'logs');
  const tmp = join(base, 'tmp');
  mkdirSync(tmp);
  const git = (...args) => execFileSync('git', ['-c', 'user.email=reviewer@example.com', '-c', 'user.name=reviewer', ...args], { cwd: work, stdio: 'pipe', encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', origin], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', origin, work], { stdio: 'pipe' });
  writeFileSync(join(work, 'file.txt'), 'x\n');
  writeFileSync(join(work, '.gitignore'), 'generated.env\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('push', '-q', 'origin', 'HEAD:refs/heads/main');
  git('checkout', '-q', '-b', 'feature');
  writeFileSync(join(work, 'file.txt'), 'y\n');
  git('commit', '-qam', 'change');
  git('push', '-q', '-u', 'origin', 'feature');
  const sha = git('rev-parse', 'HEAD');
  const baseSha = git('rev-parse', 'origin/main');
  if (ignored) writeFileSync(join(work, 'generated.env'), 'TOKEN=generated\n');
  if (dirty) writeFileSync(join(work, 'untracked.txt'), 'not committed\n');
  if (hook) writeFileSync(join(work, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf "TOKEN=generated\\n" > generated.env\n', { mode: 0o755 });
  if (breakFetch) git('remote', 'set-url', 'origin', join(base, 'no-such-origin.git'));
  const reviews = Object.entries(REVIEWS).map(([mode, lines]) => `${mode}) printf '%s\\n' ${lines.map((line) => `'${line}'`).join(' ')} > "$out";;`).join('\n    ');
  const stubs = `codex() { local out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
  pwd -P > "$REVIEW_LOGS/codex-cwd"; ls -a > "$REVIEW_LOGS/codex-ls"
  case "$CODEX_MODE" in
    ${reviews}
    crash) printf 'partial\\n' > "$out"; return 1;;
  esac; }
gh() { case "$1 $2" in "pr view") echo "$(git ls-remote origin refs/heads/feature | cut -f1) main MERGEABLE";; "pr checks") echo true;; "pr merge") echo "MERGED $*";; esac; }`;
  const script = join(base, 'run.sh');
  writeFileSync(script, `${stubs}\n${exampleBash}\n`);
  const cwdFile = join(logs, 'codex-cwd');
  return {
    sha, baseSha, git, work, logs, tmp: realpathSync(tmp),
    step(STEP, mode = 'p3', ROUND = '1') {
      rmSync(cwdFile, { force: true });
      const run = spawnSync('bash', [script], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, REVIEW_LOGS: logs, PR: '7', ROUND, TMPDIR: tmp, CODEX_MODE: mode, STEP } });
      return {
        status: run.status, out: run.stdout + run.stderr,
        reviewedIn: existsSync(cwdFile) ? readFileSync(cwdFile, 'utf8').trim() : null,
        reviewerSaw: existsSync(join(logs, 'codex-ls')) ? readFileSync(join(logs, 'codex-ls'), 'utf8') : '',
      };
    },
    record(lines) { mkdirSync(logs, { recursive: true }); writeFileSync(join(logs, 'round-1.dispositions'), `${lines.join('\n')}\n`); },
    left: () => ({ temp: readdirSync(tmp), worktrees: git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length }),
  };
}

test('the example fails fast, and merges only a terminal round whose findings are recorded', () => {
  const repo = exampleRepo();
  const review = repo.step('review');
  assert.equal(review.status, 0, review.out);
  assert.doesNotMatch(review.out, /MERGED/, 'the review step merged');
  assert.match(review.out, /Round 1 is terminal: record a disposition for each finding/);
  repo.record([`${FINDING} => deferred: cosmetic, tracked in #1`]);
  const merged = repo.step('merge');
  assert.equal(merged.status, 0, merged.out);
  assert.match(merged.out, new RegExp(`MERGED pr merge 7 --squash --match-head-commit ${repo.sha}`));
  assert.deepEqual(repo.left(), { temp: [], worktrees: 1 }, 'the merge step allocated a temporary directory or a worktree');

  for (const [mode, refusal] of [
    ['p1', /NOT TERMINAL/],
    // Blocks on #100 (severity 8): a grade outside the declared scale was read as terminal and merged.
    ['p4', /NOT TERMINAL: round 1 grades findings other than the lowest, P3: \[P4\]/],
    ['crash', /ROUND 1 FAILED/],
  ]) {
    const open = exampleRepo();
    const round = open.step('review', mode);
    assert.notEqual(round.status, 0, `a ${mode} round passed its review step`);
    assert.match(round.out, refusal);
    // Even with every finding recorded, and a reader's "clean", the merge step re-reads the round.
    open.record([`${FINDING} => deferred: cosmetic, tracked in #1`, '- [P1] A real defect — file.txt:1-1 => deferred: no', 'clean: the reviewer said so']);
    const merge = open.step('merge', mode);
    assert.notEqual(merge.status, 0, `a ${mode} round merged`);
    assert.doesNotMatch(merge.out, /MERGED/);
    assert.match(merge.out, /NOT TERMINAL/, `the merge step did not re-read the ${mode} round`);
  }

  const noFetch = exampleRepo({ breakFetch: true }).step('review');
  assert.notEqual(noFetch.status, 0, 'a failed fetch did not stop the recipe');
  assert.equal(noFetch.reviewedIn, null, 'the reviewer ran after the fetch failed');

  assert.match(exampleBash, /^set -euo pipefail$/m);
  assert.match(exampleBash, /^ {4}terminal_round "\$ROUND" {10}# so does a round with P0-P2 findings left$/m);
});

// Codex round 4 on #100 [P1]: a P3-only round merged in the same run that reviewed it, before
// anyone read, verified or recorded its findings.
test('a lowest-grade round never merges until every one of its findings has a disposition', () => {
  const repo = exampleRepo();
  const second = '[P3] Another small thing — file.txt:1-1';
  assert.equal(repo.step('review', 'p3x2').status, 0);
  assert.match(repo.step('merge', 'p3x2').out, /NOT RECORDED: round 1 has no dispositions file/);
  const ok = `${second} => rejected: handled in the caller, file.txt:1`;
  for (const [why, lines, missing] of [
    ['one finding has no line', [`${FINDING} => deferred: cosmetic, tracked in #1`], second],
    ['a finding is marked fixed in the stop round', [`${FINDING} => deferred: cosmetic, tracked in #1`, `${second} => fixed in abc123`], second],
    ['a line names the finding loosely', ['[P3] A small thing => rejected: it is fine', ok], FINDING],
    // Codex round 5 on #100 [P2]: a prefix match let a deferral with no tracker, or a rejection with
    // no evidence, through. Each form is checked whole, from the start of its line.
    ['a deferral names no tracker', [`${FINDING} => deferred: cosmetic`, ok], FINDING],
    ['a deferral gives no reason', [`${FINDING} => deferred: , tracked in #1`, ok], FINDING],
    ['a rejection carries no evidence', [`${FINDING} => rejected: `, ok], FINDING],
    ['the finding is not where its line starts', [`see ${FINDING} => deferred: cosmetic, tracked in #1`, ok], FINDING],
  ]) {
    repo.record(lines);
    const run = repo.step('merge', 'p3x2');
    assert.notEqual(run.status, 0, `it merged when ${why}`);
    assert.doesNotMatch(run.out, /MERGED/, `gh pr merge ran when ${why}`);
    assert.ok(run.out.includes(`NOT RECORDED: round 1 has no complete disposition for: ${missing}`), `it did not name the unrecorded finding when ${why}:\n${run.out}`);
  }
  repo.record([`${FINDING} => deferred: cosmetic, tracked in #1`, `${second} => rejected: handled in the caller, file.txt:1`]);
  const merged = repo.step('merge', 'p3x2');
  assert.equal(merged.status, 0, merged.out);
  assert.match(merged.out, /MERGED/);
  assert.match(procedureSteps(skill)[11], /The merge step reads those records: one line per finding in the round's dispositions file, and it refuses while any finding has none/);
  assert.match(read('references/review-record.md'), /^## The dispositions file$/m);
});

// Codex round 5 on #100 [P1]: a reused round number repinned the round to a new head before a setup
// failure, so the merge step read the earlier review and its dispositions against a head nobody reviewed.
test('a round number is never reused, and nothing is pinned until the review succeeded', () => {
  const repo = exampleRepo();
  assert.equal(repo.step('review').status, 0);
  repo.record([`${FINDING} => deferred: cosmetic, tracked in #1`]);
  const before = ['head', 'final.txt', 'dispositions'].map((file) => readFileSync(join(repo.logs, `round-1.${file}`), 'utf8'));
  writeFileSync(join(repo.work, 'file.txt'), 'z, never reviewed\n');
  repo.git('commit', '-qam', 'after the review');
  repo.git('push', '-q');
  const unreviewed = repo.git('rev-parse', 'HEAD');
  writeFileSync(join(repo.work, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf "TOKEN=generated\\n" > generated.env\n', { mode: 0o755 });
  const again = repo.step('review');
  assert.notEqual(again.status, 0, 'a round number ran twice');
  assert.match(again.out, /REFUSE: round 1 has run before; review as a new round/);
  assert.deepEqual(['head', 'final.txt', 'dispositions'].map((file) => readFileSync(join(repo.logs, `round-1.${file}`), 'utf8')), before, 'a refused rerun changed the round it refused');
  const merge = repo.step('merge');
  assert.doesNotMatch(merge.out, /MERGED/, `the earlier round's review merged ${unreviewed}, a head it never saw`);
  assert.match(merge.out, /REFUSE: head, base or mergeability differs/);

  // A new round whose setup fails before the review pins nothing, so no merge step can rest on it.
  const failed = repo.step('review', 'p3', '2');
  assert.match(failed.out, /REFUSE: the review tree is not exactly/);
  assert.deepEqual(readdirSync(repo.logs).filter((file) => file.startsWith('round-2.')), [], 'a round that never reviewed left a pin or a file');
  assert.match(procedureSteps(skill)[1], /no round number reused, so nothing from an earlier round stands in for this one/);
});

// Codex round 5 on #100 [P2]: the review runs in a temporary worktree, so a REVIEW_LOGS inside the
// caller's own checkout passed the containment test and the logs landed in the repository.
test('the log directory may not lie in the checkout the recipe runs from', () => {
  const repo = exampleRepo({ logsInCheckout: true });
  const run = repo.step('review');
  assert.notEqual(run.status, 0, 'a REVIEW_LOGS inside the checkout was accepted');
  assert.match(run.out, /ROUND 1 REFUSED: REVIEW_LOGS is inside the reviewed tree or this checkout/);
  assert.equal(run.reviewedIn, null, 'the reviewer ran with its logs inside the checkout');
  assert.equal(repo.git('status', '--porcelain', '--untracked-files=all'), '', 'the refused round wrote into the checkout');
  assert.match(procedureSteps(skill)[1], /The log directory is an absolute path, checked to lie outside the reviewed tree and the checkout/);
});

// Codex round 4 on #100 [P1]: a non-empty review with no grade in it passed as a clean round. A clean
// Codex review is prose with no grade, so only a reader can tell it from an error message.
test('a review that grades nothing is a failed round unless a reader recorded it clean', () => {
  const garbled = exampleRepo();
  assert.equal(garbled.step('review', 'garbled').status, 0);
  const unread = garbled.step('merge', 'garbled');
  assert.match(unread.out, /NOT RECORDED/);
  garbled.record(['# nothing to record']);
  const failed = garbled.step('merge', 'garbled');
  assert.notEqual(failed.status, 0, 'a review that grades nothing merged with no reader calling it clean');
  assert.doesNotMatch(failed.out, /MERGED/);
  assert.match(failed.out, /ROUND 1 FAILED: its final review grades no finding, and no reader recorded it clean/);

  const prose = exampleRepo();
  assert.equal(prose.step('review', 'prose').status, 0);
  prose.record(['clean: "The change is correct and the tests cover it."']);
  const merged = prose.step('merge', 'prose');
  assert.equal(merged.status, 0, merged.out);
  assert.match(merged.out, /MERGED/);
  assert.match(procedureSteps(skill)[2], /a clean Codex review is plain prose, with no grade and no fixed wording, so a person reads it and records it clean, or the round failed/);
});

// Codex round 4 on #100 [P1]: the gate checked the base's name, so a base that advanced after the
// review still merged. It now compares the branch's live tip with the base the round recorded.
test('the merge refuses a base that moved after the review', () => {
  const repo = exampleRepo();
  assert.equal(repo.step('review').status, 0);
  repo.record([`${FINDING} => deferred: cosmetic, tracked in #1`]);
  const moved = repo.git('commit-tree', 'origin/main^{tree}', '-p', 'origin/main', '-m', 'the base moves on');
  repo.git('push', '-q', 'origin', `${moved}:refs/heads/main`);
  const run = repo.step('merge');
  assert.notEqual(run.status, 0, 'a base that moved after the review merged');
  assert.doesNotMatch(run.out, /MERGED/);
  assert.ok(run.out.includes(`REFUSE: main is at ${moved}, not ${repo.baseSha}, the base the review diffed against`), run.out);
  assert.match(read('references/merge-preconditions.md'), /^## 3\. The base has not moved since the review$/m);
  assert.match(merge, /`baseRefOid` is the base as of the head's last push, not the branch's tip/);
});

// Codex round 4 on #100 [P2] x2: a checkout holding only ignored files was reviewed in place, and
// every round left a temporary directory, and a dirty one a registered worktree, behind.
test('every round reviews a fresh worktree at the pushed sha, and leaves nothing behind', () => {
  for (const [why, options, mode] of [
    ['a clean checkout', {}, 'p3'],
    ['a checkout holding only ignored files', { ignored: true }, 'p3'],
    ['a dirty checkout', { dirty: true }, 'p3'],
    ['a round that is not terminal', {}, 'p1'],
    ['a round that failed', {}, 'crash'],
  ]) {
    const repo = exampleRepo(options);
    const run = repo.step('review', mode);
    assert.ok(run.reviewedIn && run.reviewedIn.startsWith(repo.tmp) && run.reviewedIn.endsWith('/tree'),
      `${why} was reviewed in ${run.reviewedIn}, not a fresh worktree`);
    assert.doesNotMatch(run.reviewerSaw, /generated\.env|untracked\.txt/, `the reviewer read a file that is not the commit, in ${why}`);
    assert.deepEqual(repo.left(), { temp: [], worktrees: 1 }, `${why} left a temporary directory or a worktree behind`);
  }
  // A worktree that holds more than the commit — here a hook writes into it — is refused, not reviewed.
  const hooked = exampleRepo({ hook: true });
  const refused = hooked.step('review');
  assert.notEqual(refused.status, 0, 'a review tree holding a file that is not the commit was reviewed');
  assert.equal(refused.reviewedIn, null);
  assert.match(refused.out, /REFUSE: the review tree is not exactly/);
  assert.deepEqual(hooked.left(), { temp: [], worktrees: 1 }, 'a refused round left a temporary directory or a worktree behind');

  assert.match(procedureSteps(skill)[0], /every round runs in a fresh worktree checked out at the recorded sha \(`git worktree add --detach <path> <sha>`\), never in the checkout\. `git status --porcelain` does not list ignored files/);
  assert.doesNotMatch(exampleBash, /tree=\.|REVIEW_TREE/);
  assert.match(exampleBash, /git worktree add --detach "\$tree" "\$sha"/);
  assert.match(exampleBash, /^ {4}review_round "\$ROUND" "\$tree"/m);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /Each round reviewed a fresh worktree at that sha whose `git status --porcelain --ignored` was empty — never the checkout — and the worktree and its directory were removed after/);
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
