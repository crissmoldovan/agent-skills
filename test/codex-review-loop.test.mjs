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
  assert.match(steps[13], /The pull request's head is the sha the final round reviewed \(`round-<n>\.head`\) — under step 12, the stop round's or its one confirmation round's — with no commit after it/);
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
  assert.match(mergeStep, /Every required check completed and passed on that exact commit/);
  assert.match(mergeStep, /No checks is not a pass/);
  assert.match(mergeStep, /`gh pr merge <n> --merge --match-head-commit <reviewed sha>`/);
  assert.match(merge, /gh pr checks <pr> --required --json bucket --jq 'length > 0 and all\(\.\[\]; \.bucket == "pass"\)'/);
  assert.match(merge, /\*\*exits 0\*\*, with `"bucket": "fail"`/);
  assert.match(merge, /\*\*no pull-request run is dispatched at all\*\*/);
  assert.match(merge, /commits\/<sha>\/check-runs/);
  assert.match(merge, /Retarget it to the real base first/);
});

test('the Blocks-hosted loop stays with request-blocks-review', () => {
  assert.match(skill, /^\| The review loop with Blocks as the reviewer \| `request-blocks-review` \|/m);
  assert.match(section(skill, 'When to Use'), /Do not use it for the\s+Blocks-hosted loop/);
});

// Review round 2. The example's functions are run, not read: review_round and terminal_round are
// taken from the skill's own Usage Examples and driven with a stub reviewer, so the guard is on what
// they do.
const exampleBash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
function exampleFunction(name) {
  const start = exampleBash.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `the Usage Examples no longer define ${name}`);
  return exampleBash.slice(start, exampleBash.indexOf('\n}\n', start) + 3);
}
function runBash(script) {
  const dir = removeOnExit(mkdtempSync(join(tmpdir(), 'review-loop-')));
  const file = join(dir, 'run.sh');
  const functions = ['review_round', 'terminal_round'].map(exampleFunction).join('\n');
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
// clone and a stub reviewer. After round 6 it is review only: the merge is a person's checklist, so a
// stub gh records any call at all, and the review step must make none.
const FINDING = '[P3] A small thing — file.txt:1-1';
const REVIEWS = {
  p3: ['The change is mostly sound.', '', 'Full review comments:', '', `- ${FINDING}`, '  A detail.'],
  p1: ['A defect.', '', 'Full review comments:', '', '- [P1] A real defect — file.txt:1-1', '  It breaks.'],
  p4: ['Out of scale.', '', 'Full review comments:', '', `- ${FINDING}`, '- [P4] A grade outside the scale — file.txt:1-1'],
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
  const ghCalls = join(base, 'gh-calls');
  const stubs = `codex() { local out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
  pwd -P > "$REVIEW_LOGS/codex-cwd"; ls -a > "$REVIEW_LOGS/codex-ls"
  case "$CODEX_MODE" in
    ${reviews}
    crash) printf 'partial\\n' > "$out"; return 1;;
  esac; }
gh() { echo "gh $*" >> ${JSON.stringify(ghCalls)}; }`;
  const script = join(base, 'run.sh');
  writeFileSync(script, `${stubs}\n${exampleBash}\n`);
  const cwdFile = join(logs, 'codex-cwd');
  return {
    sha, baseSha, git, work, logs, tmp: realpathSync(tmp),
    review(mode = 'p3', ROUND = '1') {
      rmSync(cwdFile, { force: true });
      const run = spawnSync('bash', [script], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, REVIEW_LOGS: logs, ROUND, TMPDIR: tmp, CODEX_MODE: mode } });
      return {
        status: run.status, out: run.stdout + run.stderr,
        reviewedIn: existsSync(cwdFile) ? readFileSync(cwdFile, 'utf8').trim() : null,
        reviewerSaw: existsSync(join(logs, 'codex-ls')) ? readFileSync(join(logs, 'codex-ls'), 'utf8') : '',
        ghCalls: existsSync(ghCalls) ? readFileSync(ghCalls, 'utf8') : '',
      };
    },
    record(lines) { mkdirSync(logs, { recursive: true }); writeFileSync(join(logs, 'round-1.dispositions'), `${lines.join('\n')}\n`); },
    left: () => ({ temp: readdirSync(tmp), worktrees: git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length }),
  };
}

