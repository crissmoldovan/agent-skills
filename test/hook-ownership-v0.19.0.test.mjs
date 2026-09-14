import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import * as ownership from '../adapters/claude-code/hook-ownership.mjs';
import { HOOK_IDENTITY as PROGRESS_IDENTITY, buildHookEntries, installHooks, removeHooks } from '../adapters/claude-code/install-report-progress-gate.mjs';
import { HOOK_IDENTITY as RELEASE_IDENTITY, buildHookEntry, installHook, removeHook } from '../adapters/claude-code/install-release-notes-gate.mjs';
import { GATE_DIR_ENV, markerFile } from '../adapters/claude-code/report-progress-gate.mjs';

const { classifyHook } = ownership;

// ---------------------------------------------------------------------------
// The release bar, row by row, against 0.19.0's real installers.
//
// 0.19.0 recognised a gate installer's hooks by `describe`: it took every hook wearing its own describe, whatever the command,
// and its report-progress installer's --adopt took every hook with no describe whose command contained the gate file's name
// anywhere, option values included. This branch reads the command, because Claude Code drops `describe` whenever it rewrites a
// settings file. The user's guarantee: everything 0.19.0 could do is still possible, at worst by adding --adopt. Every row below
// is held to the four points of the release bar, IN PRECEDENCE ORDER — where two conflict, the higher one wins:
//   1. a run with no flag never takes a hook the reader cannot fully read, with or without the installer's own describe;
//   2. never taken, with any flag (beats point 3), for exactly one of four reasons, which `neverTakenReason` returns: a MENTION, the
//      gate file named only as an argument of a program the reader knows does not run it (echo, cat, grep, rm, unlink, cp, ls,
//      shellcheck, xxd, du, od and the like), only in what flows only into such programs, or only in a shell comment, and nowhere
//      else in the command; a WRITE TARGET, a command that writes to the gate file through a redirection, in `sh -c`, `eval`, a
//      here-document or a substitution too; a DIFFERENT FILE, where every path with the gate file's name in it ends in another
//      name — a lookalike, or the gate file's name only as a directory; a hook under ANOTHER TOOL'S describe;
//   3. everything else 0.19.0 took or removed with exit 0, the branch takes or removes with the same flags or with --adopt added;
//   4. --remove is honest: it exits 1 while a hook that runs the gate, or may, is left behind, and it never says no gate was
//      installed while any hook in the file names the gate file — it names each hook it left, with why.
// Every row lands in exactly one count: the same as 0.19.0; better; (1) not taken with no flag, taken once --adopt is added; (2)
// never taken, where 0.19.0 took it; (4) --remove exits 1 over a hook both versions leave; or an install that refuses to put a gate
// beside a hook that runs the gate, or may, where 0.19.0 installed its gate beside it. A row that breaks a point, or where 0.19.0
// did better outside those counts, fails, and every such row is listed before the test fails.
//
// WHAT "TOOK" MEANS. Each row names its SUBJECTS: the hooks of that row's gate in its start file. A version took on a row when it
// exited 0 and at least one subject is no longer in the file, byte for byte. An install that exits 0 did not necessarily replace
// them: 0.19.0's release-notes installer read only PreToolUse, and installed its gate beside a gate hook under any other event,
// which is why rows put release-notes hooks under PostToolUse, Stop and SessionStart. A subject can also be taken and written back
// byte for byte: where every subject is exactly an entry this branch's installer writes for that row — a file this branch wrote, or
// the release-notes hook 0.19.0 wrote with the same describe, re-run with it present — an install that exits 0 took them. Each row
// works out whether it is one from the branch's own `buildHookEntries` and `buildHookEntry`.
//
// 0.19.0'S RELEASE-NOTES INSTALLER HAS NO --adopt: it exits 1 with "unknown argument: --adopt". Held to that, every branch
// result on those rows would count as better. So those rows are compared with 0.19.0's nearest equivalent run instead — its
// bare install for `--adopt install`, its bare `--remove` for `--remove --adopt` — and the first test checks that 0.19.0
// refuses the argument on every one of them.
//
// WHETHER A HOOK RUNS THE GATE IS FIRED, NOT WRITTEN DOWN. Each distinct subject command is run through /bin/sh, with the
// ambient gate variables cleared, against a stand-in gate: a file with the gate's basename and the real gate's permission bits,
// in a temp directory that takes the place of the gate's own directory, which writes a marker only when it is handed the hook's
// payload on stdin — run the way a hook runs the gate. What fired is recorded. sudo is never run here: its forms carry a label
// from runs documented in this branch's reviews (as root with a user x under Debian 12's dash, sudo 1.9.13p3), or say that none
// was documented. A form that needs a program this machine lacks is not fired, and says which. The reader's reading of each
// subject is stated here and checked against the reader: a hook it reads as running the gate must fire, unless its row says why
// it cannot; a hook it reads as not running the gate must not, unless its row says it runs a copy of the gate, which the bar
// counts as a mention; a hook it cannot fully read may do either, and what it did is reported.
//
// Rows:
//   - who wrote the file: 0.19.0's installer or this branch's, under a Node binary called `wrote`; by hand (HAND_WRITTEN), every
//     form from the held reviews and ship reports among them; or a file holding one hook (SINGLE);
//   - describe present, or stripped the way a settings rewrite strips it;
//   - which installer re-runs it, under a Node binary called `reran`;
//   - the four re-runs: a bare install, `--adopt`, `--remove`, `--remove --adopt`.
//
// 0.19.0 comes from git (`git show <commit>:<file>` for the four files its installers load, into a temp directory: nothing
// is added to the repository's worktree list and nothing is left to clean up). A shallow clone does not have that commit,
// so what 0.19.0 does is also kept as a table recorded from real runs, fixtures/hook-ownership-v0.19.0.json. The first test
// re-derives the table from 0.19.0 wherever the commit is present and fails if the two disagree; the second holds the
// branch to it everywhere.
// Re-record: AGENT_SKILLS_RECORD_V019_TABLE=1 node --test test/hook-ownership-v0.19.0.test.mjs
//
// Every binary is the running Node under another name (a hard link, so `process.execPath` carries that name), and every
// installer run has HOME and --settings in a temp directory. Every block-mode gate the branch writes is run from its written
// command against the real gate, and must fire.
// ---------------------------------------------------------------------------

const REPO = fileURLToPath(new URL('..', import.meta.url));
const V019 = Object.freeze({ tag: 'v0.19.0', commit: '8a40f2a4e7a59ca1f0a49cf052f856d6f37b0353' });
const TABLE_URL = new URL('./fixtures/hook-ownership-v0.19.0.json', import.meta.url);
const RECORDING = process.env.AGENT_SKILLS_RECORD_V019_TABLE === '1';
const LIMIT = Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2)));
/** A fired start command still running after this long is killed, and fails the test. */
const FIRE_TIMEOUT_MS = 30_000;

const KINDS = Object.freeze({
  progress: Object.freeze({
    installer: 'install-report-progress-gate.mjs',
    gate: 'report-progress-gate.mjs',
    flag: 'AGENT_SKILLS_PROGRESS_GATE',
    describePrefix: 'agent-skills report-progress gate',
    event: 'Stop',
    matcher: '*',
    // The hooks a written gate has at each level: coverage 2 is Stop, UserPromptSubmit, SessionStart and SubagentStart; coverage 1
    // is Stop, UserPromptSubmit and PostToolUse Agent, which is also what a new install gets, in observe.
    hooksAt: Object.freeze({ 1: 3, 2: 4 }),
    nothingInstalled: /No report-progress gate was installed/,
  }),
  release: Object.freeze({
    installer: 'install-release-notes-gate.mjs',
    gate: 'release-notes-gate.sh',
    flag: 'AGENT_SKILLS_RELEASE_NOTES_GATE',
    describePrefix: 'agent-skills release-notes gate',
    event: 'PreToolUse',
    matcher: 'Bash',
    hooksAt: Object.freeze({ 1: 1, 2: 1 }),
    nothingInstalled: /No release-notes gate was installed/,
  }),
});
const OTHER = Object.freeze({ progress: 'release', release: 'progress' });

const BRANCH_ADAPTER = path.join(REPO, 'adapters', 'claude-code');
const branchGate = (kind) => path.join(BRANCH_ADAPTER, KINDS[kind].gate);
/** Where a SINGLE hook names the gate. No installer runs a hook; the firing check puts a stand-in in its place. */
const packGate = (kind) => `/pack/adapters/claude-code/${KINDS[kind].gate}`;

/** How both installers quote a word into a command. */
const q = (value) => `'${String(value).split("'").join(`'\\''`)}'`;
const both = (value) => Object.freeze({ progress: value, release: value });
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hooksWord = (count) => `${count} hook${count === 1 ? '' : 's'}`;
const ownDescribe = (kind) => `${KINDS[kind].describePrefix} (block): recorded before a settings rewrite.`;

/** Installed by a binary called `wrote`, re-run by one called `reran`. `recognised`: whether the progress installer reads the
 *  hooks as its own exact shape (the release installer writes `bash`); a name outside the Node-runtime pattern is a program the
 *  reader does not know runs the gate, so those hooks are unclear. */
const INPUTS = Object.freeze([
  { id: 'node -> node', wrote: 'node', reran: 'node', recognised: true },
  { id: 'node-20 -> node-22', wrote: 'node-20', reran: 'node-22', recognised: true },
  { id: 'node22 -> node', wrote: 'node22', reran: 'node', recognised: true },
  { id: 'bun -> node', wrote: 'bun', reran: 'node', recognised: true },
  { id: 'node -> bun', wrote: 'node', reran: 'bun', recognised: true },
  { id: 'nodejs -> node', wrote: 'nodejs', reran: 'node', recognised: true },
  { id: 'node-lts -> node', wrote: 'node-lts', reran: 'node', recognised: false },
]);

const P = 'AGENT_SKILLS_PROGRESS_GATE=block AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2';
const R = 'AGENT_SKILLS_RELEASE_NOTES_GATE=block';
const exactShape = Object.freeze({
  progress: (node, gate) => `${P} ${q(node)} ${q(gate)}`,
  release: (gate) => `${R} bash ${q(gate)}`,
});
const wrappedIn = (wrapper) => ({
  progress: (node, gate) => `${P} ${wrapper} ${q(node)} ${q(gate)}`,
  release: (gate) => `${R} ${wrapper} bash ${q(gate)}`,
});
const releaseRunBy = (interpreter) => ({ progress: exactShape.progress, release: (gate) => `${R} ${interpreter} ${q(gate)}` });
const followedBy = (tail) => ({
  progress: (node, gate) => `${exactShape.progress(node, gate)}${tail}`,
  release: (gate) => `${exactShape.release(gate)}${tail}`,
});
/** A form for one gate: the other gate sits in the same file in its exact shape, and only this gate's rows are run. */
const progressForm = (id, progress, { reader = 'unclear', ...rest } = {}) => ({ id, only: 'progress', progress, release: exactShape.release, reader: { progress: reader, release: 'own' }, ...rest });
const releaseForm = (id, release, { reader = 'unclear', ...rest } = {}) => ({ id, only: 'release', progress: exactShape.progress, release, reader: { progress: 'own', release: reader }, ...rest });
/** Where a form puts the gate file's own directory, for a command that works it out: `"$(dirname '<dir>/x')/<gate>"`. */
const dirnameOf = (gate) => `"$(dirname ${q(path.join(path.dirname(gate), 'x'))})/${path.basename(gate)}"`;
/** A glob that matches the gate file in its own directory, the directory quoted: `'<dir>/'*<gate>`. */
const globOf = (gate) => `${q(`${path.dirname(gate)}/`)}*${path.basename(gate)}`;

/** The mode, and level, a branch install keeps from a hook it takes: `block`; `off` for a command that sets no mode; `unreadable`
 *  for one that sets it where the installer cannot read it, which writes the default, observe, and says so. */
const OFF = Object.freeze({ progress: { mode: 'off', coverage: 1 }, release: { mode: 'off' } });
const UNREADABLE = Object.freeze({ progress: { mode: 'unreadable', coverage: 1 }, release: { mode: 'unreadable' } });
const BLOCK_AT_1 = Object.freeze({ progress: { mode: 'block', coverage: 1 } });
const writtenMode = ({ mode }) => (mode === 'unreadable' ? 'observe' : mode);
const MODE_LINE = Object.freeze({
  block: /^Kept mode block \((already installed in this file|read from the adopted hook)\)\. Pass --mode observe to change it\.$/m,
  off: /^Kept mode off \((already installed in this file|read from the adopted hook)\): the gate is disarmed/m,
  unreadable: /^Mode observe, the default — the mode the gate already in this file ran in could not be read from its command\./m,
});

/** Labels for forms this test never fires, from runs documented in this branch's reviews. */
const SUDO_RAN = Object.freeze({ fires: true, why: "sudo is never run here; as root with a user x under Debian 12's dash, sudo 1.9.13p3, this form ran the command (a run documented in this branch's review)" });
const SUDO_RAN_NOTHING = Object.freeze({ fires: false, why: "sudo is never run here; as root with a user x under Debian 12's dash, sudo 1.9.13p3, this form ran nothing (a run documented in this branch's review)" });
const SUDO_UNDOCUMENTED = Object.freeze({ fires: null, why: 'sudo is never run here, and no run of this form is documented' });

/** Why a hook the reader reads as running the gate does not fire. */
const HERE_STRING = "a here-string takes the place of the hook's payload on stdin, so the gate never reads the payload (and dash refuses a here-string)";
/** Why a hook the reader reads as not running the gate fires: it runs a copy, which the bar counts as a mention. */
const COPY = "it copies the gate and runs the copy with the hook's payload; the reader does not follow copies, and the bar counts the gate path as an argument of cp as a mention";

const ANOTHER_DESCRIBE = 'another-tool: checks every tool call against its own policy.';
const ANOTHER_TOOL = "another tool's describe";
/** Point 2's four cases. */
const POINT_TWO = Object.freeze(['mention', 'write target', 'different file', ANOTHER_TOOL]);
/** Each of point 2's cases, as the closed set in hook-ownership.mjs names it. */
const REASON_OF = Object.freeze({ mention: 'mention', 'write target': 'writeTarget', 'different file': 'differentFile', [ANOTHER_TOOL]: 'foreignDescribe' });

/**
 * Hand-written files: both gates at block and coverage 2, beside hooks nobody here wrote, each command built from the `node`
 * binary and this branch's gate paths.
 *   reader      for each gate, what its command is to the branch's reader: `own`, the installer's exact shape with the
 *               interpreter it writes; `hand-wiring`, a command that runs the gate in any other shape; `unclear`, a command
 *               where the reader cannot tell whether the gate runs. Checked against the reader on every row.
 *   only        the one gate whose rows are run, where the form is written for that gate alone.
 *   where       for the release-notes gate, the event and matcher its hook sits under, where not PreToolUse matcher Bash.
 *   describe    what "describe present" puts on the gate hooks, when it is not the installer's own: point 2's fourth case.
 *   keeps       for each gate, the mode (and level) a branch install keeps from the command when it takes the hooks.
 *   needs       for each gate, a program the firing check needs on PATH; where it is missing that command is not fired.
 *   documented  for each gate, the label of a form never fired here (sudo), and where it comes from.
 *   silent      for each gate, why a command the reader reads as running the gate does not fire.
 */
const HAND_WRITTEN = Object.freeze([
  { id: 'live shape', ...exactShape, reader: both('own') },
  { id: 'timeout 5', ...wrappedIn('timeout 5'), reader: both('hand-wiring'), needs: both('timeout') },
  { id: 'nice -n 10', ...wrappedIn('nice -n 10'), reader: both('hand-wiring'), needs: both('nice') },
  { id: 'env FOO=1', ...wrappedIn('env FOO=1'), reader: both('hand-wiring') },
  { id: 'sudo -u x timeout 5', ...wrappedIn('sudo -u x timeout 5'), reader: both('hand-wiring'), documented: both(SUDO_RAN) },
  { id: "release gate run by '/bin/bash'", ...releaseRunBy(q('/bin/bash')), reader: { progress: 'own', release: 'hand-wiring' } },
  { id: 'release gate run by sh', ...releaseRunBy('sh'), reader: { progress: 'own', release: 'hand-wiring' } },
  { id: '<shape> && echo done', ...followedBy(' && echo done'), reader: both('hand-wiring') },
  { id: '<shape>; true', ...followedBy('; true'), reader: both('hand-wiring') },

  // The installer's exact shape run by a program the reader does not know runs the gate: unclear. (One that only reads or deletes
  // files is a mention: SINGLE.)
  { id: 'release gate run by bash5', ...releaseRunBy('bash5'), reader: { progress: 'own', release: 'unclear' }, needs: { release: 'bash5' } },
  {
    id: "'/usr/bin/env' '<gate>'",
    progress: (node, gate) => `${P} ${q('/usr/bin/env')} ${q(gate)}`,
    release: (gate) => `${R} ${q('/usr/bin/env')} ${q(gate)}`,
    reader: both('unclear'),
  },
  {
    id: "env '<gate>'",
    progress: (node, gate) => `${P} env ${q(gate)}`,
    release: (gate) => `${R} env ${q(gate)}`,
    reader: both('unclear'),
  },
  {
    id: "nohup '<gate>'",
    progress: (node, gate) => `${P} nohup ${q(gate)}`,
    release: (gate) => `${R} nohup ${q(gate)}`,
    reader: both('unclear'),
  },
  {
    id: "'/usr/local/bin/hook-wrapper' '<gate>'",
    progress: (node, gate) => `${P} ${q('/usr/local/bin/hook-wrapper')} ${q(gate)}`,
    release: (gate) => `${R} ${q('/usr/local/bin/hook-wrapper')} ${q(gate)}`,
    reader: both('unclear'),
    needs: both('/usr/local/bin/hook-wrapper'),
  },
  // The gate path as an option's value, which 0.19.0's substring match took.
  {
    id: 'hook-wrapper --gate=<gate>',
    progress: (node, gate) => `${P} /usr/local/bin/hook-wrapper --gate=${q(gate)}`,
    release: (gate) => `${R} /usr/local/bin/hook-wrapper --gate=${q(gate)}`,
    reader: both('unclear'),
    needs: both('/usr/local/bin/hook-wrapper'),
  },

  // Another tool's describe on a hook that runs the gate, or may: point 2, never taken, as 0.19.0 never took one.
  { id: "the exact shape under another tool's describe", ...exactShape, reader: both('own'), describe: ANOTHER_DESCRIBE },
  { id: "timeout 5 under another tool's describe", ...wrappedIn('timeout 5'), reader: both('hand-wiring'), needs: both('timeout'), describe: ANOTHER_DESCRIBE },
  { id: "nice -10 under another tool's describe", ...wrappedIn('nice -10'), reader: both('unclear'), needs: both('nice'), describe: ANOTHER_DESCRIBE },

  // Release-notes hooks under events 0.19.0's release-notes installer never read.
  releaseForm('release exact shape under PostToolUse', exactShape.release, { reader: 'own', where: { release: { event: 'PostToolUse', matcher: 'Bash' } } }),
  releaseForm('release timeout 5 under Stop', wrappedIn('timeout 5').release, { reader: 'hand-wiring', needs: { release: 'timeout' }, where: { release: { event: 'Stop', matcher: '*' } } }),
  releaseForm('release sudo -i under PostToolUse', wrappedIn('sudo -i').release, { documented: { release: SUDO_RAN }, where: { release: { event: 'PostToolUse', matcher: 'Bash' } } }),
  releaseForm('release nice -10 under SessionStart', wrappedIn('nice -10').release, { needs: { release: 'nice' }, where: { release: { event: 'SessionStart', matcher: 'resume' } } }),
  releaseForm("release timeout 5 under another tool's describe, under PostToolUse", wrappedIn('timeout 5').release, { reader: 'hand-wiring', needs: { release: 'timeout' }, describe: ANOTHER_DESCRIBE, where: { release: { event: 'PostToolUse', matcher: 'Bash' } } }),

  // The forms from the held release reviews. First, wrapper forms the reader does not recognise, which run the gate or not.
  { id: 'nice -10', ...wrappedIn('nice -10'), reader: both('unclear'), needs: both('nice') },
  { id: 'stdbuf -oL', ...wrappedIn('stdbuf -oL'), reader: both('unclear'), needs: both('stdbuf') },
  { id: 'timeout -p 5', ...wrappedIn('timeout -p 5'), reader: both('unclear'), needs: both('timeout') },
  { id: 'time', ...wrappedIn('time'), reader: both('unclear') },
  { id: 'sudo -i', ...wrappedIn('sudo -i'), reader: both('unclear'), documented: both(SUDO_RAN) },
  { id: 'timeout --no-such-option 5', ...wrappedIn('timeout --no-such-option 5'), reader: both('unclear'), needs: both('timeout') },
  { id: 'sudo -u x timeout --no-such-option 5', ...wrappedIn('sudo -u x timeout --no-such-option 5'), reader: both('unclear'), documented: both(SUDO_UNDOCUMENTED) },
  { id: 'timeout 5x', ...wrappedIn('timeout 5x'), reader: both('unclear'), needs: both('timeout') },
  { id: 'timeout 5>/dev/null', ...wrappedIn('timeout 5>/dev/null'), reader: both('unclear'), needs: both('timeout') },
  { id: 'nice -n 2147483648', ...wrappedIn('nice -n 2147483648'), reader: both('unclear'), needs: both('nice') },
  { id: 'env -C /tmp', ...wrappedIn('env -C /tmp'), reader: both('unclear') },
  { id: 'caffeinate -z', ...wrappedIn('caffeinate -z'), reader: both('unclear'), needs: both('caffeinate') },
  { id: 'exec -a name', ...wrappedIn('exec -a name'), reader: both('unclear') },
  { id: 'command -v', ...wrappedIn('command -v'), reader: both('unclear') },
  { id: 'command -V', ...wrappedIn('command -V'), reader: both('unclear') },
  { id: 'sudo -e', ...wrappedIn('sudo -e'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -n -u $U', ...wrappedIn('sudo -n -u $U'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -p $P', ...wrappedIn('sudo -p $P'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -u x*', ...wrappedIn('sudo -u x*'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo -g {a,b}', ...wrappedIn('sudo -g {a,b}'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  { id: 'sudo --user=$U', ...wrappedIn('sudo --user=$U'), reader: both('unclear'), documented: both(SUDO_RAN_NOTHING) },
  // The gate path as an option's value.
  {
    id: "timeout -s '<gate>' 5",
    progress: (node, gate) => `${P} timeout -s ${q(gate)} 5 ${q(node)} -e 0`,
    release: (gate) => `${R} timeout -s ${q(gate)} 5 bash -c true`,
    reader: both('unclear'),
    needs: both('timeout'),
  },
  {
    id: "time -o '<gate>'",
    progress: (node, gate) => `${P} time -o ${q(gate)} ${q(node)} -e 0`,
    release: (gate) => `${R} time -o ${q(gate)} bash -c true`,
    reader: both('unclear'),
  },
  // The gate as what an interpreter reads on stdin: a file, or a here-string.
  {
    id: "stdin: <interpreter> <'<gate>'",
    progress: (node, gate) => `${P} ${q(node)} <${q(gate)}`,
    release: (gate) => `${R} bash <${q(gate)}`,
    reader: both('unclear'),
  },
  {
    id: "timeout 5 <interpreter> <<< '<gate>'",
    progress: (node, gate) => `${P} timeout 5 ${q(node)} <<< ${q(gate)}`,
    release: (gate) => `${R} timeout 5 bash <<< ${q(gate)}`,
    reader: both('unclear'),
    needs: both('timeout'),
  },
  // Read as running the gate, and never handed the payload.
  {
    id: "<interpreter> '<gate>' <<< '{}'",
    progress: (node, gate) => `${P} ${q(node)} ${q(gate)} <<< '{}'`,
    release: (gate) => `${R} bash ${q(gate)} <<< '{}'`,
    reader: both('hand-wiring'),
    silent: both(HERE_STRING),
  },

  // The held ship report's gap forms, probe 1 and probe 2: no leading assignment of the gate's own variable, one this reader cannot
  // read, or the gate path only inside a word. 0.19.0 took each; --adopt takes each here.
  progressForm('gap: nice -10 node <gate>', (node, gate) => `nice -10 node ${q(gate)}`, { needs: { progress: 'nice' }, keeps: OFF }),
  progressForm('gap: timeout --no-such-option 5 node <gate>', (node, gate) => `timeout --no-such-option 5 node ${q(gate)}`, { needs: { progress: 'timeout' }, keeps: OFF }),
  progressForm('gap: time node <gate>', (node, gate) => `time node ${q(gate)}`, { keeps: OFF }),
  progressForm('gap: timeout -p 5 node <gate>', (node, gate) => `timeout -p 5 node ${q(gate)}`, { needs: { progress: 'timeout' }, keeps: OFF }),
  progressForm('gap: sudo -i node <gate>', (node, gate) => `sudo -i node ${q(gate)}`, { documented: { progress: SUDO_RAN }, keeps: OFF }),
  progressForm('gap: env VAR=block nice -10 node <gate>', (node, gate) => `env AGENT_SKILLS_PROGRESS_GATE=block nice -10 node ${q(gate)}`, { needs: { progress: 'nice' }, keeps: UNREADABLE }),
  progressForm('gap: cd /tmp && VAR=block nice -10 node <gate>', (node, gate) => `cd /tmp && AGENT_SKILLS_PROGRESS_GATE=block nice -10 node ${q(gate)}`, { needs: { progress: 'nice' }, keeps: UNREADABLE }),
  progressForm('gap: export VAR=block; nice -10 node <gate>', (node, gate) => `export AGENT_SKILLS_PROGRESS_GATE=block; nice -10 node ${q(gate)}`, { needs: { progress: 'nice' }, keeps: UNREADABLE }),
  progressForm('gap: VAR=${MODE:-block} nice -10 node <gate>', (node, gate) => `AGENT_SKILLS_PROGRESS_GATE=\${MODE:-block} nice -10 node ${q(gate)}`, { needs: { progress: 'nice' }, keeps: UNREADABLE }),
  progressForm('gap: sudo -u x VAR=block nice -10 node <gate>', (node, gate) => `sudo -u x AGENT_SKILLS_PROGRESS_GATE=block nice -10 node ${q(gate)}`, { documented: { progress: SUDO_UNDOCUMENTED }, keeps: UNREADABLE }),
  progressForm('gap: VAR=block node "$(dirname …)/<gate>"', (node, gate) => `AGENT_SKILLS_PROGRESS_GATE=block node ${dirnameOf(gate)}`, { reader: 'hand-wiring', keeps: BLOCK_AT_1 }),
  progressForm("gap: VAR=block sh -c 'nice -10 node <gate>; true'", (node, gate) => `AGENT_SKILLS_PROGRESS_GATE=block sh -c ${q(`nice -10 node ${q(gate)}; true`)}`, { needs: { progress: 'nice' }, keeps: BLOCK_AT_1 }),
  progressForm('gap: GATE=<gate> VAR=block sh -c \'nice -10 node "$GATE"\'', (node, gate) => `GATE=${q(gate)} AGENT_SKILLS_PROGRESS_GATE=block sh -c 'nice -10 node "$GATE"'`, { needs: { progress: 'nice' }, keeps: BLOCK_AT_1 }),
  progressForm('gap: GATE=<gate>; VAR=block node "$GATE"', (node, gate) => `GATE=${q(gate)}; AGENT_SKILLS_PROGRESS_GATE=block node "$GATE"`, { keeps: UNREADABLE }),
  progressForm('gap: gate() { VAR=block node <gate>; }; gate', (node, gate) => `gate() { AGENT_SKILLS_PROGRESS_GATE=block node ${q(gate)}; }; gate`, { keeps: UNREADABLE }),
  progressForm('gap: AGENT_SKILLS_PROGRESS_GATEX=block nice -10 node <gate>', (node, gate) => `AGENT_SKILLS_PROGRESS_GATEX=block nice -10 node ${q(gate)}`, { needs: { progress: 'nice' }, keeps: OFF }),
  progressForm('gap: VAR=block /usr/local/bin/hook-wrapper --gate=<gate>', (node, gate) => `AGENT_SKILLS_PROGRESS_GATE=block /usr/local/bin/hook-wrapper --gate=${q(gate)}`, { needs: { progress: '/usr/local/bin/hook-wrapper' }, keeps: BLOCK_AT_1 }),
  progressForm('gap: AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 nice -10 cat <gate>', (node, gate) => `AGENT_SKILLS_PROGRESS_GATE_COVERAGE=2 nice -10 cat ${q(gate)}`, { needs: { progress: 'nice' }, keeps: { progress: { mode: 'off', coverage: 2 } } }),
  releaseForm('gap: nice -10 bash <gate>', (gate) => `nice -10 bash ${q(gate)}`, { needs: { release: 'nice' }, keeps: OFF }),
  releaseForm('gap: timeout --no-such-option 5 bash <gate>', (gate) => `timeout --no-such-option 5 bash ${q(gate)}`, { needs: { release: 'timeout' }, keeps: OFF }),
  releaseForm('gap: time bash <gate>', (gate) => `time bash ${q(gate)}`, { keeps: OFF }),
  releaseForm('gap: sudo -i bash <gate>', (gate) => `sudo -i bash ${q(gate)}`, { documented: { release: SUDO_RAN }, keeps: OFF }),
  releaseForm('gap: env VAR=block nice -10 bash <gate>', (gate) => `env AGENT_SKILLS_RELEASE_NOTES_GATE=block nice -10 bash ${q(gate)}`, { needs: { release: 'nice' }, keeps: UNREADABLE }),
  releaseForm('gap: VAR=block bash "$(dirname …)/<gate>"', (gate) => `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash ${dirnameOf(gate)}`, { reader: 'hand-wiring' }),
  releaseForm('gap: gate() { bash <gate>; }; gate', (gate) => `gate() { bash ${q(gate)}; }; gate`, { keeps: OFF }),
  releaseForm('gap: VAR=block hook-wrapper --script=<gate>', (gate) => `AGENT_SKILLS_RELEASE_NOTES_GATE=block hook-wrapper --script=${q(gate)}`, { needs: { release: 'hook-wrapper' } }),
  releaseForm("gap: bash <<'EOF' … bash <gate> … EOF", (gate) => `bash <<'EOF'\nbash ${q(gate)}\nEOF`, { keeps: OFF }),
  // rg runs the file its --pre option names, so it is not a program the reader knows does not run the gate.
  releaseForm('rg --pre <gate>', (gate) => `AGENT_SKILLS_RELEASE_NOTES_GATE=block rg --pre ${q(gate)} x /etc/hosts`, { needs: { release: 'rg' } }),

  // The forms from this round's held review and ship reports. A comment after a command that runs the gate never downgrades the run.
  { id: '<shape> # note', ...followedBy(' # note'), reader: both('hand-wiring') },
  {
    id: '<shape> # <gate file>',
    progress: (node, gate) => `${exactShape.progress(node, gate)} # ${path.basename(gate)}`,
    release: (gate) => `${exactShape.release(gate)} # ${path.basename(gate)}`,
    reader: both('hand-wiring'),
  },
  // An option word in the script's place: node exits 9 and bash reads its stdin, and neither runs the gate.
  {
    id: "'--gate=<gate>' and '--rcfile=<gate>' in the exact shape",
    progress: (node, gate) => `${P} ${q(node)} ${q(`--gate=${gate}`)}`,
    release: (gate) => `${R} bash ${q(`--rcfile=${gate}`)}`,
    reader: both('unclear'),
  },
  // A glob that matches the gate, after the interpreter and as the program itself.
  { id: "<interpreter> '<dir>/'*<gate>", progress: (node, gate) => `${P} ${q(node)} ${globOf(gate)}`, release: (gate) => `${R} bash ${globOf(gate)}`, reader: both('unclear') },
  { id: "'<dir>/'*<gate> as the program", progress: (node, gate) => `${P} ${globOf(gate)}`, release: (gate) => `${R} ${globOf(gate)}`, reader: both('unclear') },
  // The gate file in a shell option before its -c script.
  releaseForm('bash --rcfile=<gate> -c true', (gate) => `${R} bash --rcfile=${q(gate)} -c true`),
  // The gate file's name joined to a parameter that holds its directory.
  progressForm('D=<dir>/; VAR=block node "$D"<gate>', (node, gate) => `D=${q(`${path.dirname(gate)}/`)}; AGENT_SKILLS_PROGRESS_GATE=block node "$D"${path.basename(gate)}`, { keeps: UNREADABLE }),
  releaseForm('D=<dir>/; VAR=block bash "$D"<gate>', (gate) => `D=${q(`${path.dirname(gate)}/`)}; AGENT_SKILLS_RELEASE_NOTES_GATE=block bash "$D"${path.basename(gate)}`, { keeps: UNREADABLE }),

  // This round's held review, the CERTAINTY forms: each reaches the ACTUAL gate through a shell evaluation the reader does not
  // follow — a substitution that strips a trailing segment back to the gate, or a parameter-expansion operator over a variable
  // holding a lookalike or the gate itself. The reader once called each a different file while it ran the gate; it is unclear now,
  // and --adopt takes it, as 0.19.0's substring match did.
  progressForm(`cert: node "$(dirname '<gate>/y')"`, (node, gate) => `node "$(dirname '${gate}/y')"`, { keeps: OFF }),
  progressForm('cert: G=<gate>.bak; node "${G%.bak}"', (node, gate) => `G=${gate}.bak; node "\${G%.bak}"`, { keeps: OFF }),
  releaseForm(`cert: bash "$(dirname '<gate>/y')"`, (gate) => `bash "$(dirname '${gate}/y')"`, { keeps: OFF }),
  releaseForm('cert: G=<gate>.bak; bash "${G%.bak}"', (gate) => `G=${gate}.bak; bash "\${G%.bak}"`, { keeps: OFF }),
]);