test('the example fails fast, and its review step never merges', () => {
  const repo = exampleRepo();
  const review = repo.review('p3');
  assert.equal(review.status, 0, review.out);
  assert.equal(review.ghCalls, '', `the review step called gh:\n${review.ghCalls}`);
  assert.match(review.out, /Round 1 is terminal\. Record a complete disposition per finding in round-1\.dispositions/);
  assert.match(review.out, /Then work through step 14's checklist\./);
  assert.equal(readFileSync(join(repo.logs, 'round-1.head'), 'utf8').trim(), repo.sha, 'the round did not pin the head it reviewed');
  assert.deepEqual(repo.left(), { temp: [], worktrees: 1 });

  for (const [mode, refusal] of [
    ['p1', /NOT TERMINAL/],
    // Blocks on #100 (severity 8): a grade outside the declared scale was read as terminal.
    ['p4', /NOT TERMINAL: round 1 grades findings other than the lowest, P3: \[P4\]/],
    ['crash', /ROUND 1 FAILED/],
  ]) {
    const round = exampleRepo().review(mode);
    assert.notEqual(round.status, 0, `a ${mode} round passed its review step`);
    assert.match(round.out, refusal);
    assert.equal(round.ghCalls, '', `a ${mode} round called gh`);
  }

  const noFetch = exampleRepo({ breakFetch: true }).review('p3');
  assert.notEqual(noFetch.status, 0, 'a failed fetch did not stop the recipe');
  assert.equal(noFetch.reviewedIn, null, 'the reviewer ran after the fetch failed');

  assert.match(exampleBash, /^set -euo pipefail$/m);
  assert.match(exampleBash, /^terminal_round "\$ROUND" {10}# so does a round with P0-P2 findings left$/m);
});

// Codex rounds 4, 5 and 6 on #100 each found a new P1 in a scripted merge gate. The owner cut it: the
// merge is a checklist a person runs, ending in a merge pinned to the reviewed head. Round 6's P1, a
// head re-reviewed until a run came back clean, is closed by line 2.
test("the merge is a person's checklist: every line is there, and no runnable merge ships", () => {
  const checklist = procedureSteps(skill)[13];
  assert.match(checklist, /^14\. \*\*Merge only the head that was reviewed and checked, by hand, after a checklist\.\*\* Merging is a person's act, and this skill ships no merge script/);
  for (const [line, pattern] of [
    [1, /1\. The pull request's head is the sha the final round reviewed \(`round-<n>\.head`\) — under step 12, the stop round's or its one confirmation round's — with no commit after it\./],
    [2, /2\. No earlier round that did not end the loop reviewed that same head, unless every finding it graded above the lowest was rejected with evidence\./],
    [3, /3\. Every finding of the final round has a complete disposition in `round-<n>\.dispositions`; a review that graded none was recorded `clean:` by the person who read it, or the round failed\./],
    [4, /4\. The base branch's live tip \(`git ls-remote origin refs\/heads\/<base>`\) is the base the round recorded \(`round-<n>\.base`\)\. If it moved, review again/],
    [5, /5\. It targets the branch it should, not a base that merged and is gone, and it is mergeable\./],
    [6, /6\. Every required check completed and passed on that exact commit: a zero exit, a non-empty list, every one passed\. No checks is not a pass/],
    ['the merge', /Then merge with the head pinned, so that a push in between fails the merge instead of merging unreviewed code: `gh pr merge <n> --merge --match-head-commit <reviewed sha>`\./],
  ]) assert.match(checklist, pattern, `the checklist lost line ${line}`);
  assert.match(procedureSteps(skill)[11], /The records go in the round's dispositions file, one complete line per finding, which the merge checklist reads/);

  // Nothing the skill ships can merge on its own: no merge in the recipe, no gate function anywhere.
  assert.doesNotMatch(exampleBash, /\bgh\b|--match-head-commit|merge_if_ready|recorded_round|\bSTEP\b/, 'the example block can merge again');
  for (const file of ['SKILL.md', ...loaded.references.map((reference) => `references/${reference}`)]) {
    for (const block of fenced(file === 'SKILL.md' ? skill : read(file), 'bash')) {
      assert.doesNotMatch(block, /merge_if_ready|recorded_round|\(\)\s*\{[^}]*gh pr merge/, `${file} ships runnable merge code again`);
      assert.doesNotMatch(block, /gh pr merge "\$/, `${file} ships a parameterised merge again`);
    }
  }
  // The reference explains each line, in the checklist's order.
  const headings = read('references/merge-preconditions.md').match(/^## \d\. .*$/gm);
  assert.deepEqual(headings, [
    "## 1. The pull request's head is the reviewed head",
    '## 2. No earlier round that did not end the loop reviewed that head',
    '## 3. Every finding of the final round has a complete disposition',
    '## 4. The base has not moved since the review',
    '## 5. It lands on the branch it should, and it is mergeable',
    '## 6. Every required check ran and passed on that exact commit',
  ]);
  assert.match(merge, /gh pr merge <pr> --merge --match-head-commit <reviewed sha>/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /The merge ran by hand after every line of step 14's checklist held/);
  assert.match(flat, /\*\*A scripted merge gate\.\*\* Three rounds running found a new way for one to merge what nobody reviewed/);
  assert.match(flat, /fix a head graded above the lowest; do not review it again until a run grades it lower/);
});

// Codex round 5 on #100 [P1]: a reused round number repinned the round to a new head before a setup
// failure, leaving the earlier review and its dispositions to be read against a head nobody reviewed.
test('a round number is never reused, and nothing is pinned until the review succeeded', () => {
  const repo = exampleRepo();
  assert.equal(repo.review().status, 0);
  repo.record([`${FINDING} => deferred: cosmetic, tracked in #1`]);
  const before = ['head', 'base', 'final.txt', 'dispositions'].map((file) => readFileSync(join(repo.logs, `round-1.${file}`), 'utf8'));
  writeFileSync(join(repo.work, 'file.txt'), 'z, never reviewed\n');
  repo.git('commit', '-qam', 'after the review');
  repo.git('push', '-q');
  writeFileSync(join(repo.work, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf "TOKEN=generated\\n" > generated.env\n', { mode: 0o755 });
  const again = repo.review();
  assert.notEqual(again.status, 0, 'a round number ran twice');
  assert.match(again.out, /REFUSE: round 1 has run before; review as a new round/);
  assert.deepEqual(['head', 'base', 'final.txt', 'dispositions'].map((file) => readFileSync(join(repo.logs, `round-1.${file}`), 'utf8')), before, 'a refused rerun changed the round it refused');

  // A new round whose setup fails before the review pins nothing, so no checklist can rest on it.
  const failed = repo.review('p3', '2');
  assert.match(failed.out, /REFUSE: the review tree is not exactly/);
  assert.deepEqual(readdirSync(repo.logs).filter((file) => file.startsWith('round-2.')), [], 'a round that never reviewed left a pin or a file');
  assert.match(procedureSteps(skill)[1], /no round number reused, so nothing from an earlier round stands in for this one/);
});

// Codex round 5 on #100 [P2]: the review runs in a temporary worktree, so a REVIEW_LOGS inside the
// caller's own checkout passed the containment test and the logs landed in the repository.
test('the log directory may not lie in the checkout the recipe runs from', () => {
  const repo = exampleRepo({ logsInCheckout: true });
  const run = repo.review();
  assert.notEqual(run.status, 0, 'a REVIEW_LOGS inside the checkout was accepted');
  assert.match(run.out, /ROUND 1 REFUSED: REVIEW_LOGS is inside the reviewed tree or this checkout/);
  assert.equal(run.reviewedIn, null, 'the reviewer ran with its logs inside the checkout');
  assert.equal(repo.git('status', '--porcelain', '--untracked-files=all'), '', 'the refused round wrote into the checkout');
  assert.match(procedureSteps(skill)[1], /The log directory is an absolute path, checked to lie outside the reviewed tree and the checkout/);
});

// Codex round 4 on #100 [P1]: a non-empty review with no grade in it passed as a clean round. A clean
// Codex review is prose with no grade, so only a reader can tell it from an error message.
test('a review that grades nothing is a failed round unless a reader records it clean', () => {
  const garbled = exampleRepo().review('garbled');
  assert.equal(garbled.status, 0, garbled.out);
  assert.match(garbled.out, /a review\s+that grades none failed, unless you read it and record it clean:/);
  assert.match(procedureSteps(skill)[2], /a clean Codex review is plain prose, with no grade and no fixed wording, so a person reads it and records it clean, or the round failed/);
  assert.match(record, /so such a round counts as failed unless the file says so in a line of its own, `clean: <the reviewer's verdict, quoted>`/);
});

// Codex round 4 on #100 [P1]: a base that advanced after the review still merged. The round records
// the base it diffed against, and checklist line 4 compares it with the branch's live tip.
test('the round records the base it diffed against, for the checklist to compare with the live tip', () => {
  const repo = exampleRepo();
  assert.equal(repo.review().status, 0);
  assert.equal(readFileSync(join(repo.logs, 'round-1.base'), 'utf8').trim(), repo.baseSha);
  assert.match(merge, /git ls-remote origin refs\/heads\/<base> \| cut -f1 # must equal the base sha the round recorded/);
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
    const run = repo.review(mode);
    assert.ok(run.reviewedIn && run.reviewedIn.startsWith(repo.tmp) && run.reviewedIn.endsWith('/tree'),
      `${why} was reviewed in ${run.reviewedIn}, not a fresh worktree`);
    assert.doesNotMatch(run.reviewerSaw, /generated\.env|untracked\.txt/, `the reviewer read a file that is not the commit, in ${why}`);
    assert.deepEqual(repo.left(), { temp: [], worktrees: 1 }, `${why} left a temporary directory or a worktree behind`);
  }
  // A worktree that holds more than the commit — here a hook writes into it — is refused, not reviewed.
  const hooked = exampleRepo({ hook: true });
  const refused = hooked.review();
  assert.notEqual(refused.status, 0, 'a review tree holding a file that is not the commit was reviewed');
  assert.equal(refused.reviewedIn, null);
  assert.match(refused.out, /REFUSE: the review tree is not exactly/);
  assert.deepEqual(hooked.left(), { temp: [], worktrees: 1 }, 'a refused round left a temporary directory or a worktree behind');

  assert.match(procedureSteps(skill)[0], /every round runs in a fresh worktree checked out at the recorded sha \(`git worktree add --detach <path> <sha>`\), never in the checkout\. `git status --porcelain` does not list ignored files/);
  assert.doesNotMatch(exampleBash, /tree=\.|REVIEW_TREE/);
  assert.match(exampleBash, /git worktree add --detach "\$tree" "\$sha"/);
  assert.match(exampleBash, /^review_round "\$ROUND" "\$tree"/m);
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