/**
 * Files holding one hook, under the event its installer writes or the one named, with the installer's own describe when
 * "describe present". Each is one of point 2's first three cases — a MENTION, a WRITE TARGET, a DIFFERENT FILE — or a hook under
 * the installer's own describe whose command never names the gate file (`describe only`), which 0.19.0 took with no flag and
 * which --adopt takes over. `reader` is `none` unless stated: a command that writes to the gate file and runs it is unclear, and
 * still a write target. `copy` says why a mention fires.
 */
const SINGLE = Object.freeze([
  ...[
    `AGENT_SKILLS_PROGRESS_GATE=block echo ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block cat ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block grep -c decision ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block rm -f ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block cp ${q(packGate('progress'))} copy.mjs`,
    `AGENT_SKILLS_PROGRESS_GATE=block ls -l ${q(packGate('progress'))}`,
    `AGENT_SKILLS_PROGRESS_GATE=block ${q('/bin/echo')} ${q(packGate('progress'))}`,
    // The installer's exact shape with a program that only reads or deletes files: once read as running the gate.
    `${P} unlink ${q(packGate('progress'))}`,
    `${P} du ${q(packGate('progress'))}`,
    `${P} od -c ${q(packGate('progress'))}`,
  ].map((command) => ({ kind: 'progress', category: 'mention', command })),
  { kind: 'progress', category: 'mention', command: `${P} ${q('/bin/unlink')} ${q(packGate('progress'))}`, needs: '/bin/unlink' },
  { kind: 'progress', category: 'mention', command: `${P} xxd ${q(packGate('progress'))}`, needs: 'xxd' },
  { kind: 'progress', category: 'mention', command: `AGENT_SKILLS_PROGRESS_GATE=block timeout 5 echo ${q(packGate('progress'))}`, needs: 'timeout' },
  { kind: 'progress', category: 'mention', command: `AGENT_SKILLS_PROGRESS_GATE=block cp ${q(packGate('progress'))} ./copy.mjs && node ./copy.mjs`, copy: COPY },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block timeout 5 >${q(packGate('progress'))} node -e 0`, needs: 'timeout' },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block node >${q(packGate('progress'))}` },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block env >${q(packGate('progress'))} node -e 0` },
  { kind: 'progress', category: 'write target', command: `AGENT_SKILLS_PROGRESS_GATE=block >${q(packGate('progress'))} node -e 0` },
  { kind: 'progress', category: 'write target', reader: 'unclear', command: `${P} node ${q(packGate('progress'))} >>${q(packGate('progress'))}` },
  { kind: 'progress', category: 'different file', command: `AGENT_SKILLS_PROGRESS_GATE=block node ${q('/pack/adapters/claude-code/install-report-progress-gate.mjs')} --remove` },
  { kind: 'progress', category: 'different file', command: `node ${q(`${packGate('progress')}.bak`)}` },
  // The gate file named only in a shell comment (point 2a), and its name only as a directory in a path (point 2c): 0.19.0's substring
  // match took both. `detail` is which kind of mention or different file --remove says it left.
  { kind: 'progress', category: 'mention', detail: 'comment', command: 'true # report-progress-gate.mjs' },
  { kind: 'progress', category: 'mention', detail: 'comment', command: 'node other.mjs # uses report-progress-gate.mjs' },
  { kind: 'progress', category: 'different file', detail: 'directory', command: `node ${packGate('progress')}/index.mjs` },
  { kind: 'progress', category: 'different file', detail: 'directory', command: `node other.mjs ${packGate('progress')}.d/x` },
  // What a mention prints, reaching only programs that print or read.
  { kind: 'progress', category: 'mention', command: `cat ${q(packGate('progress'))} | grep -c decision` },
  { kind: 'progress', category: 'mention', command: `echo "$(cat ${q(packGate('progress'))})"` },
  // The holds and the ruling: the gate on a `<`, a here-string or a here-document into a program that does not run it is a mention.
  { kind: 'progress', category: 'mention', command: `${P} cat < ${q(packGate('progress'))}` },
  { kind: 'progress', category: 'mention', command: `${P} wc -l < ${q(packGate('progress'))}` },
  { kind: 'progress', category: 'mention', command: `${P} grep -c decision < ${q(packGate('progress'))}` },
  { kind: 'progress', category: 'mention', command: `${P} cat <<< ${q(packGate('progress'))}` },
  { kind: 'progress', category: 'mention', command: `AGENT_SKILLS_PROGRESS_GATE=block cat <<'EOF'\n${packGate('progress')}\nEOF` },
  { kind: 'progress', category: 'describe only', command: `AGENT_SKILLS_PROGRESS_GATE=block ${q('/opt/agent-skills-hooks/gate-wrapper')} --strict`, keeps: { mode: 'block', coverage: 1 } },

  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block shellcheck ${q(packGate('release'))}`, needs: 'shellcheck' },
  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block cat ${q(packGate('release'))}` },
  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block ${q('/usr/bin/shellcheck')} ${q(packGate('release'))}`, needs: '/usr/bin/shellcheck' },
  { kind: 'release', category: 'mention', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block timeout 5 echo ${q(packGate('release'))}`, needs: 'timeout' },
  { kind: 'release', category: 'mention', command: `${R} unlink ${q(packGate('release'))}` },
  { kind: 'release', category: 'mention', command: `${R} ${q('/bin/unlink')} ${q(packGate('release'))}`, needs: '/bin/unlink' },
  { kind: 'release', category: 'mention', command: `${R} xxd ${q(packGate('release'))}`, needs: 'xxd' },
  { kind: 'release', category: 'mention', command: `${R} du ${q(packGate('release'))}` },
  { kind: 'release', category: 'mention', command: `${R} cp ${q(packGate('release'))} ./copy.sh && bash ./copy.sh`, copy: COPY },
  { kind: 'release', category: 'mention', command: `${R} cat ${q(packGate('release'))}`, event: 'PostToolUse', matcher: 'Bash' },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block timeout 5 >${q(packGate('release'))} bash -c true`, needs: 'timeout' },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block bash >${q(packGate('release'))}` },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block env >${q(packGate('release'))} bash -c true` },
  { kind: 'release', category: 'write target', command: `AGENT_SKILLS_RELEASE_NOTES_GATE=block >${q(packGate('release'))} bash -c true` },
  { kind: 'release', category: 'write target', reader: 'unclear', command: `${R} bash ${q(packGate('release'))} 2>${q(packGate('release'))}` },
  { kind: 'release', category: 'different file', command: `${R} bash ${q(`${packGate('release')}.orig`)}` },
  { kind: 'release', category: 'different file', command: `bash ${q('/pack/adapters/claude-code/my-release-notes-gate.sh')}`, event: 'Stop', matcher: '*' },
  { kind: 'release', category: 'mention', detail: 'comment', command: 'true # release-notes-gate.sh' },
  { kind: 'release', category: 'different file', detail: 'directory', command: `bash ${packGate('release')}/run.sh` },
  { kind: 'release', category: 'mention', command: `xxd ${q(packGate('release'))} | head -1`, needs: 'xxd' },
  // The holds and the ruling for the release gate.
  { kind: 'release', category: 'mention', command: `${R} cat < ${q(packGate('release'))}` },
  { kind: 'release', category: 'mention', command: `${R} wc -l < ${q(packGate('release'))}` },
  { kind: 'release', category: 'mention', command: `${R} cat <<< ${q(packGate('release'))}` },
  { kind: 'release', category: 'mention', command: `${R} cat <<'EOF'\n${packGate('release')}\nEOF` },
  { kind: 'release', category: 'describe only', command: `${R} ${q('/opt/agent-skills-hooks/gate-wrapper')} --strict`, keeps: { mode: 'block' } },
]);

const RUNS = Object.freeze({
  'bare install': [],
  '--adopt install': ['--adopt'],
  '--remove': ['--remove'],
  '--remove --adopt': ['--remove', '--adopt'],
});
const DESCRIBES = Object.freeze(['present', 'stripped']);
const isRemove = (run) => RUNS[run].includes('--remove');
const isAdopt = (run) => RUNS[run].includes('--adopt');
/** The same run with --adopt added: where point 3 lets the branch take what 0.19.0 took with no flag. */
const WITH_ADOPT = Object.freeze({ 'bare install': '--adopt install', '--remove': '--remove --adopt' });
/** 0.19.0's release-notes installer has no --adopt: the run each such row is compared with. */
const WITHOUT_ADOPT = Object.freeze({ '--adopt install': 'bare install', '--remove --adopt': '--remove' });
const kindsOf = (entry) => (entry.only ? [entry.only] : Object.keys(KINDS));

/** Every row the matrix declares, so a harness that builds or runs fewer cannot pass. */
const EXPECTED_ROWS = (INPUTS.length * 2 * Object.keys(KINDS).length + HAND_WRITTEN.reduce((sum, entry) => sum + kindsOf(entry).length, 0) + SINGLE.length)
  * DESCRIBES.length * Object.keys(RUNS).length;

const UNRELATED = 'someone-elses-hook';
const GATE_VARIABLES = Object.freeze([
  'AGENT_SKILLS_PROGRESS_GATE',
  'AGENT_SKILLS_PROGRESS_GATE_COVERAGE',
  'AGENT_SKILLS_PROGRESS_GATE_SKILLS',
  'AGENT_SKILLS_PROGRESS_GATE_TURN_HOOK',
  'AGENT_SKILLS_PROGRESS_GATE_DIR',
  'AGENT_SKILLS_RELEASE_NOTES_GATE',
]);

function childEnv(extra) {
  const env = { ...process.env };
  for (const name of GATE_VARIABLES) delete env[name];
  return { ...env, ...extra };
}

function spawnCollect(file, args, { env, stdin, cwd, timeout }) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], env, cwd });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = timeout ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout) : null;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
  });
}

async function inPool(items, work) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIMIT, items.length) }, worker));
  return results;
}

const scratch = async (name) => realpath(await mkdtemp(path.join(tmpdir(), `${name}-`)));

const allHooks = (settings) => Object.entries(settings.hooks ?? {})
  .flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []).map((hook) => ({ event, matcher: group.matcher, hook }))));

function stripDescribes(settings) {
  for (const { hook } of allHooks(settings)) delete hook.describe;
  return settings;
}

/** A hook named the way an installer names it. */
function labelOf({ event, matcher }) {
  if (typeof matcher !== 'string') return `${event} (no matcher)`;
  return matcher === '' ? `${event} (matcher "")` : `${event} (matcher ${matcher})`;
}

// ---------------------------------------------------------------------------
// 0.19.0 and the binaries.
// ---------------------------------------------------------------------------

function git(...args) {
  try {
    return execFileSync('git', ['-C', REPO, ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** 0.19.0's adapter directory in a temp directory, or null where this clone does not have its commit. */
async function checkoutV019() {
  const tagged = git('rev-parse', '--verify', '--quiet', `${V019.tag}^{commit}`);
  if (tagged === null) return null;
  assert.equal(tagged.toString().trim(), V019.commit, `${V019.tag} is not the commit this table was recorded from`);
  const adapter = path.join(await scratch('agent-skills-v0.19.0'), 'adapters', 'claude-code');
  await mkdir(adapter, { recursive: true });
  // Everything 0.19.0's two installers import: each other's gates, and nothing else.
  for (const kind of Object.values(KINDS)) {
    for (const file of [kind.installer, kind.gate]) {
      const content = git('show', `${V019.commit}:adapters/claude-code/${file}`);
      assert.ok(content, `could not read ${file} at ${V019.commit}`);
      await writeFile(path.join(adapter, file), content);
    }
  }
  return adapter;
}

/** The running Node under each name: hard links, from one copy when the temp directory is on another file system. */
async function nodeBinaries(names) {
  const dir = await scratch('ownership-v019-bin');
  let source = process.execPath;
  const binaries = {};
  for (const name of names) {
    const target = path.join(dir, name);
    try {
      await link(source, target);
    } catch (error) {
      assert.equal(source, process.execPath, `could not link a second name to the copied binary: ${error.message}`);
      source = path.join(dir, '.node-copy');
      await copyFile(process.execPath, source);
      await chmod(source, 0o755);
      await link(source, target);
    }
    binaries[name] = target;
  }
  return binaries;
}

const V019_ADAPTER = await checkoutV019();
const BINARIES = await nodeBinaries([...new Set(['node', ...INPUTS.flatMap((input) => [input.wrote, input.reran])])]);
/** HOME for every fired command: nothing fired here reads or writes the real one. */
const FIRING_HOME = await scratch('ownership-v019-firing-home');

async function loadTable() {
  try {
    return JSON.parse(await readFile(TABLE_URL, 'utf8'));
  } catch {
    return null;
  }
}
let table = await loadTable();

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

const baseSettings = () => ({
  model: 'opus',
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: UNRELATED }] }],
    Stop: [{ hooks: [{ type: 'command', command: UNRELATED }] }],
  },
});

function runInstaller(adapter, kind, binary, args, file, home) {
  return spawnCollect(binary, [path.join(adapter, KINDS[kind].installer), ...args, '--settings', file], { env: childEnv({ HOME: home }) });
}

/** A file both gates were installed into, in block mode and the progress gate at coverage 2, by that version under that binary. */
async function installBoth(adapter, binary) {
  const home = await scratch('ownership-v019-writer');
  const file = path.join(home, 'settings.json');
  await writeFile(file, JSON.stringify(baseSettings(), null, 2));
  for (const [kind, args] of [['progress', ['--mode', 'block', '--coverage', '2']], ['release', ['--mode', 'block']]]) {
    const result = await runInstaller(adapter, kind, binary, args, file, home);
    assert.equal(result.status, 0, `${adapter} ${kind} install under ${binary}: ${result.stderr}`);
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

/** What 0.19.0 wrote, with its binary and gate paths as placeholders: the same template under every binary name. */
function toTemplate(settings, binary, adapter) {
  let text = JSON.stringify(settings);
  text = text.split(binary).join('{{NODE}}');
  for (const [kind, { gate }] of Object.entries(KINDS)) text = text.split(path.join(adapter, gate)).join(`{{${kind.toUpperCase()}_GATE}}`);
  return JSON.parse(text);
}

/** The template filled in: that binary, and this branch's gates, so both versions' re-runs read one file. */
function fromTemplate(template, binary) {
  let text = JSON.stringify(template);
  text = text.split('{{NODE}}').join(binary);
  for (const kind of Object.keys(KINDS)) text = text.split(`{{${kind.toUpperCase()}_GATE}}`).join(branchGate(kind));
  return JSON.parse(text);
}

const branchWrites = new Map();
function writtenByBranch(wrote) {
  if (!branchWrites.has(wrote)) branchWrites.set(wrote, installBoth(BRANCH_ADAPTER, BINARIES[wrote]));
  return branchWrites.get(wrote);
}

/** A hand-written file: both gates, in block mode and the progress gate at coverage 2, beside other hooks, the way the live
 *  file has them — each gate hook carrying a describe when `describe` is present — and, for each gate, the hooks placed for it. */
function handWritten(input, describe) {
  const settings = baseSettings();
  const subjects = { progress: [], release: [] };
  const described = (kind) => (describe === 'present' ? { describe: input.describe ?? ownDescribe(kind) } : {});
  const place = (kind, event, matcher, hook) => {
    const groups = settings.hooks[event] ?? (settings.hooks[event] = []);
    let group = groups.find((candidate) => candidate.matcher === matcher);
    if (!group) {
      group = { matcher, hooks: [] };
      groups.push(group);
    }
    group.hooks.push(hook);
    subjects[kind].push({ event, matcher, hook });
  };
  const release = input.where?.release ?? { event: 'PreToolUse', matcher: 'Bash' };
  place('release', release.event, release.matcher, { type: 'command', command: input.release(branchGate('release')), timeout: 10, ...described('release') });
  const progress = input.progress(BINARIES.node, branchGate('progress'));
  place('progress', 'Stop', '*', { type: 'command', command: progress, timeout: 10, ...described('progress') });
  place('progress', 'SubagentStart', '*', { type: 'command', command: progress, timeout: 5, ...described('progress') });
  return { settings, subjects };
}

/** The hooks of a gate in a file: every hook whose command contains the gate file's name. */
function gateHooks(settings, kind) {
  return allHooks(settings).filter(({ hook }) => typeof hook?.command === 'string' && hook.command.includes(KINDS[kind].gate));
}

const modesOf = (hooks, kind) => {
  const flag = new RegExp(`(?:^|\\s)${KINDS[kind].flag}=([A-Za-z0-9]+)`);
  return [...new Set(hooks.map(({ hook }) => flag.exec(hook.command)?.[1] ?? 'unset'))].sort();
};
const summaryLine = (status, count, modes, kept, of) => `exit ${status} | ${hooksWord(count)}${modes.length > 0 ? ` (${modes.join(', ')})` : ''} | kept ${kept} of ${of}`;

/** exit; how many hooks of the gate the file holds, and in which modes; how many of the row's subjects are still in it, byte for byte. */
function summarise(status, settings, row) {
  const hooks = gateHooks(settings, row.kind);
  const remaining = allHooks(settings).map(({ hook }) => hook);
  let kept = 0;
  for (const { hook } of row.subjects) {
    const at = remaining.findIndex((candidate) => isDeepStrictEqual(candidate, hook));
    if (at !== -1) {
      kept += 1;
      remaining.splice(at, 1);
    }
  }
  return summaryLine(status, hooks.length, modesOf(hooks, row.kind), kept, row.subjects.length);
}

function parseSummary(text) {
  const match = /^exit (\d+) \| (\d+) hooks?(?: \(([^)]*)\))? \| kept (\d+) of (\d+)$/.exec(text ?? '');
  assert.ok(match, `unreadable summary: ${text}`);
  return { status: Number(match[1]), count: Number(match[2]), modes: match[3] ?? '', kept: Number(match[4]), of: Number(match[5]) };
}

/** The hooks this branch's installer writes for a row's gate: under the binary that re-runs it, keeping the row's mode and level. */
function branchEntries(kind, reran, keeps) {
  if (kind === 'release') return [buildHookEntry({ mode: writtenMode(keeps), gatePath: branchGate('release') })];
  return Object.values(buildHookEntries({ mode: writtenMode(keeps), gatePath: branchGate('progress'), nodePath: BINARIES[reran], coverage: keeps.coverage })).filter(Boolean);
}

async function buildRows(template) {
  const rows = [];
  const add = (row) => {
    // Every subject exactly what the branch writes there: an install that exits 0 writes it back byte for byte (WHAT "TOOK" MEANS).
    const entries = branchEntries(row.kind, row.input.reran, row.keeps);
    const rewrittenAsIs = row.subjects.length > 0 && row.subjects.every(({ hook }) => entries.some((entry) => isDeepStrictEqual(entry, hook)));
    rows.push({ ...row, rewrittenAsIs, key: `${row.base} | ${row.run}` });
  };

  for (const input of INPUTS) {
    const read = { ...input, reader: { progress: input.recognised ? 'own' : 'unclear', release: 'own' } };
    for (const [writer, settings] of [['v0.19.0', fromTemplate(template, BINARIES[input.wrote])], ['branch', await writtenByBranch(input.wrote)]]) {
      for (const describe of DESCRIBES) {
        const start = describe === 'stripped' ? stripDescribes(structuredClone(settings)) : structuredClone(settings);
        const text = JSON.stringify(start, null, 2);
        for (const kind of Object.keys(KINDS)) {
          for (const run of Object.keys(RUNS)) {
            add({ base: `${input.id} | written by ${writer} | describe ${describe} | ${kind}`, source: 'installer', input: read, kind, run, describe, subjects: gateHooks(start, kind), category: null, keeps: { mode: 'block', coverage: 2 }, gatePath: branchGate(kind), text });
          }
        }
      }
    }
  }
  for (const input of HAND_WRITTEN) {
    const read = { ...input, wrote: 'node', reran: 'node' };
    for (const describe of DESCRIBES) {
      const { settings, subjects } = handWritten(input, describe);
      const text = JSON.stringify(settings, null, 2);
      for (const kind of kindsOf(input)) {
        const category = describe === 'present' && input.describe ? ANOTHER_TOOL : null;
        const keeps = { mode: 'block', coverage: 2, ...input.keeps?.[kind] };
        for (const run of Object.keys(RUNS)) {
          add({ base: `${input.id} | written by hand | describe ${describe} | ${kind}`, source: 'hand', input: read, kind, run, describe, subjects: subjects[kind], category, keeps, gatePath: branchGate(kind), text });
        }
      }
    }
  }
  for (const entry of SINGLE) {
    const { kind, category, command } = entry;
    const event = entry.event ?? KINDS[kind].event;
    const matcher = entry.matcher ?? KINDS[kind].matcher;
    const read = {
      id: category,
      category,
      wrote: 'node',
      reran: 'node',
      reader: { [kind]: entry.reader ?? 'none' },
      needs: entry.needs ? { [kind]: entry.needs } : undefined,
      copy: entry.copy ? { [kind]: entry.copy } : undefined,
      detail: entry.detail ? { [kind]: entry.detail } : undefined,
    };
    for (const describe of DESCRIBES) {
      const hook = { type: 'command', command, ...(describe === 'present' ? { describe: ownDescribe(kind) } : {}) };
      const text = JSON.stringify({ model: 'opus', hooks: { [event]: [{ matcher, hooks: [{ type: 'command', command: UNRELATED }, hook] }] } }, null, 2);
      for (const run of Object.keys(RUNS)) {
        add({
          base: `${category} ${command} | ${labelOf({ event, matcher })} | describe ${describe} | ${kind}`,
          source: 'single',
          input: read,
          kind,
          run,
          describe,
          subjects: [{ event, matcher, hook }],
          category: category === 'describe only' ? null : category,
          keeps: { mode: 'block', coverage: 1, ...entry.keeps },
          gatePath: packGate(kind),
          text,
        });
      }
    }
  }
  return rows;
}

async function runRow(adapter, row) {
  const home = await scratch('ownership-v019-row');
  const file = path.join(home, 'settings.json');
  await writeFile(file, row.text);
  const result = await runInstaller(adapter, row.kind, BINARIES[row.input.reran], RUNS[row.run], file, home);
  const text = await readFile(file, 'utf8');
  const settings = JSON.parse(text);
  return { result, text, settings, summary: summarise(result.status, settings, row) };
}

/** What the branch's reader makes of this row's subjects: ours, adoptable, unclear, foreign, or none. Stated as the rule. */
function readingOf(row) {
  if (row.source === 'single') {
    if (row.input.category === 'describe only') return row.describe === 'present' ? 'unclear' : 'none';
    return row.input.reader[row.kind];
  }
  if (row.category === ANOTHER_TOOL) return 'foreign';
  const reader = row.input.reader[row.kind];
  if (reader === 'unclear') return 'unclear';
  return reader === 'own' || row.describe === 'present' ? 'ours' : 'adoptable';
}

/** Whether --adopt may take over a hook the reader cannot fully read, stated here rather than read from the reader: it names the gate
 *  file — the gate's basename, exactly, anywhere in the command — or carries the installer's own describe, or the gate file's name
 *  appears where an expansion the reader does not resolve may turn it into the gate (the CERTAINTY class: `G=<gate>.bak; node
 *  "${G%.bak}"`), and no redirection in it writes to the gate file. */
function overrideEvidence(hook, kind) {
  const command = typeof hook.command === 'string' ? hook.command : '';
  const gate = escapeRegExp(KINDS[kind].gate);
  const names = new RegExp(`(?:^|[\\s'"=:,/(){}<>;|&$\`*])${gate}(?![A-Za-z0-9_.-])`).test(command);
  const writes = new RegExp(`(?:>{1,2}\\|?|&>|<>)\\s*'?[^\\s';|&]*/${gate}(?![A-Za-z0-9_.-])`).test(command);
  const described = typeof hook.describe === 'string' && hook.describe.startsWith(KINDS[kind].describePrefix);
  // A parameter-expansion operator, indirection, arithmetic or brace expansion, over a command that holds the gate file's name at all.
  const expansionOverGate = /\$\{[^}]*[-+=?:%#/^,!@][^}]*\}|\$\{[!#][^}]*\}|\$\(\(|\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(command) && new RegExp(gate).test(command);
  return (names || described || expansionOverGate) && !writes;
}

/** What the branch does on a row, stated as the rule rather than recorded. */
function expectedBranch(row) {
  const { kind } = row;
  const remove = isRemove(row.run);
  const adopt = isAdopt(row.run);
  const reading = readingOf(row);
  const start = JSON.parse(row.text);
  const startHooks = gateHooks(start, kind);
  const of = row.subjects.length;
  const unchanged = (status) => summaryLine(status, startHooks.length, modesOf(startHooks, kind), of, of);
  if (reading === 'none') {
    // Never taken. --remove leaves the file as it is; an install writes a new gate beside it, in observe at coverage 1, because
    // nothing of the gate is installed.
    if (remove) return unchanged(0);
    return summaryLine(0, startHooks.length + KINDS[kind].hooksAt[1], [...new Set([...modesOf(startHooks, kind), 'observe'])].sort(), of, of);
  }
  const taken = reading === 'ours' || (adopt && reading === 'adoptable') || (adopt && reading === 'unclear' && row.category === null);
  if (!taken) return unchanged(1);
  if (remove) return summaryLine(0, 0, [], 0, of);
  const hooks = KINDS[kind].hooksAt[kind === 'progress' ? row.keeps.coverage : 1];
  return summaryLine(0, hooks, [writtenMode(row.keeps)], row.rewrittenAsIs ? of : 0, of);
}

/** How many of a row's subjects a version took or removed on a run that exited 0 (WHAT "TOOK" MEANS in the header). */
function takenCount(outcome, row, version) {
  if (outcome.status !== 0) return 0;
  if (version === 'branch' && row.rewrittenAsIs && !isRemove(row.run)) return outcome.of;
  return outcome.of - outcome.kept;
}

/** The reason the branch's --remove gives for a subject it leaves, as the line naming it must say. */
function reasonFor(row, reading) {
  if (reading === 'adoptable') return /: runs this gate, but its command is not exactly the command this installer writes/;
  if (reading === 'foreign') return /: runs this gate, or may, under a describe this installer did not write/;
  if (reading === 'unclear') {
    if (row.category === 'write target') return /also writes to the gate file/;
    if (row.input.category === 'describe only') return /: carries this installer's own describe, but its command never names the gate file/;
    return /: names this gate's file where this installer cannot tell whether the gate runs/;
  }
  const detail = row.input.detail?.[row.kind];
  return {
    mention: detail === 'comment' ? /: left alone: only mentions the gate file \(comment\): / : /: left alone: only mentions the gate file \(argument\): /,
    'write target': /: left alone: only writes to the gate file \(redirection\): /,
    'different file': detail === 'directory' ? /: left alone: names a different file \(directory\): / : /: left alone: names a different file \(name\): /,
  }[row.category];
}

// ---------------------------------------------------------------------------
// Firing a start command against a stand-in gate.
// ---------------------------------------------------------------------------

/** What the stand-in looks for on stdin: only a hook's payload carries it. */
const PAYLOAD_MARK = 'agent-skills-matrix-payload';
/** Stand-ins that write their marker only when handed the payload on stdin. Each is in its own temp directory and knows its
 *  marker's absolute path, so an emptied environment (`env -i`) or another working directory changes nothing. */
const STAND_INS = Object.freeze({
  progress: (marker) => [
    '#!/usr/bin/env node',
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "let input = '';",
    "try { input = readFileSync(0, 'utf8'); } catch {}",
    `if (input.includes(${JSON.stringify(PAYLOAD_MARK)})) writeFileSync(${JSON.stringify(marker)}, 'fired');`,
    '',
  ].join('\n'),
  release: (marker) => [
    '#!/bin/sh',
    'input=$(cat)',
    `case $input in *${PAYLOAD_MARK}*) printf fired > ${q(marker)} ;; esac`,
    '',
  ].join('\n'),
});

const firingKey = (kind, command) => `${kind}\n${command}`;
const firingEnv = () => childEnv({ HOME: FIRING_HOME, PATH: [path.dirname(BINARIES.node), process.env.PATH].filter(Boolean).join(path.delimiter) });

const onPath = new Map();
function installedHere(program) {
  if (!onPath.has(program)) {
    onPath.set(program, spawnCollect('/bin/sh', ['-c', `command -v ${q(program)}`], { env: firingEnv() }).then((result) => result.status === 0));
  }
  return onPath.get(program);
}

const gateMode = async (kind) => (await stat(branchGate(kind))).mode & 0o777;
async function gateHashes() {
  const entries = [];
  for (const kind of Object.keys(KINDS)) entries.push([kind, createHash('sha256').update(await readFile(branchGate(kind))).digest('hex')]);
  return Object.fromEntries(entries);
}

async function fireOne(check) {
  if (/(?:^|[\s;&|(`])sudo\s/.test(check.command)) {
    assert.ok(check.documented, `refusing to run sudo to label a form with no documented run: ${check.command}`);
  }
  if (check.documented) return { state: 'documented', fires: check.documented.fires, why: check.documented.why };
  if (check.needs && !(await installedHere(check.needs))) return { state: 'not fired', fires: null, why: `${check.needs} is not installed here` };
  const dir = await scratch('ownership-v019-standin');
  const marker = path.join(dir, 'fired');
  await writeFile(path.join(dir, KINDS[check.kind].gate), STAND_INS[check.kind](marker));
  await chmod(path.join(dir, KINDS[check.kind].gate), await gateMode(check.kind));
  // The stand-in's directory takes the place of the gate's own, so a path to the gate, one worked out from its directory, and a
  // different file in that directory all point where the stand-in is.
  const gateDir = `${path.dirname(check.gatePath)}/`;
  const command = check.command.split(gateDir).join(`${dir}/`);
  if (check.command.includes(gateDir)) {
    assert.ok(command.includes(dir) && !command.includes(branchGate(check.kind)), `the stand-in did not take the gate's place in: ${check.command}`);
  }
  const payload = JSON.stringify({ hook_event_name: KINDS[check.kind].event, session_id: 'sess-matrix-standin', token: PAYLOAD_MARK });
  const result = await spawnCollect('/bin/sh', ['-c', command], { env: firingEnv(), stdin: payload, cwd: dir, timeout: FIRE_TIMEOUT_MS });
  if (result.timedOut) return { state: 'timed out', fires: null, why: `killed after ${FIRE_TIMEOUT_MS} ms` };
  return existsSync(marker) ? { state: 'fired', fires: true, why: null } : { state: 'silent', fires: false, why: null };
}

/** Every distinct subject command, fired once, with the reading and labels its rows state. The real gates must not change. */
async function fireStartCommands(rows) {
  const checks = new Map();
  for (const row of rows) {
    for (const { hook } of row.subjects) {
      const check = {
        key: firingKey(row.kind, hook.command),
        kind: row.kind,
        id: row.input.id,
        command: hook.command,
        gatePath: row.gatePath,
        reader: row.input.reader[row.kind],
        needs: row.input.needs?.[row.kind] ?? null,
        documented: row.input.documented?.[row.kind] ?? null,
        silent: row.input.silent?.[row.kind] ?? null,
        copy: row.input.copy?.[row.kind] ?? null,
      };
      const seen = checks.get(check.key);
      if (seen) {
        assert.deepEqual([seen.reader, seen.needs, seen.documented, seen.silent, seen.copy], [check.reader, check.needs, check.documented, check.silent, check.copy], `two rows state different things about one start command: ${hook.command}`);
      } else {
        checks.set(check.key, check);
      }
    }
  }
  const list = [...checks.values()];
  const before = await gateHashes();
  const results = await inPool(list, fireOne);
  assert.deepEqual(await gateHashes(), before, 'firing a start command changed a real gate file');
  return new Map(list.map((check, index) => [check.key, { ...check, ...results[index] }]));
}

function firingLabel(check) {
  if (check.state === 'fired') return 'fired here';
  if (check.state === 'silent') return 'did not fire here';
  if (check.fires === true) return 'ran, by a documented run';
  if (check.fires === false) return 'ran nothing, by a documented run';
  return 'not fired';
}

// ---------------------------------------------------------------------------
// Running a written gate the way the harness does, against the real gate.
// ---------------------------------------------------------------------------

const BAD_REPORT = 'Great progress! Things are moving along nicely and the background agent should be wrapping up shortly.';
const onlyCommand = (settings, kind, event, matcher) => {
  const found = gateHooks(settings, kind).filter((entry) => entry.event === event && entry.matcher === matcher);
  assert.equal(found.length, 1, `expected one ${kind} gate hook under ${event} (matcher ${matcher}), found ${found.length}`);
  return found[0].hook.command;
};
const sh = (command, payload, extra = {}) => spawnCollect('/bin/sh', ['-c', command], { env: childEnv(extra), stdin: JSON.stringify(payload) });

/** The JSON object a hook printed, wherever it sits in its stdout — a compound command may print after it — or null. */
function printed(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Arms the progress gate the way its level reads — a subagent starting at coverage 2, an Agent dispatch at coverage 1 — then stops. */
async function progressFires({ commands: [arm, stop], coverage }) {
  const markers = await scratch('ownership-v019-markers');
  const env = { AGENT_SKILLS_PROGRESS_GATE_DIR: markers };
  const armed = coverage === 2
    ? { hook_event_name: 'SubagentStart', session_id: 'sess-matrix', agent_id: 'a1', agent_type: 'general-purpose' }
    : { hook_event_name: 'PostToolUse', session_id: 'sess-matrix', tool_name: 'Agent', tool_input: { description: 'Reply with done', subagent_type: 'general-purpose', run_in_background: false } };
  await sh(arm, armed, env);
  const stopped = await sh(stop, { hook_event_name: 'Stop', session_id: 'sess-matrix', stop_hook_active: false, last_assistant_message: BAD_REPORT }, env);
  return printed(stopped.stdout)?.decision === 'block';
}

let releaseProject = null;
async function releaseFires({ commands: [command] }) {
  if (releaseProject === null) {
    releaseProject = await scratch('ownership-v019-project');
    await writeFile(path.join(releaseProject, 'package.json'), `${JSON.stringify({ name: '@acme/cli', version: '1.4.0' }, null, 2)}\n`);
    await writeFile(path.join(releaseProject, 'CHANGELOG.md'), '# Releases\n\n## 1.3.0\n\nwhat / why / impact\n');
  }
  const verb = ['pub', 'lish'].join('');
  const result = await sh(command, { hook_event_name: 'PreToolUse', session_id: 'sess-matrix', tool_name: 'Bash', cwd: releaseProject, tool_input: { command: `npm ${verb}` } });
  return printed(result.stdout)?.hookSpecificOutput?.permissionDecision === 'deny';
}

const fires = (check) => (check.kind === 'progress' ? progressFires(check) : releaseFires(check));

const firingCommands = (settings, kind, coverage) => {
  if (kind === 'release') return [onlyCommand(settings, 'release', 'PreToolUse', 'Bash')];
  const [event, matcher] = coverage === 2 ? ['SubagentStart', '*'] : ['PostToolUse', 'Agent'];
  return [onlyCommand(settings, 'progress', event, matcher), onlyCommand(settings, 'progress', 'Stop', '*')];
};

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------

test('what 0.19.0 does, row by row, is the recorded table: re-derived from its own installers', { skip: V019_ADAPTER ? false : `this clone does not have ${V019.tag} (${V019.commit}); the branch is held to the table recorded from it` }, async (t) => {
  const templates = [];
  for (const wrote of [...new Set(INPUTS.map((input) => input.wrote))]) {
    templates.push([wrote, toTemplate(await installBoth(V019_ADAPTER, BINARIES[wrote]), BINARIES[wrote], V019_ADAPTER)]);
  }
  for (const [wrote, template] of templates.slice(1)) assert.deepEqual(template, templates[0][1], `0.19.0 wrote a different shape under ${wrote}`);
  const template = templates[0][1];
  if (!RECORDING) assert.deepEqual(template, table?.writes, 'what 0.19.0 writes is not the recorded template');

  const rows = await buildRows(template);
  assert.equal(rows.length, EXPECTED_ROWS, 'the matrix did not build every row it declares');
  const runs = await inPool(rows, (row) => runRow(V019_ADAPTER, row));
  const outcomes = Object.fromEntries(rows.map((row, index) => [row.key, runs[index].summary]));
  assert.equal(Object.keys(outcomes).length, EXPECTED_ROWS, 'two rows share a key, or a row did not run');

  // 0.19.0's release-notes installer has no --adopt. Those rows are compared with its nearest equivalent run (the header),
  // which is only honest while 0.19.0 refuses the argument on every one of them and leaves the file alone.
  const withAdopt = rows.map((row, index) => ({ row, run: runs[index] })).filter(({ row }) => row.kind === 'release' && isAdopt(row.run));
  const accepted = withAdopt.filter(({ row, run }) => !(run.result.status === 1 && /unknown argument: --adopt/.test(run.result.stderr) && run.text === row.text));
  assert.ok(withAdopt.length > 0, 'no release-notes row passes --adopt');
  assert.deepEqual(accepted.map(({ row }) => row.key), [], "0.19.0's release-notes installer did not refuse --adopt on these rows");

  if (RECORDING) {
    table = {
      about: `What ${V019.tag} (${V019.commit}) does on every row of test/hook-ownership-v0.19.0.test.mjs, recorded from its real installers. Placeholders in "writes" stand for the Node binary and each gate's path. Re-record with AGENT_SKILLS_RECORD_V019_TABLE=1.`,
      commit: V019.commit,
      writes: template,
      outcomes,
    };
    await writeFile(TABLE_URL, `${JSON.stringify(table, null, 2)}\n`);
  }
  assert.deepEqual(outcomes, table.outcomes, '0.19.0 no longer does what the recorded table says');
  t.diagnostic(`${rows.length} rows run through 0.19.0's installers${RECORDING ? ', and recorded' : ''}; its release-notes installer refused --adopt as an unknown argument, leaving the file alone, on all ${withAdopt.length} rows that pass it`);
});

test('the branch against 0.19.0, row by row, held to the release bar in precedence order: every point on every row, and every row in one count', async (t) => {
  assert.ok(table, `no recorded table at ${fileURLToPath(TABLE_URL)}`);
  const rows = await buildRows(table.writes);
  assert.equal(rows.length, EXPECTED_ROWS, 'the matrix did not build every row it declares');
  assert.deepEqual(rows.map((row) => row.key).sort(), Object.keys(table.outcomes).sort(), 'the rows and the recorded table are not the same rows');
  const runs = await inPool(rows, (row) => runRow(BRANCH_ADAPTER, row));
  assert.equal(runs.filter((run) => typeof run?.summary === 'string').length, rows.length, 'a row did not run');
  const branchSummary = new Map(rows.map((row, index) => [row.key, runs[index].summary]));

  // Whether each subject runs the gate: fired, not written down.
  const firing = await fireStartCommands(rows);

  // Every row is checked before anything fails, so a regression reads as the full list of rows it touches.
  const problems = [];
  const tally = { same: 0, better: 0, withAdopt: 0, neverTaken: 0, exitsOne: 0, refusedBeside: 0 };
  const neverTakenBy = Object.fromEntries(POINT_TWO.map((category) => [category, 0]));
  const points = { noFlagUnclear: 0, pointTwo: 0, tookOver: 0, removeLeftRunning: 0, removeNamedLeft: 0, comparedWithEquivalent: 0 };
  const pointTwoBy = Object.fromEntries(POINT_TWO.map((category) => [category, 0]));
  const leftBy = {};
  const written = new Map();
  for (const [index, row] of rows.entries()) {
    const run = runs[index];
    const start = JSON.parse(row.text);
    const reading = readingOf(row);
    const remove = isRemove(row.run);
    const adopt = isAdopt(row.run);
    // 0.19.0's release-notes installer has no --adopt, so its nearest equivalent run stands in (the header).
    const equivalent = row.kind === 'release' && adopt ? WITHOUT_ADOPT[row.run] : null;
    const beforeText = table.outcomes[equivalent ? `${row.base} | ${equivalent}` : row.key];
    const before = parseSummary(beforeText);
    const after = parseSummary(run.summary);
    const output = `${run.result.stdout}${run.result.stderr}`;
    const failed = (why) => problems.push(`${row.key}\n    ${why}\n    0.19.0${equivalent ? ` (${equivalent}, its nearest equivalent run)` : ''}: ${beforeText}\n    branch: ${run.summary}${run.result.stderr ? `\n    stderr: ${run.result.stderr.split('\n').slice(0, 2).join(' / ')}` : ''}`);
    if (equivalent) {
      points.comparedWithEquivalent += 1;
      if (parseSummary(table.outcomes[row.key]).status !== 1) failed("0.19.0's release-notes installer is recorded accepting --adopt, so its run without it is not the nearest equivalent");
    }

    // What this test states the reader makes of each subject is what the reader makes of it.
    const identity = row.kind === 'progress'
      ? { ...PROGRESS_IDENTITY, interpreter: { ...PROGRESS_IDENTITY.interpreter, names: [row.input.reran] } }
      : RELEASE_IDENTITY;
    if (row.subjects.length === 0) failed('the row has no subject');
    const expectedReason = row.category === null ? null : REASON_OF[row.category];
    for (const { hook } of row.subjects) {
      const actual = classifyHook(hook, identity) ?? 'none';
      if (actual !== reading) failed(`the reader reads a subject as ${actual}, and this test states ${reading}`);
      if (reading === 'unclear' && row.category === null && !overrideEvidence(hook, row.kind)) {
        failed("a subject stated as one --adopt takes over neither names the gate file nor carries the installer's describe, or it writes to the gate file");
      }
      // The row's point-2 case is the one reason the closed set names, and a row with none is one the closed set names nothing for.
      const reason = ownership.neverTakenReason?.(hook, identity) ?? null;
      if (reason !== expectedReason) failed(`the closed set names ${reason} for a subject, and this row states ${expectedReason}`);
    }

    const expected = expectedBranch(row);
    if (run.summary !== expected) failed(`expected ${expected}`);
    const unrelated = (settings) => allHooks(settings).filter(({ hook }) => hook.command === UNRELATED).length;
    if (unrelated(run.settings) !== unrelated(start) || run.settings.model !== 'opus') failed('the branch took or changed a hook that is not the gate');
    if (!isDeepStrictEqual(gateHooks(run.settings, OTHER[row.kind]), gateHooks(start, OTHER[row.kind]))) failed(`the ${row.kind} installer changed the ${OTHER[row.kind]} gate's hooks`);
    if (after.status !== 0 && run.text !== row.text) failed('a run that failed changed the file');

    // POINT 1: a run with no flag never takes a hook the reader cannot fully read, with or without its own describe.
    if (!adopt && reading === 'unclear') {
      points.noFlagUnclear += 1;
      if (after.status !== 1 || after.kept !== after.of || run.text !== row.text) failed('POINT 1: a run with no flag took or changed a hook the reader cannot fully read');
    }
    // POINT 2, which beats point 3: a mention, a write target, a different file or another tool's describe is never taken.
    if (row.category !== null) {
      points.pointTwo += 1;
      pointTwoBy[row.category] += 1;
      if (after.kept !== after.of) failed(`POINT 2: took a hook that is a ${row.category}, which no flag may take`);
    }
    // …and --adopt says so, naming each by event and matcher, whenever it takes a hook it cannot fully read.
    const tookOverLine = `Took over ${hooksWord(row.subjects.length)} this installer could not fully read: ${row.subjects.map(labelOf).join(', ')}.`;
    if (adopt && reading === 'unclear' && row.category === null) {
      points.tookOver += 1;
      if (!run.result.stdout.split('\n').includes(tookOverLine)) failed(`--adopt took hooks it could not fully read without printing: ${tookOverLine}`);
    } else if (/Took over/.test(output)) {
      failed('said it took over a hook it could not fully read, on a row where it took none');
    }
    // POINT 4: --remove exits 1 while a hook that runs the gate, or may, is left, and names every hook it left that names the gate file.
    if (remove) {
      const left = row.subjects.filter(({ hook }) => allHooks(run.settings).some((entry) => isDeepStrictEqual(entry.hook, hook)));
      const leftRunning = left.length > 0 && ['adoptable', 'unclear', 'foreign'].includes(reading);
      if (leftRunning) {
        points.removeLeftRunning += 1;
        const label = firingLabel(firing.get(firingKey(row.kind, left[0].hook.command)));
        leftBy[label] = (leftBy[label] ?? 0) + 1;
        if (after.status !== 1 || !/the gate is not gone/i.test(output)) failed('POINT 4: --remove left a hook that runs the gate, or may, and did not exit 1 saying the gate is not gone');
      } else if (after.status !== 0) {
        failed('POINT 4: --remove exited non-zero, leaving no hook that runs the gate, or may');
      }
      const naming = left.filter(({ hook }) => reading !== 'none' || hook.command.includes(KINDS[row.kind].gate));
      if (naming.length > 0) {
        points.removeNamedLeft += 1;
        if (KINDS[row.kind].nothingInstalled.test(output)) failed('POINT 4: said no gate was installed while a hook in the file names the gate file');
        const why = reasonFor(row, reading);
        for (const subject of naming) {
          if (!output.split('\n').some((line) => line.startsWith(`  - ${labelOf(subject)}: `) && why.test(line))) failed(`POINT 4: did not name the hook it left under ${labelOf(subject)}, with why (${why})`);
        }
      }
    }

    // POINT 3, and every row in exactly one count. Where 0.19.0 took more, the row is (1), (2) or a failure; where it exited 0 and the
    // branch did not, the row is (4), a refusal to install beside a hook that runs the gate, or may, or a failure.
    const beforeTaken = takenCount(before, row, 'v0.19.0');
    if (beforeTaken > 0 && takenCount(after, row, 'branch') < beforeTaken) {
      if (row.category !== null) {
        tally.neverTaken += 1;
        neverTakenBy[row.category] += 1;
      } else if (!adopt && takenCount(parseSummary(branchSummary.get(`${row.base} | ${WITH_ADOPT[row.run]}`)), row, 'branch') >= beforeTaken) {
        tally.withAdopt += 1;
      } else {
        failed(`POINT 3: 0.19.0 took or removed the gate here, and the branch does not${adopt ? '' : ', with these flags or with --adopt added'}`);
      }
    } else if (before.status === 0 && after.status !== 0) {
      const leftAll = ['adoptable', 'unclear', 'foreign'].includes(reading) && after.status === 1 && after.kept === after.of && run.text === row.text;
      if (remove && leftAll && /the gate is not gone/i.test(output)) {
        tally.exitsOne += 1;
      } else if (!remove && leftAll && before.kept === before.of) {
        tally.refusedBeside += 1;
      } else {
        failed('0.19.0 exited 0 here, and the branch did not');
      }
    } else if (run.summary === beforeText) {
      tally.same += 1;
    } else {
      tally.better += 1;
    }

    const named = reading === 'unclear' && (!adopt || row.category !== null);
    if (/cannot tell whether/.test(output) !== named) {
      failed(named ? 'a hook the reader cannot fully read was left without being named as one it cannot tell runs the gate' : 'a hook was named as one the reader cannot tell runs the gate, on a row that did not leave one');
    }
    // Only a row that did what it should: one that stacked a second gate is already a problem above, and must be listed with
    // the rest rather than stop the loop here.
    if (!remove && reading !== 'none' && after.status === 0 && run.summary === expected) {
      if (!MODE_LINE[row.keeps.mode].test(run.result.stdout)) failed(`a re-run with no --mode did not say which mode it kept (${row.keeps.mode})`);
      if (writtenMode(row.keeps) === 'block') {
        const coverage = row.kind === 'progress' ? row.keeps.coverage : null;
        const commands = firingCommands(run.settings, row.kind, coverage);
        written.set(`${row.kind}\n${commands.join('\n')}`, { kind: row.kind, coverage, commands, context: `what the branch wrote on ${row.key}` });
      }
    }
  }
  assert.deepEqual(problems, [], `${problems.length} problems over ${rows.length} rows:\n${problems.join('\n')}`);
  assert.equal(Object.values(tally).reduce((sum, count) => sum + count, 0), rows.length, 'a row was neither compared nor counted');
  for (const [name, count] of Object.entries({ ...tally, ...points, ...pointTwoBy })) assert.ok(count > 0, `no row was counted as ${name}, so that part of the bar was never compared`);
  // 0.19.0 never took a hook under another tool's describe; it took a mention, a write target and a different file.
  for (const category of ['mention', 'write target', 'different file']) assert.ok(neverTakenBy[category] > 0, `no row where 0.19.0 took a ${category} was counted`);
  assert.equal(neverTakenBy[ANOTHER_TOOL], 0, "0.19.0 is recorded taking a hook under another tool's describe");

  // The firing, held against the reader.
  const firingProblems = [];
  const states = { fired: 0, silent: 0, documented: 0, 'not fired': 0 };
  const labelled = new Map();
  const unclearRan = new Set();
  let silentAsDeclared = 0;
  let copiesRan = 0;
  for (const check of firing.values()) {
    if (!Object.hasOwn(states, check.state)) {
      firingProblems.push(`${check.kind} start command ${check.state} (${check.why}): ${check.command}`);
      continue;
    }
    states[check.state] += 1;
    if (check.why) labelled.set(check.why, [...(labelled.get(check.why) ?? []), `${check.kind} ${check.id}`]);
    if (check.reader === 'none') {
      if (check.fires === true && !check.copy) firingProblems.push(`POINT 2: a hook the reader knows does not run the gate fired: ${check.command}`);
      if (check.copy && check.fires === false) firingProblems.push(`declared to run a copy of the gate (${check.copy}), and nothing fired: ${check.command}`);
      if (check.copy && check.fires === true) copiesRan += 1;
    } else if (check.reader === 'unclear') {
      if (check.fires === true) unclearRan.add(`${check.kind} ${check.id}${check.state === 'documented' ? ' (documented)' : ''}`);
    } else if (check.fires !== null) {
      if (check.silent && check.fires) firingProblems.push(`declared silent (${check.silent}), and it fired: ${check.command}`);
      if (!check.silent && !check.fires) firingProblems.push(`the reader reads this as running the gate, and it did not fire: ${check.command}`);
      if (check.silent && check.state === 'silent') silentAsDeclared += 1;
    }
  }
  assert.deepEqual(firingProblems, [], firingProblems.join('\n'));
  assert.equal(Object.values(states).reduce((sum, count) => sum + count, 0), firing.size, 'a start command was neither fired nor labelled');
  assert.ok(states.fired > 0 && states.silent > 0 && states.documented > 0, `the firing check did not exercise every outcome: ${JSON.stringify(states)}`);
  assert.ok(silentAsDeclared > 0, 'no command declared silent was fired to show it');
  assert.ok(copiesRan > 0, 'no command declared to run a copy of the gate was fired to show it');

  const writtenChecks = [...written.values()];
  const writtenFired = await inPool(writtenChecks, fires);
  const silent = writtenChecks.filter((_, index) => writtenFired[index] !== true).map(({ kind, context }) => `the ${kind} gate looks installed and never fires: ${context}`);
  assert.deepEqual(silent, [], silent.join('\n'));
  assert.ok(writtenChecks.length > 0, 'no gate the branch wrote was fired');
  assert.ok(writtenChecks.some((check) => check.coverage === 1) && writtenChecks.some((check) => check.coverage === 2), 'the written gates fired did not include both levels');

  const bySource = (source) => rows.filter((row) => row.source === source).length;
  t.diagnostic(`${rows.length} rows (${bySource('installer')} from installer-written files, ${bySource('hand')} hand-written, ${bySource('single')} over a single hook)`);
  t.diagnostic(`counts: the same as 0.19.0 ${tally.same}; better ${tally.better}; (1) not taken with no flag, taken with --adopt added ${tally.withAdopt}; (2) never taken where 0.19.0 took it ${tally.neverTaken} (${POINT_TWO.map((category) => `${category}: ${neverTakenBy[category]}`).join(', ')}); (4) --remove exits 1 over a hook both versions leave ${tally.exitsOne}; an install refuses to go beside a hook that runs the gate, or may, where 0.19.0 installed beside it ${tally.refusedBeside}`);
  t.diagnostic(`points: (1) no-flag rows over a hook the reader cannot fully read, none taken ${points.noFlagUnclear}; (2) rows over a point-2 hook, none taken ${points.pointTwo} (${POINT_TWO.map((category) => `${category}: ${pointTwoBy[category]}`).join(', ')}); --adopt rows that took over a hook the reader cannot fully read and said so ${points.tookOver}; (4) --remove rows leaving a hook that runs the gate, or may, all exit 1 ${points.removeLeftRunning} (${Object.entries(leftBy).map(([label, count]) => `${label}: ${count}`).join(', ')}); --remove rows leaving a hook that names the gate file, each named with why ${points.removeNamedLeft}; release-notes --adopt rows compared with 0.19.0's nearest equivalent run ${points.comparedWithEquivalent}`);
  t.diagnostic(`start commands: ${firing.size} (fired ${states.fired}, did not fire ${states.silent}, labelled from a documented run ${states.documented}, not fired ${states['not fired']}; ${silentAsDeclared} declared silent and shown so; ${copiesRan} declared to run a copy and shown so); the reader cannot fully read these, and they ran: ${[...unclearRan].join('; ') || 'none'}`);
  t.diagnostic(`labels not from a firing here: ${[...labelled].map(([why, which]) => `${which.join(', ')} — ${why}`).join('; ')}`);
  t.diagnostic(`${writtenChecks.length} distinct gates the branch wrote fired against the real gate`);
});

// ---------------------------------------------------------------------------
// NEVER TAKEN IS A CLOSED SET, so point 3 holds by construction.
//
// `neverTakenReason` returns point 2's reason for a hook — a mention, a write target, a different file, another tool's describe — or
// null, and nothing else keeps --adopt from a hook. So for every hook whose command contains the gate file's name, which is how
// 0.19.0 matched: the installer's own removal and install take it under --adopt, or that function names a reason — and never both,
// because a hook with a reason is taken by no run, with or without --adopt. Held over every subject of the matrix above, every form
// this branch's held review and ship reports named, and a generated set, through each installer's own `removeHooks`/`removeHook` and
// `installHooks`/`installHook`.
//
// Then the reasons are proven by running, not by the reader agreeing with itself. Every distinct command the function calls a
// mention or a different file is fired through /bin/sh, a hook's payload on stdin, twice: at a stand-in that records which file ran,
// on every run and whatever its input, and at a byte-identical copy of the real gate, armed by its environment (block mode; for the
// report-progress gate an Agent dispatch it records as a marker, for the release-notes gate its first call to jq). Neither may run the
// gate file. A command that copies the gate and runs the copy runs another file, which the stand-in shows by its path and content;
// the armed real gate cannot tell a copy from itself, so for that command alone it may fire.
// ---------------------------------------------------------------------------

const PACK_DIR = path.dirname(packGate('progress'));
const OWN_IDENTITY = Object.freeze({ progress: PROGRESS_IDENTITY, release: RELEASE_IDENTITY });
/** Where the hooks an install writes in place of a subject point: never a subject's own command. */
const WRITTEN_HERE = '/written/by/this/run';
/** Each installer's own removal and install, on a settings object. */
const IN_PROCESS = Object.freeze({
  progress: Object.freeze({
    remove: (settings, adopt) => removeHooks(settings, { adopt }).settings,
    install: (settings, adopt) => installHooks(settings, {
      adopt,
      entries: buildHookEntries({ mode: 'block', gatePath: `${WRITTEN_HERE}/${KINDS.progress.gate}`, nodePath: `${WRITTEN_HERE}/node`, coverage: 1 }),
    }),
  }),
  release: Object.freeze({
    remove: (settings, adopt) => removeHook(settings, { adopt }).settings,
    install: (settings, adopt) => installHook(settings, { adopt, entry: buildHookEntry({ mode: 'block', gatePath: `${WRITTEN_HERE}/${KINDS.release.gate}` }) }),
  }),
});

/** Whether one run of an installer's own code took the subject: it is no longer in the file, byte for byte. A refusal takes nothing. */
function takenInProcess(run, { event, matcher, hook }) {
  const settings = { hooks: { [event]: [{ matcher, hooks: [structuredClone(hook)] }] } };
  let after;
  try {
    after = run(settings);
  } catch (error) {
    if (/^refusing to write/.test(error.message)) return false;
    throw error;
  }
  return !allHooks(after).some((entry) => isDeepStrictEqual(entry.hook, hook));
}

/** The forms this branch's held review and ship reports named, with the gate at its pack path. */
const REPORTED_FORMS = Object.freeze({
  progress: (G) => {
    const g = q(G);
    const name = path.basename(G);
    return [
      // Named only in a comment, or only as a directory in a path; and a comment beside a run.
      `true # ${name}`, `node other.mjs # uses ${name}`, `node ${G}/index.mjs`, `node other.mjs ${G}.d/x`, `node ${g} # note`,
      // Option words read as the gate path.
      `${P} ${q('/usr/local/bin/node')} ${q(`--gate=${G}`)}`, `node --gate=${G}`, `node --require=${G} /work/other.mjs`, `node /pack/runner.mjs --gate=${G}`,
      `bash --rcfile=${G} -c 'node x'`,
      // Joined parameters and globs: after an interpreter, as the program, and in a mention or a write.
      `D=${PACK_DIR}/; node "$D"${name}`, `node $D'${name}'`, `node ${PACK_DIR}/*${name}`, `node ${G}*`, `${PACK_DIR}/*${name}`, `D=${PACK_DIR}/; "$D"${name}`,
      `D=${PACK_DIR}/; cat "$D"${name}`, `D=${PACK_DIR}/; echo x > "$D"${name}`,
      // Mention-only pipelines, and pipelines that reach something else.
      `cat ${g} | grep -c x`, `cat ${g} | wc -l`, `echo ${g} | cat`, `xxd ${g} | head -1`, `echo "$(cat ${g})"`,
      `cat ${g} | node --input-type=module`, `cat ${g} | tee >(node --input-type=module)`, `cat ${g} | (grep -q x; node --input-type=module)`,
      // The ship report's rows.
      `timeout --no-such-option 5 node ${g}`, `cat ${g}`, `echo x > ${g}`, `node ${q(`${PACK_DIR}/install-${name}`)}`, `node ${q(`${G}.bak`)}`,
      // The known limitations, which stay what they are: control flow read by structure, a write through a program argument, and a
      // glob that matches the gate without its name, which has no gate file name in it to hold.
      `false && node ${g}`, `if false; then node ${g}; fi`, `PATH=/nonexistent node ${g}`, `sed -i.orig s/a/b/ ${g}`, `dd if=/dev/null of=${G}`,
      `node ${PACK_DIR}/[r]eport-progress-gate.mjs`,
      // Contrived names the review listed.
      `node "${G} "`, `node ${PACK_DIR}/a=${name}`, `node x'${name}'`,
      // The holds and the ruling: every stdin carrier into a program that does not run the gate is a mention; into node, unclear.
      `cat < ${g}`, `wc -l < ${g}`, `grep -c decision < ${g}`, `cat <<< ${g}`, `head < ${g}`,
      `cat <<'EOF'\n${G}\nEOF`, `cat <<EOF\n${G}\nEOF`,
      `node < ${g}`, `node <<< ${g}`, `node <<'EOF'\n${G}\nEOF`,
      // The certainty rule: a gate-naming word through an operator, or a substitution feeding node, runs the gate and is never a reason.
      `node "$(dirname '${G}/y')"`, `G=${G}.bak; node "\${G%.bak}"`, `node "\${G:=${G}}"`, `node "\${G:-${G}}"`,
      `GATE=${G}; VAR=GATE; node "\${!VAR}"`, `node ${G}{,/../${name}}`,
    ];
  },
  release: (G) => {
    const g = q(G);
    const name = path.basename(G);
    return [
      `true # ${name}`, `true # uses ${G}`, `bash ${G}/run.sh`, `bash other.sh ${G}.d/x`, `bash ${g} # note`,
      `${R} bash ${q(`--rcfile=${G}`)}`, `source --x=${G}`, `bash --rcfile=${G} -c true`, `bash -c --rcfile=${G}`,
      `D=${PACK_DIR}/; bash "$D"${name}`, `bash ${PACK_DIR}/*${name}`, `${PACK_DIR}/*${name}`, `${R} ${G}*`, `echo "$D"${name} | sh`,
      `bash -c "cat ${G}" | wc -c`, `bash -c "cat ${G}" | sh`, `xxd ${g} | head -1`,
      `sudo -i bash ${g}`, `${R} unlink ${g}`, `${R} shellcheck ${g}`, `${R} nice -10 bash ${g}`,
      `cat ${g}`, `echo x > ${g}`, `bash ${q(`${G}.orig`)}`, `bash ${q(`${PACK_DIR}/my-${name}`)}`,
      `bash <<'EOF'\nbash ${G}\nEOF`, `cat <<'EOF'\n${G}\nEOF`, `. ${g}`, `false && bash ${g}`,
      // The holds and the ruling for the release gate: every stdin carrier into a program that does not run the gate is a mention;
      // into bash, sh or a source word, unclear.
      `cat < ${g}`, `wc -l < ${g}`, `shellcheck < ${g}`, `cat <<< ${g}`, `cat <<EOF\n${G}\nEOF`,
      `bash < ${g}`, `bash <<< ${g}`, `sh < ${g}`,
      // The certainty rule.
      `bash "$(dirname '${G}/y')"`, `G=${G}.bak; bash "\${G%.bak}"`, `bash "\${G:=${G}}"`, `bash "\${G:-${G}}"`,
    ];
  },
});

/** A generated set: the gate file named in each of these ways, in each of these places, behind each lead and before each tail. */
const GENERATED = Object.freeze({
  words: (G, name) => [q(G), G, `"$D"${name}`, `$D'${name}'`, `${PACK_DIR}/*${name}`, `${G}*`, `--gate=${G}`, `${G}/index`, `${G}.d/x`, q(`${PACK_DIR}/install-${name}`), `${G}.bak`, `x'${name}'`, name],
  places: (run) => [
    (word) => `${run} ${word}`,
    (word) => `${run} other.x ${word}`,
    (word) => `${run} --check ${word}`,
    (word) => `timeout 5 ${run} ${word}`,
    (word) => `nice -10 ${run} ${word}`,
    (word) => word,
    (word) => `bash ${word} -c true`,
    (word) => `cat ${word}`,
    (word) => `rm -f ${word}`,
    (word) => `echo ${word} | grep -c x`,
    (word) => `cat ${word} | ${run}`,
    (word) => `echo "$(cat ${word})"`,
    (word) => `echo armed > ${word}`,
    (word) => `true # ${word}`,
    (word) => `${run} other.x # uses ${word}`,
    (word) => `timeout -s ${word} 5 true`,
    // ONE CONSUMER ANALYSIS: every stdin carrier — `<`, `<<<` — into a program that does not run the gate is a mention; into the
    // interpreter or a shell it is unclear. The pipe carrier (`cat ${word} | ${run}`) is already above.
    (word) => `cat < ${word}`,
    (word) => `wc -l < ${word}`,
    (word) => `cat <<< ${word}`,
    (word) => `${run} < ${word}`,
    (word) => `${run} <<< ${word}`,
  ],
  leads: (flag) => ['', `${flag}=block `, `D=${PACK_DIR}/; `],
  tails: ['', ' # note', '; true'],
});

function generatedForms(kind) {
  const G = packGate(kind);
  const words = GENERATED.words(G, KINDS[kind].gate);
  const places = GENERATED.places(kind === 'progress' ? 'node' : 'bash');
  const commands = [];
  for (const lead of GENERATED.leads(KINDS[kind].flag)) {
    for (const word of words) {
      for (const place of places) {
        for (const tail of GENERATED.tails) commands.push(`${lead}${place(word)}${tail}`);
      }
    }
  }
  return { commands, expected: GENERATED.leads(KINDS[kind].flag).length * words.length * places.length * GENERATED.tails.length };
}

/** Programs a fired command may need that a machine may lack: where one is missing, that command is not fired, and says so. */
const MAY_BE_MISSING = Object.freeze(['timeout', 'xxd', 'shellcheck', 'nice', 'stdbuf', 'rg', '/usr/local/bin/hook-wrapper', '/usr/bin/shellcheck', '/bin/unlink']);
const neededBy = (command) => MAY_BE_MISSING.filter((program) => new RegExp(`(?:^|[\\s;&|('"])${escapeRegExp(program)}(?=[\\s'"]|$)`).test(command));

/** The command with the gate's own directory replaced by the one a firing put the gate in. Never this checkout's gates, never sudo. */
function inPlaceOf(command, gatePath, dir) {
  const replaced = command.split(`${path.dirname(gatePath)}/`).join(`${dir}/`);
  assert.ok(!replaced.includes(BRANCH_ADAPTER), `refusing to fire a command that names this checkout's adapters: ${command}`);
  assert.ok(!/(?:^|[\s;&|(`])sudo\s/.test(replaced), `refusing to run sudo: ${command}`);
  return replaced;
}

/** Stand-ins that record every run, whatever their input: the module's own path for the Node gate, `$0` for the shell gate. */
const RECORDING_STAND_INS = Object.freeze({
  progress: (log) => [
    '#!/usr/bin/env node',
    "import { appendFileSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "let self = 'not-a-file';",
    'try { self = fileURLToPath(import.meta.url); } catch {}',
    `appendFileSync(${JSON.stringify(log)}, \`\${self}\\n\`);`,
    '',
  ].join('\n'),
  release: (log) => ['#!/bin/sh', `printf '%s\\n' "$0" >> ${q(log)}`, ''].join('\n'),
});

/**
 * Fire one command at a recording stand-in. `ran the gate` unless every run it recorded was of another file with the stand-in's own
 * content — a copy; a path that no longer resolves, or a shell's own name (a sourced script's `$0`), counts as the gate.
 */
async function fireRecording(check) {
  const dir = await scratch('ownership-closed-standin');
  const log = path.join(await scratch('ownership-closed-log'), 'ran');
  const gate = path.join(dir, KINDS[check.kind].gate);
  const content = RECORDING_STAND_INS[check.kind](log);
  await writeFile(gate, content);
  await chmod(gate, await gateMode(check.kind));
  const command = inPlaceOf(check.command, check.gatePath, dir);
  const payload = JSON.stringify({ hook_event_name: KINDS[check.kind].event, session_id: 'sess-closed-set', token: PAYLOAD_MARK });
  const result = await spawnCollect('/bin/sh', ['-c', command], { env: firingEnv(), stdin: payload, cwd: dir, timeout: FIRE_TIMEOUT_MS });
  if (result.timedOut) return 'timed out';
  if (!existsSync(log)) return 'silent';
  for (const line of (await readFile(log, 'utf8')).split('\n').filter((entry) => entry !== '')) {
    let real = null;
    try {
      real = await realpath(path.resolve(dir, line));
    } catch {
      return 'ran the gate';
    }
    if (real === gate || (await readFile(real, 'utf8').catch(() => null)) !== content) return 'ran the gate';
  }
  return 'ran another file';
}

/** Fire one command at a byte-identical copy of the real gate, armed by its environment: `ran` or `silent`. */
async function fireRealGate(check) {
  const dir = await scratch('ownership-closed-real');
  const support = await scratch('ownership-closed-support');
  const [home, markers, shims] = ['home', 'markers', 'shims'].map((name) => path.join(support, name));
  for (const made of [home, markers, shims]) await mkdir(made);
  const gate = path.join(dir, KINDS[check.kind].gate);
  await copyFile(branchGate(check.kind), gate);
  await chmod(gate, await gateMode(check.kind));
  // Armed, the release-notes gate reads its payload and then calls jq: a jq first on PATH that leaves a file is the sign it ran.
  const jqRan = path.join(support, 'jq-ran');
  await writeFile(path.join(shims, 'jq'), ['#!/bin/sh', `printf ran >> ${q(jqRan)}`, 'cat >/dev/null 2>&1', 'exit 0', ''].join('\n'));
  await chmod(path.join(shims, 'jq'), 0o755);
  const sessionId = 'sess-closed-real';
  const env = childEnv({
    HOME: home,
    PATH: [shims, path.dirname(BINARIES.node), process.env.PATH].filter(Boolean).join(path.delimiter),
    [KINDS[check.kind].flag]: 'block',
    [GATE_DIR_ENV]: markers,
  });
  // Armed, the report-progress gate records an Agent dispatch as a marker.
  const payload = check.kind === 'progress'
    ? { hook_event_name: 'PostToolUse', session_id: sessionId, tool_name: 'Agent', tool_input: { description: 'Reply with done' } }
    : { hook_event_name: 'PreToolUse', session_id: sessionId, tool_name: 'Bash', tool_input: { command: 'true' } };
  const command = inPlaceOf(check.command, check.gatePath, dir);
  const result = await spawnCollect('/bin/sh', ['-c', command], { env, stdin: JSON.stringify(payload), cwd: dir, timeout: FIRE_TIMEOUT_MS });
  if (result.timedOut) return 'timed out';
  const ran = check.kind === 'progress' ? existsSync(markerFile({ [GATE_DIR_ENV]: markers }, sessionId)) : existsSync(jqRan);
  return ran ? 'ran' : 'silent';
}

/** A command that sets the gate's mode to anything but block, or clears the environment, would keep an armed real gate from showing a run. */
const DISARMS = Object.freeze({
  progress: /(?<![A-Za-z0-9_])AGENT_SKILLS_PROGRESS_GATE=(?!block(?![A-Za-z0-9_]))|(?:^|[\s;&|(])env\s+-i?(?:\s|$)|(?<![A-Za-z0-9_])AGENT_SKILLS_PROGRESS_GATE_DIR=|(?:^|[\s;&|(])PATH=/,
  release: /(?<![A-Za-z0-9_])AGENT_SKILLS_RELEASE_NOTES_GATE=(?!block(?![A-Za-z0-9_]))|(?:^|[\s;&|(])env\s+-i?(?:\s|$)|(?:^|[\s;&|(])PATH=/,
});

test('never taken is a closed set: every hook with the gate file\'s name in it is taken under --adopt or given one of four reasons, and every mention and different file, fired, does not run the gate', async (t) => {
  assert.equal(typeof ownership.neverTakenReason, 'function', 'hook-ownership.mjs exports no neverTakenReason');
  assert.ok(table, `no recorded table at ${fileURLToPath(TABLE_URL)}`);
  const reasons = ownership.NEVER_TAKEN_REASONS;
  assert.deepEqual(reasons, ['mention', 'writeTarget', 'differentFile', 'foreignDescribe']);

  const subjects = [];
  const seen = new Set();
  const added = { matrix: 0, reported: 0, generated: 0 };
  const add = (source, subject) => {
    added[source] += 1;
    const key = JSON.stringify([subject.kind, subject.event, subject.matcher, subject.hook]);
    if (seen.has(key)) return;
    seen.add(key);
    subjects.push({ source, ...subject });
  };
  const rows = await buildRows(table.writes);
  assert.equal(rows.length, EXPECTED_ROWS, 'the matrix did not build every row it declares');
  for (const row of rows) {
    for (const { event, matcher, hook } of row.subjects) add('matrix', { kind: row.kind, event, matcher, hook, gatePath: row.gatePath });
  }
  const describes = (kind) => [{}, { describe: ownDescribe(kind) }, { describe: ANOTHER_DESCRIBE }];
  let generatedExpected = 0;
  for (const kind of Object.keys(KINDS)) {
    const { event, matcher } = KINDS[kind];
    const place = (source, command) => {
      for (const extra of describes(kind)) add(source, { kind, event, matcher, hook: { type: 'command', command, ...extra }, gatePath: packGate(kind) });
    };
    for (const command of REPORTED_FORMS[kind](packGate(kind))) place('reported', command);
    const { commands, expected } = generatedForms(kind);
    assert.equal(commands.length, expected, `the generated set for ${kind} did not build every form it declares`);
    generatedExpected += expected * describes(kind).length;
    for (const command of commands) place('generated', command);
  }
  assert.equal(added.generated, generatedExpected, 'a generated subject was not added');

  // Every hook with the gate file's name in it: taken under --adopt, or one of four reasons and taken by no run. Nothing else.
  const problems = [];
  const counts = { withName: 0, withoutName: 0, taken: 0, reasoned: 0 };
  const byReason = Object.fromEntries(reasons.map((reason) => [reason, 0]));
  const byDetail = {};
  const candidates = new Map();
  for (const subject of subjects) {
    const { kind, hook } = subject;
    const label = `${kind} (${subject.source}) ${JSON.stringify(hook)}`;
    if (typeof hook.command !== 'string' || !hook.command.includes(KINDS[kind].gate)) {
      counts.withoutName += 1;
      continue;
    }
    counts.withName += 1;
    const reason = ownership.neverTakenReason(hook, OWN_IDENTITY[kind]);
    const api = IN_PROCESS[kind];
    const adoptRemoves = takenInProcess((settings) => api.remove(settings, true), subject);
    const adoptInstalls = takenInProcess((settings) => api.install(settings, true), subject);
    if (reason === null) {
      counts.taken += 1;
      if (!adoptRemoves || !adoptInstalls) problems.push(`POINT 3: none of the four reasons, and --adopt did not take it (removal took it: ${adoptRemoves}; install took it: ${adoptInstalls}): ${label}`);
      continue;
    }
    if (!reasons.includes(reason)) {
      problems.push(`the closed set returned ${JSON.stringify(reason)}: ${label}`);
      continue;
    }
    counts.reasoned += 1;
    byReason[reason] += 1;
    const plainRemoves = takenInProcess((settings) => api.remove(settings, false), subject);
    const plainInstalls = takenInProcess((settings) => api.install(settings, false), subject);
    if (adoptRemoves || adoptInstalls || plainRemoves || plainInstalls) problems.push(`POINT 2: a ${reason} was taken: ${label}`);
    if (reason !== 'mention' && reason !== 'differentFile') continue;
    const [found] = ownership.findHooksNamingGate({ hooks: { [subject.event]: [{ matcher: subject.matcher, hooks: [hook] }] } }, OWN_IDENTITY[kind]);
    const detail = found?.detail ?? null;
    byDetail[`${reason} ${detail}`] = (byDetail[`${reason} ${detail}`] ?? 0) + 1;
    const key = `${kind}\n${subject.gatePath}\n${hook.command}`;
    if (!candidates.has(key)) candidates.set(key, { kind, command: hook.command, gatePath: subject.gatePath, reason, detail, needs: neededBy(hook.command) });
  }
  assert.deepEqual(problems, [], `${problems.length} problems over ${subjects.length} subjects:\n${problems.join('\n')}`);
  assert.equal(counts.taken + counts.reasoned, counts.withName, 'a hook with the gate file\'s name in it was neither taken nor given a reason');
  for (const reason of reasons) assert.ok(byReason[reason] > 0, `no subject was a ${reason}, so that reason was never held`);
  for (const detail of ['mention argument', 'mention comment', 'differentFile name', 'differentFile directory']) assert.ok(byDetail[detail] > 0, `no subject was a ${detail}`);
  assert.ok(counts.withoutName > 0, 'no subject without the gate file\'s name in it, so the limit of the invariant was never met');

  // Fired: no mention and no different file runs the gate file. The harness is first shown to see a run, and a copy.
  const controls = [
    { kind: 'progress', command: `node ${q(packGate('progress'))}`, recording: 'ran the gate', real: 'ran' },
    { kind: 'release', command: `bash ${q(packGate('release'))}`, recording: 'ran the gate', real: 'ran' },
    { kind: 'release', command: `. ${q(packGate('release'))}`, recording: 'ran the gate', real: 'ran' },
    { kind: 'progress', command: `cp ${q(packGate('progress'))} ./copy.mjs && node ./copy.mjs`, recording: 'ran another file', real: 'ran' },
    { kind: 'release', command: `cp ${q(packGate('release'))} ./copy.sh && bash ./copy.sh`, recording: 'ran another file', real: 'ran' },
    { kind: 'progress', command: `cat ${q(packGate('progress'))}`, recording: 'silent', real: 'silent' },
  ].map((control) => ({ ...control, gatePath: packGate(control.kind) }));
  const before = await gateHashes();
  const controlResults = await inPool(controls, async (control) => [await fireRecording(control), await fireRealGate(control)]);
  const controlProblems = controls.flatMap((control, index) => {
    const [recording, real] = controlResults[index];
    return recording === control.recording && real === control.real ? [] : [`control ${control.command}: stand-in ${recording} (expected ${control.recording}), real gate ${real} (expected ${control.real})`];
  });
  assert.deepEqual(controlProblems, [], controlProblems.join('\n'));

  const list = [...candidates.values()];
  const fired = await inPool(list, async (check) => {
    for (const program of check.needs) {
      if (!(await installedHere(program))) return { ...check, skipped: `${program} is not installed here` };
    }
    if (DISARMS[check.kind].test(check.command)) return { ...check, disarms: true };
    return { ...check, recording: await fireRecording(check), real: await fireRealGate(check) };
  });
  assert.deepEqual(await gateHashes(), before, 'firing a command changed a real gate file');
  const firingProblems = [];
  const outcomes = { 'did not run': 0, 'ran another file': 0, 'not fired': 0 };
  const notFired = new Map();
  for (const check of fired) {
    const label = `${check.kind} ${check.reason} (${check.detail}): ${check.command}`;
    if (check.disarms) {
      firingProblems.push(`a command sets the gate's mode, its marker directory or PATH, or clears the environment, so the armed real gate could not show a run: ${label}`);
    } else if (check.skipped) {
      outcomes['not fired'] += 1;
      notFired.set(check.skipped, (notFired.get(check.skipped) ?? 0) + 1);
      if (check.detail === 'comment' || check.detail === 'directory') firingProblems.push(`not fired (${check.skipped}): ${label}`);
    } else if (check.recording === 'timed out' || check.real === 'timed out') {
      firingProblems.push(`timed out: ${label}`);
    } else if (check.recording === 'ran the gate') {
      firingProblems.push(`POINT 2: a ${check.reason} ran the gate file: ${label}`);
    } else if (check.real === 'ran' && check.recording !== 'ran another file') {
      firingProblems.push(`POINT 2: a ${check.reason} ran the armed real gate: ${label}`);
    } else {
      outcomes[check.recording === 'ran another file' ? 'ran another file' : 'did not run'] += 1;
    }
  }
  assert.deepEqual(firingProblems, [], `${firingProblems.length} problems over ${list.length} fired commands:\n${firingProblems.join('\n')}`);
  assert.equal(Object.values(outcomes).reduce((sum, count) => sum + count, 0), list.length, 'a command was neither fired nor said not to be');
  assert.ok(outcomes['did not run'] > 0 && outcomes['ran another file'] > 0, `the firing did not exercise both outcomes: ${JSON.stringify(outcomes)}`);

  // THE DANGEROUS DIRECTION, as its own assertion: a command whose FIRING shows it runs the gate must never receive a never-taken
  // reason — this is what catches a live gate called harmless. Each form below reaches the ACTUAL gate through a shell evaluation
  // the reader does not follow — a `<` into the interpreter, a substitution that strips back to the gate, a parameter-expansion
  // operator over a variable holding a lookalike or the gate itself — so `neverTakenReason` must return null and --adopt must take it.
  const runsViaEval = {
    progress: (G, g) => [
      `node < ${g}`,
      `node "$(dirname '${G}/y')"`,
      `G=${G}.bak; node "\${G%.bak}"`,
      `node "\${G:=${G}}"`,
      `node "\${G:-${G}}"`,
    ],
    release: (G, g) => [
      `bash < ${g}`,
      `bash "$(dirname '${G}/y')"`,
      `G=${G}.bak; bash "\${G%.bak}"`,
      `bash "\${G:=${G}}"`,
      `bash "\${G:-${G}}"`,
    ],
  };
  const dangerous = [];
  for (const kind of Object.keys(KINDS)) {
    const G = packGate(kind);
    for (const command of runsViaEval[kind](G, q(G))) dangerous.push({ kind, command, gatePath: G, needs: neededBy(command) });
  }
  const beforeDangerous = await gateHashes();
  const dangerousFired = await inPool(dangerous, async (check) => ({ ...check, recording: await fireRecording(check), real: await fireRealGate(check) }));
  assert.deepEqual(await gateHashes(), beforeDangerous, 'firing a dangerous command changed a real gate file');
  const dangerousProblems = [];
  let ranAndUnreasoned = 0;
  for (const check of dangerousFired) {
    const ran = check.recording === 'ran the gate' || check.real === 'ran';
    if (!ran) {
      dangerousProblems.push(`declared to run the gate through a shell evaluation, and it did not fire (recording ${check.recording}, real ${check.real}): ${check.kind} ${check.command}`);
      continue;
    }
    const reason = ownership.neverTakenReason({ type: 'command', command: check.command }, OWN_IDENTITY[check.kind]);
    if (reason !== null) dangerousProblems.push(`THE DANGEROUS DIRECTION: a hook that FIRING shows runs the gate was called ${reason}: ${check.kind} ${check.command}`);
    else ranAndUnreasoned += 1;
  }
  assert.deepEqual(dangerousProblems, [], `${dangerousProblems.length} dangerous-direction problems:\n${dangerousProblems.join('\n')}`);
  assert.equal(ranAndUnreasoned, dangerous.length, 'a dangerous form was neither shown to run nor checked for a reason');

  t.diagnostic(`${subjects.length} distinct subjects (added: matrix ${added.matrix}, reported ${added.reported}, generated ${added.generated}); with the gate file's name ${counts.withName}: taken under --adopt ${counts.taken}, never taken ${counts.reasoned} (${reasons.map((reason) => `${reason} ${byReason[reason]}`).join(', ')}); without it ${counts.withoutName}`);
  t.diagnostic(`the dangerous direction: ${ranAndUnreasoned} forms that FIRING shows run the gate through a shell evaluation, each given no never-taken reason`);
  t.diagnostic(`reasons by kind: ${Object.entries(byDetail).map(([detail, count]) => `${detail} ${count}`).join(', ')}`);
  t.diagnostic(`fired ${list.length} distinct mentions and different files, each at a recording stand-in and an armed copy of the real gate: did not run ${outcomes['did not run']}, ran a copy of the gate ${outcomes['ran another file']}, not fired ${outcomes['not fired']}${notFired.size > 0 ? ` (${[...notFired].map(([why, count]) => `${why}: ${count}`).join(', ')})` : ''}; ${controls.length} controls saw a run, a copy and nothing, as expected`);
});
