import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tempDir } from './helpers/temp-dir.mjs';
import { assertCatalogueShape, fenced, prerequisiteItems, procedureSteps, readSkill, section } from './helpers/skill-contract.mjs';

const name = 'rotate-shared-secret';
const loaded = readSkill(name);
const { skill, read, fit } = loaded;
const receiver = read('references/dual-key-receiver.md');
const reconcile = read('references/proving-no-other-caller.md').replace(/\s+/g, ' ');
const probe = read('references/deploy-and-probe.md');

// The overlap is the whole point, so the order is the contract: retiring before the reconciliation,
// or probing before the live domain moved, is how a rotation breaks a caller or proves nothing.
const PROCEDURE_ORDER = [
  /^1\. \*\*Make the receiver accept the current key or a next key, and test it/,
  /^2\. \*\*Generate the next key into a 0600 file, and never print it/,
  /^3\. \*\*Set it on the receiver as `NEXT`, redeploy, and confirm the live domain moved/,
  /^4\. \*\*Move every sender to read the key from a secret store, then verify its delivery/,
  /^5\. \*\*Prove no other caller exists before retiring the old key/,
  /^6\. \*\*Promote `NEXT` to `CURRENT`, and remove `NEXT`/,
  /^7\. \*\*Redeploy, and verify that the live domain moved/,
  /^8\. \*\*Probe the live domain: the new key passes; the old key, a wrong key and no key are refused/,
  /^9\. \*\*Delete every local copy, and record what happened/,
];

test('rotate-shared-secret carries the catalogue shape', () => {
  assertCatalogueShape(name, loaded);
  assert.equal(fit.kind, 'requestOnly');
});

test('the procedure runs its nine acts in order', () => {
  const steps = procedureSteps(skill);
  assert.equal(steps.length, PROCEDURE_ORDER.length, `expected ${PROCEDURE_ORDER.length} steps, found ${steps.length}`);
  PROCEDURE_ORDER.forEach((pattern, index) => assert.match(steps[index], pattern, `step ${index + 1} is not the expected act`));
});

test('the receiver accepts current or a non-empty next, and the empty-value rule is tested and armed', () => {
  const first = procedureSteps(skill)[0];
  assert.match(first, /An empty value never matches anything/);
  assert.match(first, /an unset `NEXT` must not let an empty or missing header through/);
  assert.match(first, /Compare in constant time, and log which slot matched/);
  assert.match(first, /watched failing with the empty-value rule broken/);
  assert.match(receiver, /if \(presented === '' \|\| expected === ''\) return false;/);
  assert.match(receiver, /timingSafeEqual/);
  for (const row of ['| Missing header, `NEXT` unset |', '| Empty header, `NEXT` unset |', '| Old key after promotion |']) {
    assert.ok(receiver.includes(row), `the receiver's test table has no row ${row}`);
  }
});

test('the key is never printed, never an argument, and copies are compared without printing a hash', () => {
  const second = procedureSteps(skill)[1];
  assert.match(second, /with no trailing newline/);
  assert.match(second, /compare them byte for byte with tracing off, printing only same, different or read error — never a hash/);
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /^umask 077$/m);
  assert.match(bash, /openssl rand -hex 32 \| tr -d '\\n' > /);
  assert.match(bash, /^cmp -s "\$SCRATCH\/next\.key" "\$SCRATCH\/next\.copy"$/m);
  // Every read of a key file goes into a header file under ${SCRATCH:?}, never to the terminal or
  // onto a command line. Since the follow-ups to #99 the one read is inside probe().
  const keyReads = bash.split('\n').filter((text) => /\bcat "/.test(text));
  assert.ok(keyReads.length > 0, 'the example reads no key file into a header file');
  for (const line of keyReads) {
    assert.match(line, /\{ printf '[^']*'; cat "[^"]+" && echo; \} > "\$\{SCRATCH:\?\}\//, `the key reaches the terminal or a command line: ${line}`);
  }
  assert.doesNotMatch(bash, /\$\(cat /, 'a key is substituted onto a command line');
  assert.doesNotMatch(bash, /shasum[^|\n]*next\.key\s*$/m, 'a hash of the key is printed');
  assert.match(probe, /Moving the value: standard input or a file, never an argument/);
  assert.match(probe, /## The newline trap/);
});

// Review round 1: psql's :'name' variables are expanded into the statement text on the client, so the
// server receives, and can log, the literal value. Codex round 1 [P2] and round 4 [P1] then found
// one more recorder each time (parameter-logging settings; extensions, proxies, client capture).
// Codex round 5 ended that line: the key does not go in through SQL at all, a bound parameter
// included. It goes in through the store's own interface, or by hand.
test('the key never goes in through SQL: the store\'s own interface, or by hand', () => {
  const files = [skill, receiver, read('references/proving-no-other-caller.md'), probe];
  for (const text of files) {
    assert.doesNotMatch(text, /\\set \w+ `cat/, 'a file recommends reading the key into a psql variable');
    assert.doesNotMatch(text, /and then `:'\w+'`/, 'a file recommends interpolating a psql variable');
    assert.doesNotMatch(text, /client\.query\(|set_secret\(\$1|SET log_parameter_max_length|\*\*A parameterised call/, 'a file offers a SQL route for the key again');
  }
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /A client-side variable is not a separate channel\. The client expands it into the statement before sending it/);
  assert.match(flatProbe, /So \*\*the key does not go in through SQL at all\*\* — not in the statement text, not through a client-side variable, not as a bound parameter\./);
  assert.match(flatProbe, /It goes in through the store's own interface: a command-line tool or API that takes the value as data, from standard input or a file, and builds no SQL from it on your side\. Where the store has no such interface, place it by hand/);
  assert.match(procedureSteps(skill)[3], /A store written with SQL takes the key through its own interface or by hand, never through SQL/);
  assert.match(skill, /- \*\*The key sent through SQL\.\*\*/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /through the store's own interface or by hand: never as an argument, a tool parameter or through SQL/);
});

test('senders move to a secret store and are verified delivering on the next slot', () => {
  const fourth = procedureSteps(skill)[3];
  assert.match(fourth, /read it from the store instead of wherever it held the old one/);
  assert.match(fourth, /readable by anyone who can read that definition/);
  assert.match(fourth, /Remove the literal and any fallback to it/);
  assert.match(fourth, /logged as matching `next`/);
});

test('the old key is retired only on an exact fixed-window match, a search, and stated caveats', () => {
  const fifth = procedureSteps(skill)[4];
  assert.match(fifth, /Pick a fixed window that starts after the last sender moved and is longer than the slowest sender's cycle/);
  assert.match(fifth, /They must match exactly: the same count, and the same first and last second/);
  // Blocks, on review round 1's head: equal totals and endpoints are not one to one, because a lost
  // delivery and an unknown request in the middle of the window cancel. Ids are proof; counts are not.
  assert.match(fifth, /match the ids one to one instead: that is proof/);
  assert.match(fifth, /the count and endpoints are aggregate evidence, not proof — a lost delivery and an unknown request in the middle of the window cancel exactly — and the record says so/);
  assert.match(fifth, /the ids match one to one, or the counts and the first and last seconds match exactly and the record calls that aggregate evidence/);
  assert.match(reconcile, /\*\*One to one, by a per-request id: proof\.\*\*/);
  assert.match(reconcile, /\*\*By count and endpoints: aggregate evidence, not proof\.\*\*/);
  assert.match(reconcile, /What the slot cannot catch is an unknown caller that already holds the next key/);
  const flatSkill = skill.replace(/\s+/g, ' ');
  assert.doesNotMatch(flatSkill, /Matching the first and last second as well, and checking the slot where it is logged, is what tells them apart/, 'the pitfall claims the endpoints tell a cancellation apart');
  assert.match(flatSkill, /A per-request id matched one to one tells them apart/);
  assert.match(fifth, /search code and configuration for any other sender/);
  assert.match(fifth, /the log retention, any paging the tools needed, and whether the logs identify the caller at all/);
  assert.match(reconcile, /Use the senders' records, not the receiver's/);
  assert.match(reconcile, /A count exactly equal to the cap is a page, not a total/);
  assert.match(reconcile, /Do not relax the rule to "within a few seconds"/);
  assert.match(reconcile, /Record the search terms/);
});

test('every redeploy is checked against the live domain, and the probes cover the new, old, wrong and missing key', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[2], /read the deployment id the live domain serves and compare it with the one the redeploy produced; promote it if they differ/);
  assert.match(steps[6], /A production redeploy can leave a custom domain pointing at the previous build/);
  assert.match(steps[6], /the live domain's deployment id is the new deployment's, read after the redeploy/);
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  for (const label of ['new key', 'old key', 'wrong key', 'no key']) assert.ok(bash.split('\n').some((line) => line.startsWith(`probe '${label}' `)), `no ${label} probe`);
  assert.match(bash, /-H @"\$SCRATCH\/probe\.hdr"/, 'the probe key is not read from a header file');
  assert.match(probe, /Probe only after the live domain is confirmed to be on the new deployment/);
});

// Review round 2: the old-key probe was optional, so a stale replica or a partial promotion that
// still accepts the old key could pass unseen while the record claimed the key was refused.
test('the old key is probed wherever it safely can be, and otherwise the retirement is UNVERIFIED', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[7], /The old-key probe is not optional\./);
  assert.match(steps[7], /A stale replica, a region or instance the redeploy has not reached, or a promotion that landed on part of the fleet still accepts the old key/);
  assert.match(steps[7], /probe each of them/);
  assert.match(steps[7], /the retirement is \*\*UNVERIFIED\*\* too, with the reason\. The record never says the old key is refused on less than that/);
  assert.match(steps[7], /the new key accepted and the old key, the wrong key and the missing key refused, each with its status code, for every backend/);
  // Since the follow-ups to #99 the copy is kept in step 4, before any sender drops the old key.
  assert.match(steps[3], /keep a private copy of the old key for step 8/);
  assert.doesNotMatch(steps[5], /From this deploy on, the old key is refused\./, 'step 6 claims the refusal that only step 8 can show');
  assert.doesNotMatch(skill, /if you still hold it/i, 'the old-key probe is optional again');
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /^probe 'old key' "\$SCRATCH\/old\.key"$/m);
  assert.match(bash, /^rm -f [^\n]*"\$SCRATCH\/old\.key"[^\n]*"\$SCRATCH\/wrong\.key"[^\n]*"\$SCRATCH\/probe\.hdr"/m);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /the new key was accepted, and the old key, a wrong key and no key were refused; a signing key was probed by signature and never sent, each probe with a fresh body; otherwise the retirement is recorded as UNVERIFIED/);
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /So it is mandatory wherever it can be done safely/);
  assert.match(flatProbe, /the retirement is \*\*UNVERIFIED\*\*/);
  assert.doesNotMatch(flatProbe, /If you still hold the old key/);
});

test('local copies are deleted and the record holds no key and no hash', () => {
  const last = procedureSteps(skill)[8];
  assert.match(last, /No key value and no hash/);
  assert.match(last, /no copy of the key exists outside the secret stores/);
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /^rm -f "\$\{SCRATCH:\?\}\/next\.key"/m);
});

// Codex round 1 on #99. Four findings, each held here.
const exampleBash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');

// The every-instance rule: the Procedure's lead paragraph, before step 1, whitespace-collapsed.
function everyInstanceRule() {
  const procedure = section(skill, 'Procedure');
  const lead = procedure.slice(0, procedure.search(/\n1\. /));
  assert.match(lead, /\*\*The every-instance rule\.\*\*/, 'the Procedure no longer opens with the every-instance rule');
  return lead.replace(/\s+/g, ' ');
}

// [P1] A signing key never travels: the probe signs a fixed body with each key file and sends only
// the signature. The sign() helper is run from the skill's own example, not read.
test('a signing key is probed by signature, never sent: sign() reads the key from its file', async () => {
  const line = exampleBash.split('\n').find((text) => text.startsWith('sign() {'));
  assert.ok(line, 'the Usage Examples define no sign() for signing keys');
  const dir = await tempDir('rotate-sign-');
  const key = 'a-made-up-signing-key-for-the-test-only';
  writeFileSync(join(dir, 'k'), key);
  writeFileSync(join(dir, 'body.json'), '{"probe":true}');
  const run = spawnSync('bash', ['-c', `${line}\nsign "$1" "$2"`, 'sign', join(dir, 'k'), join(dir, 'body.json')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, createHmac('sha256', key).update('{"probe":true}').digest('hex'));
  assert.doesNotMatch(line, /\$\(cat|-hmac|-macopt/, 'the key reaches a command line');
  assert.match(exampleBash, /-H @"\$SCRATCH\/probe\.hdr" --data-binary @"\$SCRATCH\/probe\.json"/);
  const eighth = procedureSteps(skill)[7];
  assert.match(eighth, /\*\*A signing key never travels\.\*\*/);
  assert.match(eighth, /The `x-shared-key` header in the examples is for bearer keys only/);
});

// [P1] Behind a load balancer, one probe reaches one backend. Since Codex round 4 the kinds of
// evidence that cover every backend live once, in the every-instance rule, and step 8 cites it.
test('backends that cannot be addressed one by one leave the retirement UNVERIFIED without evidence for every backend', () => {
  const eighth = procedureSteps(skill)[7];
  assert.match(eighth, /The probes cover every receiver instance, by the every-instance rule\./);
  assert.match(eighth, /a probe through the live domain reaches one backend and says nothing of the rest: the retirement stays \*\*UNVERIFIED\*\* unless every backend is covered, by the platform's list of instances or by answers that identify each backend/);
  assert.match(everyInstanceRule(), /the platform's own list of instances, each with its deployment or configuration version; or answers — probe responses, delivery records — that identify the instance that gave them and, between them, name every one/);
  assert.match(everyInstanceRule(), /a retirement already done is recorded as \*\*UNVERIFIED\*\*/);
  assert.match(probe.replace(/\s+/g, ' '), /One probe proves nothing about the rest/);
});

// [P2] No CURRENT key fails closed, even with NEXT set.
test('the receiver refuses everything when CURRENT is unset or empty, NEXT included', () => {
  assert.match(receiver, /if \(\(current \?\? ''\) === ''\) return null;/);
  assert.ok(receiver.includes('| `CURRENT` unset, `NEXT` set | unset | k2 | k2 | refused |'), 'no test row for CURRENT unset with NEXT set');
  assert.ok(receiver.includes('| `CURRENT` empty, `NEXT` set | empty | k2 | k2 | refused |'), 'no test row for CURRENT empty with NEXT set');
  const guard = receiver.indexOf("if ((current ?? '') === '') return null;");
  assert.ok(guard < receiver.indexOf("if (sameKey(key, next ?? '')) return 'next';"), 'the next key is checked before CURRENT is required');
});

// Blocks on #99 (severity 7): without pipefail the generator's status was tr's, so a failed openssl
// left an empty key file that a store would accept. Codex round 4 on #99 [P2]: a next.key left by an
// earlier attempt survived a failed generator, and the block still exited 0. Run from the example,
// the whole block to its blank line, with a real and a failing openssl, with and without a stale key.
test('key generation is atomic and length-checked: a failed generator leaves no key file and fails', async () => {
  const lines = exampleBash.split('\n');
  const start = lines.indexOf('umask 077');
  const end = lines.indexOf('', start);
  assert.ok(start >= 0 && end > start, 'the example has no generation block');
  const block = lines.slice(start, end).join('\n');
  assert.match(block, /GENERATION FAILED: no key was written/);
  const STALE = 'a-key-left-by-an-earlier-attempt';
  const generate = async (stub, { stale = false } = {}) => {
    const dir = await tempDir('rotate-gen-');
    const key = join(dir, 'next.key');
    if (stale) writeFileSync(key, STALE, { mode: 0o600 });
    const run = spawnSync('bash', ['-c', `${stub}\nSCRATCH=${JSON.stringify(dir)}\n${block}`], { encoding: 'utf8' });
    return { status: run.status, out: run.stdout + run.stderr, key, made: existsSync(key), tmpLeft: existsSync(join(dir, 'next.key.tmp')) };
  };
  for (const stale of [false, true]) {
    const good = await generate('', { stale });
    assert.equal(good.status, 0, `generation failed${stale ? ' over a stale key' : ''}: ${good.out}`);
    assert.ok(good.made, good.out);
    const value = readFileSync(good.key, 'utf8');
    assert.match(value, /^[0-9a-f]{64}$/, 'the key is not 64 hex characters with no newline');
    assert.equal(statSync(good.key).mode & 0o777, 0o600, 'the key file is not 0600');
    assert.ok(!good.out.includes(value), 'the key was printed');
  }
  for (const [why, stub] of [
    ['openssl fails', 'openssl() { return 1; }'],
    ['openssl writes too little', 'openssl() { printf "abc"; }'],
    ['openssl writes a full-length value and then fails', 'openssl() { printf "%064d" 0; return 1; }'],
  ]) {
    for (const stale of [false, true]) {
      const when = `${why}${stale ? ', over a key left by an earlier attempt' : ''}`;
      const bad = await generate(stub, { stale });
      assert.equal(bad.made, false, `a key file was left when ${when}`);
      assert.equal(bad.tmpLeft, false, `a temporary key file was left when ${when}`);
      assert.notEqual(bad.status, 0, `the block reported success when ${when}`);
      assert.match(bad.out, /GENERATION FAILED: no key was written/);
    }
  }
  // The reference's cleanup removes the same files as the skill's, the probe files included.
  const cleanup = (text) => text.split('\n').find((line) => line.startsWith('rm -f "${SCRATCH:?}/next.key"'));
  assert.match(cleanup(fenced(probe, 'bash').join('\n')) ?? '', /"\$SCRATCH\/wrong\.key" "\$SCRATCH\/probe\.hdr" "\$SCRATCH\/probe\.json"$/, 'the reference cleanup leaves the wrong key or the probe files');
  assert.equal(cleanup(fenced(probe, 'bash').join('\n')), cleanup(exampleBash), 'the reference and the skill clean up different files');
});


// Codex round 4 on #99 (at 9885cbe). Two P1s were one principle: evidence from one instance says
// nothing about the others, on either side. It is stated once, as the every-instance rule, and
// steps 3, 4 and 8 apply it.

// [P1] The overlap on every receiver backend before any sender moves.
test('no sender moves until every receiver instance accepts both keys', () => {
  assert.match(everyInstanceRule(), /every claim below about what the receiver accepts, or what a sender sends, covers every instance/);
  assert.match(everyInstanceRule(), /each instance addressed and checked on its own/);
  assert.match(everyInstanceRule(), /a step that needs it waits/);
  const third = procedureSteps(skill)[2];
  assert.match(third, /no sender moves until the overlap holds on every receiver instance, by the every-instance rule/);
  assert.match(third, /both the current key and the next key are accepted on every receiver instance, not only on the one that answered a probe/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /Before any sender moved, every receiver instance accepted both the current and the next key/);
  assert.match(probe.replace(/\s+/g, ' '), /every backend must accept both keys before any sender moves, not only the backend that answered/);
});

// [P1] Every instance of every sender, not one delivery from one replica.
test('a sender has moved only when every instance of it is shown reading the store', () => {
  assert.match(everyInstanceRule(), /The receiver and each sender can run as several instances/);
  const fourth = procedureSteps(skill)[3];
  assert.match(fourth, /That delivery shows one instance moved; a quiet instance still on the old value fails only once the old key is retired, so every instance of the sender is shown reading the store, by the every-instance rule/);
  assert.match(fourth, /every instance of every sender is shown reading the store, and no sender still holds the old value anywhere/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /every instance of each was shown reading the store/);
  assert.match(skill, /- \*\*One instance standing for all\.\*\*/);
});

// [P1] A copy of the old key with a stray newline or metadata is refused for the wrong reason, and
// the refusal reads as a retirement that took. The copy is proven by being accepted first. Since the
// follow-ups to #99 that happens in step 4, before any sender drops the old key (see below).
test('the old key copy is accepted before the senders move, or the old-key probe proves nothing', () => {
  const fourth = procedureSteps(skill)[3];
  assert.match(fourth, /in the store's raw form where it has one/);
  assert.match(fourth, /So prove the copy: while the old key is still `CURRENT`, before step 5's window opens, probe with it as step 8 will — the same header or signature scheme, over a fresh body — and see it accepted/);
  assert.match(fourth, /the old key is in a 0600 file that the receiver accepted before any sender dropped it, or the record says why no such copy could be had/);
  assert.match(procedureSteps(skill)[7], /no copy of it was accepted before the promotion/);
  const lines = exampleBash.split('\n');
  const exported = lines.findIndex((line) => line.includes('secrets get SHARED_KEY > "${SCRATCH:?}/old.key.tmp"'));
  const control = lines.indexOf(`probe 'old key, before the senders move (must pass)' "$SCRATCH/old.key"`);
  const after = lines.indexOf(`probe 'old key' "$SCRATCH/old.key"`);
  assert.ok(exported >= 0, 'the example no longer exports the old key');
  assert.ok(control > exported, 'the example does not probe with the old key copy after exporting it');
  assert.ok(after > control, 'the copy is not proven before the old-key probe');
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /A refusal means something only if a probe built the same way — the same copy of the key, the same header or signature scheme, over a fresh body — was accepted before/);
  assert.match(flatProbe, /no copy of the old key could be saved and accepted before the senders dropped it/);
});

// The reference's id comparison: the indented bash block in its "One to one" item, de-indented.
function idComparison() {
  const raw = read('references/proving-no-other-caller.md');
  const block = raw.match(/\n {2}```bash\n([\s\S]*?)\n {2}```\n/);
  assert.ok(block, 'the reference has no runnable id comparison');
  return block[1].split('\n').map((text) => text.replace(/^ {2}/, '')).join('\n');
}
// Runs it in a fresh directory. An argument of null leaves that file out; a string is written as is.
async function compareIds(receiverIds, senderIds, stub = '') {
  const dir = await tempDir('rotate-ids-');
  const write = (name, ids) => {
    if (ids === null) return;
    writeFileSync(join(dir, name), typeof ids === 'string' ? ids : `${ids.join('\n')}\n`);
  };
  write('receiver-ids.txt', receiverIds);
  write('sender-ids.txt', senderIds);
  const run = spawnSync('bash', ['-c', `${stub}\n${idComparison()}`], { cwd: dir, encoding: 'utf8' });
  return { status: run.status, out: run.stdout + run.stderr, matched: run.stdout.includes('ids match one to one') };
}

// [P2] Ids are compared with their counts. The reference's own comparison is run against fixtures.
test('delivery ids are reconciled as multisets: a repeated id is a mismatch', async () => {
  const raw = read('references/proving-no-other-caller.md');
  const compare = (receiverIds, senderIds) => compareIds(receiverIds, senderIds);
  const same = await compare(['d-2', 'd-1', 'd-3'], ['d-1', 'd-2', 'd-3']);
  assert.ok(same.matched && same.status === 0, 'equal ids in another order do not match');
  for (const [why, receiverIds, senderIds] of [
    ['a replayed id', ['d-1', 'd-2', 'd-2'], ['d-1', 'd-2']],
    ['an id sent twice and received once', ['d-1', 'd-2'], ['d-1', 'd-2', 'd-2']],
    ['an unknown id', ['d-1', 'd-9'], ['d-1']],
    ['a lost delivery', ['d-1'], ['d-1', 'd-2']],
  ]) {
    const result = await compare(receiverIds, senderIds);
    assert.ok(!result.matched && result.status !== 0, `${why} reconciled as one to one`);
  }
  assert.doesNotMatch(reconcile, /The sets of ids are then compared|the two sets of ids are equal/, 'the ids are compared as sets again');
  assert.match(reconcile, /compared with their counts, not as sets/);
  assert.ok(raw.includes('| An id logged at the receiver more often than the senders recorded it |'), 'no table row for a repeated id');
  assert.match(procedureSteps(skill)[4], /provided each id is counted — as many times on one side as on the other, normally once/);
});

// Codex round 5 on #99 (at 4b0f441). Five findings; each fails closed. The SQL route for writing the
// key was cut in the same round (see the SQL test above).

// [P1] The promotion keeps the overlap until the new CURRENT is live on every instance.
test('NEXT is removed only after every receiver instance matches the new key as current', () => {
  const sixth = procedureSteps(skill)[5];
  assert.match(sixth, /^6\. \*\*Promote `NEXT` to `CURRENT`, and remove `NEXT` only once the new `CURRENT` holds everywhere\.\*\*/);
  assert.match(sixth, /set `CURRENT` from the next key's file, on standard input, leaving `NEXT` in place, and redeploy as in step 7/);
  assert.match(sixth, /one it missed still accepts it as `next`, so no sender fails meanwhile\. Delete `NEXT` only when every receiver instance logs the new key as `current`, by the every-instance rule/);
  assert.match(sixth, /every receiver instance matched the new key as `current` while `NEXT` was still set, `NEXT` was deleted after that/);
  assert.doesNotMatch(sixth, /on standard input, and delete `NEXT`/, 'NEXT is deleted together with the promotion again');
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /every receiver instance matched the new key as `current` while `NEXT` was still set, and only then was `NEXT` removed/);
  assert.ok(receiver.includes('| New key while the promotion lands | k2 | k2 | k2 | `current` |'), 'no receiver test row for the new key during the promotion');
  assert.match(probe.replace(/\s+/g, ' '), /When `CURRENT` is promoted \(step 6\), `NEXT` stays set until every backend logs the new key as `current`/);
});

// [P1] A bearer key in a header is copied by any layer that records headers. One precondition,
// shown before the first probe, or the rotation stops.
test('a bearer key is probed only once no layer on the request path records its header', () => {
  const seventh = prerequisiteItems(skill)[6] ?? '';
  assert.match(seventh, /^7\. \*\*A request path that keeps no copy of a bearer key\.\*\*/);
  assert.match(seventh, /\*\*Complete when:\*\* before the first probe, every layer on the path is shown not to record that header, or to redact it; if that cannot be shown, the rotation stops/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /For a bearer key, every layer on the request path was shown, before the first probe, not to record its header/);
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /So before the first probe, each layer on the path is shown not to record that header, or to redact it\. If that cannot be shown, the rotation stops there/);
  const firstProbe = flatProbe.indexOf("probe '");
  assert.ok(firstProbe > 0 && flatProbe.indexOf('If that cannot be shown, the rotation stops there') < firstProbe, 'the precondition comes after the first bearer probe');
});

// [P1] The id comparison fails closed: no usable input is no evidence, never a match.
test('the id comparison fails closed on empty, missing or failed input', async () => {
  for (const [why, receiverIds, senderIds, stub] of [
    ['both id files are empty', '', '', ''],
    ['both id files are missing', null, null, ''],
    ['the id files hold only blank lines', '\n\n', '\n\n', ''],
    ['the sender file is missing', ['d-1'], null, ''],
    ['sort fails on both sides', ['d-1'], ['d-1'], 'sort() { return 1; }'],
  ]) {
    const result = await compareIds(receiverIds, senderIds, stub);
    assert.ok(!result.matched, `${why} printed a match`);
    assert.notEqual(result.status, 0, `${why} reported success`);
    assert.match(result.out, /NO EVIDENCE/, `${why} was not reported as no evidence`);
  }
  assert.match(idComparison(), /^set -o pipefail$/m);
  assert.match(reconcile, /an empty or unreadable file, or a count that failed, is no evidence, never a match/);
});

// [P2] SCRATCH unset, or not a private directory of yours, refuses before anything is removed; and
// every later command that writes or deletes under it spells it ${SCRATCH:?}.
test('generation refuses unless SCRATCH is a private directory, before the first rm', async () => {
  const lines = exampleBash.split('\n');
  const start = lines.indexOf('umask 077');
  const end = lines.indexOf('', start);
  const block = lines.slice(start, end).join('\n');
  const stubs = 'rm() { echo "RM CALLED"; command rm "$@"; }\nopenssl() { echo "OPENSSL CALLED"; command openssl "$@"; }';
  const attempt = async (setup) => {
    const base = await tempDir('rotate-scratch-');
    const { scratch, env } = setup(base);
    const run = spawnSync('bash', ['-c', `${stubs}\n${env}\n${block}`], { encoding: 'utf8' });
    return { status: run.status, out: run.stdout + run.stderr, scratch };
  };
  const STALE = 'a-key-left-by-an-earlier-attempt';
  for (const [why, setup] of [
    ['SCRATCH is unset', () => ({ env: 'unset SCRATCH' })],
    ['SCRATCH is empty', () => ({ env: 'SCRATCH=' })],
    ['SCRATCH is readable by others', (base) => {
      const scratch = join(base, 'open');
      mkdirSync(scratch, { mode: 0o755 }); chmodSync(scratch, 0o755);
      writeFileSync(join(scratch, 'next.key'), STALE);
      return { scratch, env: `SCRATCH=${JSON.stringify(scratch)}` };
    }],
    ['SCRATCH is a symlink to a private directory', (base) => {
      const target = join(base, 'private');
      mkdirSync(target, { mode: 0o700 });
      writeFileSync(join(target, 'next.key'), STALE);
      symlinkSync(target, join(base, 'link'));
      return { scratch: target, env: `SCRATCH=${JSON.stringify(join(base, 'link'))}` };
    }],
  ]) {
    const result = await attempt(setup);
    assert.notEqual(result.status, 0, `generation reported success when ${why}`);
    assert.match(result.out, /REFUSED: SCRATCH is not a private directory of yours/, `no refusal when ${why}`);
    assert.doesNotMatch(result.out, /RM CALLED|OPENSSL CALLED/, `something ran when ${why}`);
    if (result.scratch) assert.equal(readFileSync(join(result.scratch, 'next.key'), 'utf8'), STALE, `a file was touched when ${why}`);
  }
  // After the guarded block, and in the reference, nothing writes or deletes under a bare $SCRATCH.
  const after = lines.slice(end).join('\n');
  for (const [where, text] of [['the example after generation', after], ['deploy-and-probe', fenced(probe, 'bash').join('\n')]]) {
    assert.doesNotMatch(text, /> "\$SCRATCH\//, `${where} writes under an unchecked $SCRATCH`);
    assert.doesNotMatch(text, /^rm -f "\$SCRATCH\//m, `${where} deletes under an unchecked $SCRATCH`);
  }
});

// [P2] The copy comparison has three outcomes, prints no digest, and says nothing of the key under a
// trace. Run from the example.
test('copies are compared byte for byte: same, DIFFERENT or READ ERROR, and a trace shows no key or digest', async () => {
  const lines = exampleBash.split('\n');
  const at = lines.findIndex((line) => line.startsWith('cmp -s "$SCRATCH/next.key"'));
  assert.ok(at >= 0, 'the example has no byte comparison');
  const compare = lines.slice(at, at + 2).join('\n');
  assert.match(compare, /^case \$\? in /m);
  const key = 'a-made-up-key-for-the-comparison-test';
  const digest = createHash('sha256').update(key).digest('hex');
  const run = async (files, trace = false) => {
    const dir = await tempDir('rotate-cmp-');
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), value);
    const result = spawnSync('bash', [...(trace ? ['-x'] : []), '-c', `SCRATCH=${JSON.stringify(dir)}\n${compare}`], { encoding: 'utf8' });
    return { status: result.status, out: result.stdout + result.stderr };
  };
  const same = await run({ 'next.key': key, 'next.copy': key }, true);
  assert.equal(same.status, 0, same.out);
  assert.match(same.out, /^same$/m);
  assert.ok(!same.out.includes(key) && !same.out.includes(digest), 'the trace shows the key or its digest');
  for (const [why, files, verdict] of [
    ['the copies differ', { 'next.key': key, 'next.copy': `${key}\n` }, /^DIFFERENT$/m],
    ['the copy is missing', { 'next.key': key }, /^READ ERROR$/m],
    ['both files are missing', {}, /^READ ERROR$/m],
  ]) {
    const result = await run(files);
    assert.notEqual(result.status, 0, `success reported when ${why}`);
    assert.match(result.out, verdict, `wrong verdict when ${why}: ${result.out}`);
    assert.doesNotMatch(result.out, /^same$/m, `"same" printed when ${why}`);
  }
  assert.match(exampleBash, /^set \+x -o pipefail$/m, 'the example does not switch tracing off');
});

// Follow-ups to #99, from Codex's final round at fde8f7d: one P1 and three P2s. Each is fixed by
// class and fails closed, and each test below runs the skill's own shell where there is shell to run.

// The example's blank-line-separated section holding a line that matches `pattern`; exactly one.
function exampleSection(pattern) {
  const found = exampleBash.split(/\n\n+/).filter((text) => text.split('\n').some((line) => pattern.test(line)));
  assert.equal(found.length, 1, `expected one example section matching ${pattern}, found ${found.length}`);
  return found[0];
}

// [P1] A blank, whitespace-only or placeholder row passed the non-empty check, so two extractions
// that failed the same way (every row `null`, say) printed a match. Any such row is no evidence.
test('the id comparison refuses blank, whitespace and placeholder rows: no evidence, never a match', async () => {
  const cases = [
    ['whitespace-only rows', '   \n', '   \n'],
    ['a tab row among ids', 'd-1\n\t\n', 'd-1\n\t\n'],
    ['a blank row between ids', 'd-1\n\nd-2\n', 'd-1\n\nd-2\n'],
    ['an id with trailing whitespace', 'd-1 \n', 'd-1 \n'],
    ['CRLF line endings', 'd-1\r\n', 'd-1\r\n'],
  ];
  for (const placeholder of ['null', 'NULL', 'None', 'nil', 'undefined', 'NaN', '-', '\\N', '(null)', '""']) {
    cases.push([`every row ${placeholder}`, `${placeholder}\n${placeholder}\n`, `${placeholder}\n${placeholder}\n`]);
    cases.push([`one row ${placeholder} among ids`, `d-1\n${placeholder}\n`, `${placeholder}\nd-1\n`]);
  }
  for (const [why, receiverIds, senderIds] of cases) {
    const result = await compareIds(receiverIds, senderIds);
    assert.ok(!result.matched, `${why} printed a match`);
    assert.notEqual(result.status, 0, `${why} reported success`);
    assert.match(result.out, /NO EVIDENCE: a row is blank, holds whitespace or is a placeholder/, `${why} was not reported as no evidence: ${result.out}`);
  }
  // A row check that could not read its input is no evidence either, never a pass.
  const unread = await compareIds(['d-1'], ['d-1'], 'grep() { if [ "$1" = -Eiq ]; then return 2; fi; command grep "$@"; }');
  assert.ok(!unread.matched && unread.status !== 0, 'a row check that failed let the comparison through');
  assert.match(unread.out, /NO EVIDENCE/);
  // Silence control: real ids that merely contain a placeholder still match.
  const ids = ['null-1', 'd-none', 'nan0', '-1x', 'N', 'undefined-7', 'x-nil'];
  const control = await compareIds(ids, [...ids].reverse());
  assert.ok(control.matched && control.status === 0, `real ids containing a placeholder were refused: ${control.out}`);
  assert.match(reconcile, /So is any row that is not an id — blank, holding whitespace, or a placeholder such as `null`, `-` or `\\N`/);
  assert.match(procedureSteps(skill)[4], /every row is an id: a blank row or a placeholder such as `null` is no evidence/);
  assert.ok(read('references/proving-no-other-caller.md').includes('| A blank row, or a placeholder such as `null` or `-`, among the ids |'), 'no table row for a placeholder id');
});

// [P2] With a receiver store that cannot be read back, step 4 removed the senders' copies, the only
// readable ones, before step 6 saved the old key. It is now saved and proven before any sender drops it.
test('the old key is saved and proven before any sender drops it, not at the promotion', () => {
  const fourth = procedureSteps(skill)[3];
  assert.match(fourth, /First, keep a private copy of the old key for step 8, before any sender drops it: a receiver store that cannot be read back leaves the senders' copies as the only readable ones, and this step removes them/);
  const saved = fourth.indexOf('keep a private copy of the old key');
  const moved = fourth.indexOf('Then, one sender at a time');
  const removed = fourth.indexOf('Remove the literal and any fallback to it');
  assert.ok(saved >= 0 && moved > saved && removed > moved, 'step 4 saves the old key after a sender may have dropped it');
  const sixth = procedureSteps(skill)[5];
  assert.match(sixth, /With the old key's copy kept from step 4, set `CURRENT`/);
  assert.doesNotMatch(sixth, /read it from its store|keep a private copy/, 'step 6 reads the old key again, after the senders dropped it');
  assert.match(sixth, /the old key's copy from step 4 is still in its 0600 file, or the record says why there is none/);
  // The example saves it in a section marked step 4, and proves it there, before step 8's probes.
  const save = exampleSection(/secrets get SHARED_KEY/);
  assert.match(save, /^# Step 4, before any sender drops the old key/);
  const proof = exampleSection(/^probe 'old key, before the senders move \(must pass\)'/);
  assert.match(proof, /^# Step 4, the old key still CURRENT and step 5's window not yet open/);
  const after = exampleSection(/^probe 'new key'/);
  assert.ok(exampleBash.indexOf(save) < exampleBash.indexOf(proof) && exampleBash.indexOf(proof) < exampleBash.indexOf(after), 'the example saves or proves the old key after step 8');
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /prove the copy before any sender drops the old key \(step 4\)/);
  assert.match(flatProbe, /a store that cannot be read back — many platforms keep secrets write-only — leaves the senders' copies as the only readable ones, and moving the senders removes them/);
  assert.doesNotMatch(flatProbe, /prove the copy before the promotion/, 'the reference saves the old key at the promotion again');
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /The old key's copy was saved and accepted before any sender dropped the old key/);
  assert.match(skill, /- \*\*The old key's last readable copy removed\.\*\*/);
});

const NEXT_KEY = 'a-next-key-made-up-for-the-test';
const OLD_KEY = 'an-old-key-made-up-for-the-test';
// Runs the example's probe helpers and then `calls`, from a shell whose umask is 022, with curl
// stubbed to record each request it is asked to send: its label, the header file's text and mode,
// the body, and its arguments. `kind` undefined leaves KIND unset; `stubs` is shell run first;
// `prepare(scratch, dir)` leaves files behind first, as an earlier attempt would have.
async function runProbes({ kind, calls, stale = false, stubs = '', keys = { 'next.key': NEXT_KEY, 'old.key': OLD_KEY }, prepare = () => {} }) {
  const dir = await tempDir('rotate-probe-');
  const scratch = join(dir, 'scratch');
  const log = join(dir, 'log');
  mkdirSync(scratch, { mode: 0o700 });
  mkdirSync(log);
  for (const [name, value] of Object.entries(keys)) writeFileSync(join(scratch, name), value, { mode: 0o600 });
  if (stale) {
    writeFileSync(join(scratch, 'probe.hdr'), 'a stale header file');
    chmodSync(join(scratch, 'probe.hdr'), 0o644);
  }
  prepare(scratch, dir);
  const curl = [
    'curl() {',
    '  local w h d; SENT=$(( ${SENT:-0} + 1 )); printf "%s\\n" "$@" > "$LOG/$SENT.argv"',
    '  while [ $# -gt 0 ]; do case "$1" in -w) w=$2; shift 2 ;; -H) h=${2#@}; shift 2 ;; --data-binary) d=${2#@}; shift 2 ;; *) shift ;; esac; done',
    '  printf "%s" "${w%%: %*}" > "$LOG/$SENT.label"; cp "$h" "$LOG/$SENT.hdr"; ls -l "$h" | cut -c1-10 > "$LOG/$SENT.mode"; cp "$d" "$LOG/$SENT.body"',
    '  echo "${w%%: %*}: 200"',
    '}',
  ].join('\n');
  const helpers = exampleSection(/^probe\(\) \{/);
  const script = ['umask 022', curl, stubs, `SCRATCH=${JSON.stringify(scratch)}`, `LOG=${JSON.stringify(log)}`, kind === undefined ? 'unset KIND' : `KIND=${kind}`, helpers, ...calls].join('\n');
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  const sent = [];
  for (let n = 1; existsSync(join(log, `${n}.argv`)); n += 1) {
    const at = (ext) => readFileSync(join(log, `${n}.${ext}`), 'utf8');
    sent.push({ label: at('label'), header: at('hdr'), mode: at('mode').trim(), body: at('body'), argv: at('argv') });
  }
  return { status: result.status, out: result.stdout + result.stderr, sent, scratch };
}

// [P2] umask 077 lasts only as long as the shell that set it, so the old key's copy, saved later in
// a new shell, was written 0644. Every block that writes a key sets the umask itself and starts from
// no file; each is run here from a shell whose umask is 022, over stale 0644 files.
test('every block that writes a key sets umask 077 itself: from a new shell, each key file is 0600', async () => {
  // The class: in every example section and reference block that writes under SCRATCH, umask 077
  // comes before the first write.
  const blocks = [
    ...exampleBash.split(/\n\n+/),
    ...['references/deploy-and-probe.md', 'references/proving-no-other-caller.md', 'references/dual-key-receiver.md'].flatMap((file) => fenced(read(file), 'bash')),
  ];
  let writers = 0;
  for (const block of blocks) {
    const lines = block.split('\n');
    const write = lines.findIndex((line) => /> "\$\{?SCRATCH/.test(line));
    if (write < 0) continue;
    writers += 1;
    const umask = lines.indexOf('umask 077');
    assert.ok(umask >= 0 && umask < write, `a block writes under SCRATCH before setting umask 077:\n${block}`);
  }
  assert.ok(writers >= 3, `expected the generation, old-key and probe blocks to write under SCRATCH, found ${writers}`);

  // The old key's copy: a new 0600 file over a stale 0644 one, or a failure that keeps a good copy.
  const save = exampleSection(/secrets get SHARED_KEY/).replace('<platform-cli>', 'platform_cli');
  const saveIn = async ({ cli, before = {} }) => {
    const scratch = await tempDir('rotate-old-');
    for (const [name, [value, mode]] of Object.entries(before)) {
      writeFileSync(join(scratch, name), value);
      chmodSync(join(scratch, name), mode);
    }
    const run = spawnSync('bash', ['-c', `umask 022\n${cli}\nSCRATCH=${JSON.stringify(scratch)}\n${save}`], { encoding: 'utf8' });
    const key = join(scratch, 'old.key');
    const made = existsSync(key);
    return { status: run.status, out: run.stdout + run.stderr, made, value: made ? readFileSync(key, 'utf8') : null, mode: made ? statSync(key).mode & 0o777 : null, tmpLeft: existsSync(join(scratch, 'old.key.tmp')) };
  };
  const reads = `platform_cli() { printf '%s' ${JSON.stringify(OLD_KEY)}; }`;
  for (const [why, before] of [
    ['there is no copy yet', {}],
    ['a stale 0644 copy is there', { 'old.key': ['a-stale-copy', 0o644] }],
    ['a stale 0644 temporary file is there', { 'old.key.tmp': ['a-stale-temporary-file', 0o644] }],
  ]) {
    const result = await saveIn({ cli: reads, before });
    assert.equal(result.status, 0, `${why}: ${result.out}`);
    assert.equal(result.value, OLD_KEY, `${why}: the copy is not the store's value`);
    assert.equal(result.mode, 0o600, `${why}: old.key is not 0600 when saved from a shell whose umask is 022`);
    assert.ok(!result.out.includes(OLD_KEY), `${why}: the old key was printed`);
    assert.equal(result.tmpLeft, false, `${why}: a temporary file was left`);
  }
  for (const [why, cli] of [
    ['the store read fails', 'platform_cli() { return 1; }'],
    ['the store read prints nothing', 'platform_cli() { :; }'],
    ['the store read writes part and then fails', "platform_cli() { printf 'part'; return 1; }"],
  ]) {
    const fresh = await saveIn({ cli });
    assert.equal(fresh.made, false, `${why}: an old.key was left`);
    assert.notEqual(fresh.status, 0, `${why}: the block reported success`);
    assert.match(fresh.out, /OLD KEY NOT SAVED/);
    assert.equal(fresh.tmpLeft, false, `${why}: a temporary file was left`);
    const kept = await saveIn({ cli, before: { 'old.key': [OLD_KEY, 0o600] } });
    assert.equal(kept.value, OLD_KEY, `${why}: a copy saved earlier was lost`);
    assert.notEqual(kept.status, 0, `${why}: the block reported success over a copy saved earlier`);
  }

  // The probes' header file: 0600 from a shell whose umask is 022, over a stale 0644 one.
  for (const kind of ['bearer', 'signing']) {
    const run = await runProbes({ kind, calls: [`probe 'new key' "$SCRATCH/next.key"`], stale: true });
    assert.deepEqual(run.sent.map((request) => request.mode), ['-rw-------'], `${kind}: the header file was not 0600 when curl read it: ${run.out}`);
  }
  // Codex round 2 on #103 [P2]: wrong.key was written by a redirect into a path that might exist, so
  // a stale 0644 file kept its mode and a stale symlink was written through. The class: every write
  // under SCRATCH in the example is preceded, in its own section, by an rm -f of that same file.
  for (const text of exampleBash.split(/\n\n+/)) {
    for (const match of text.matchAll(/> "\$(?:\{SCRATCH:\?\}|SCRATCH)\/([\w.]+)"/g)) {
      const before = text.slice(0, match.index);
      assert.match(before, new RegExp(`rm -f [^\\n]*/${match[1].replace(/\./g, '\\.')}"`), `${match[1]} is written without first removing whatever is at that path`);
    }
  }
  // Run: a stale 0644 wrong.key, and stale symlinks at wrong.key, probe.hdr and probe.json pointing
  // out of SCRATCH. Each is replaced by a new 0600 file, and nothing is written through a link.
  const OUTSIDE = 'a file outside SCRATCH that must not change';
  for (const [why, prepare] of [
    ['a stale 0644 wrong.key', (scratch) => { writeFileSync(join(scratch, 'wrong.key'), 'stale'); chmodSync(join(scratch, 'wrong.key'), 0o644); }],
    ['stale symlinks at wrong.key, probe.hdr and probe.json', (scratch, dir) => {
      for (const name of ['wrong.key', 'probe.hdr', 'probe.json']) {
        writeFileSync(join(dir, `outside-${name}`), OUTSIDE, { mode: 0o644 });
        symlinkSync(join(dir, `outside-${name}`), join(scratch, name));
      }
    }],
  ]) {
    const run = await runProbes({ kind: 'bearer', calls: [`probe 'wrong key' "$SCRATCH/wrong.key"`], prepare });
    const wrongKey = join(run.scratch, 'wrong.key');
    assert.ok(lstatSync(wrongKey).isFile(), `${why}: wrong.key is still a symlink`);
    assert.equal(statSync(wrongKey).mode & 0o777, 0o600, `${why}: wrong.key is not 0600`);
    assert.match(readFileSync(wrongKey, 'utf8'), /^0{64}$/, `${why}: wrong.key is not the wrong key`);
    assert.deepEqual(run.sent.map((request) => [request.mode, request.header]), [['-rw-------', `x-shared-key: ${'0'.repeat(64)}\n`]], `${why}: ${run.out}`);
    for (const name of ['wrong.key', 'probe.hdr', 'probe.json']) {
      const outside = join(run.scratch, '..', `outside-${name}`);
      if (existsSync(outside)) assert.equal(readFileSync(outside, 'utf8'), OUTSIDE, `${why}: ${name} was written through a symlink`);
    }
  }
  assert.match(procedureSteps(skill)[3], /under a `umask 077` set again, since a new shell has lost step 2's/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /every file holding a key was created 0600, under a `umask 077` set in the same shell/);
  assert.match(skill, /- \*\*A key file written in a new shell\.\*\*/);
});

// [P2] The signing example ran only the two probes after the promotion. All five run here, in the
// example's own order, each signed over a fresh body; and a probe that cannot be built sends nothing.
test('a signing key is probed in every case, in order, each over a fresh body, and a probe that cannot be built sends nothing', async () => {
  const calls = exampleBash.split('\n').filter((line) => line.startsWith("probe '"));
  const ORDER = [
    ['old key, before the senders move (must pass)', 'old.key'],
    ['new key', 'next.key'],
    ['old key', 'old.key'],
    ['wrong key', 'wrong.key'],
    ['no key', null],
  ];
  assert.deepEqual(calls, ORDER.map(([label, file]) => `probe '${label}' ${file ? `"$SCRATCH/${file}"` : 'none'}`), 'the example probes other cases, or in another order');
  assert.deepEqual(fenced(probe, 'bash').join('\n').split('\n').filter((line) => line.startsWith("probe '")), calls, 'the reference probes in another order than the skill');

  const signed = await runProbes({ kind: 'signing', calls });
  assert.equal(signed.status, 0, signed.out);
  assert.deepEqual(signed.sent.map((request) => request.label), ORDER.map(([label]) => label));
  const wrong = readFileSync(join(signed.scratch, 'wrong.key'), 'utf8');
  assert.match(wrong, /^0{64}$/, 'the wrong key is not 64 zeros');
  const keyOf = { 'next.key': NEXT_KEY, 'old.key': OLD_KEY, 'wrong.key': wrong };
  signed.sent.forEach((request, index) => {
    const file = ORDER[index][1];
    const expected = file ? `<signature-header>: sha256=${createHmac('sha256', keyOf[file]).update(request.body).digest('hex')}\n` : '';
    assert.equal(request.header, expected, `${request.label}: the header is not the key file's signature over this body`);
    const body = JSON.parse(request.body);
    assert.equal(typeof body.timestamp, 'number', `${request.label}: no timestamp`);
    assert.match(body.nonce, /^[0-9a-f]{32}$/, `${request.label}: no nonce`);
    for (const key of [NEXT_KEY, OLD_KEY]) {
      assert.ok(!request.header.includes(key) && !request.body.includes(key) && !request.argv.includes(key), `${request.label}: a signing key travelled`);
    }
  });
  assert.equal(new Set(signed.sent.map((request) => request.body)).size, signed.sent.length, 'two probes sent the same body, which a receiver refusing replays refuses whatever key signed it');

  // The same calls with a bearer key: each key in the header file, and no header for the last.
  const bearer = await runProbes({ kind: 'bearer', calls });
  assert.deepEqual(bearer.sent.map((request) => request.header), ORDER.map(([, file]) => (file ? `x-shared-key: ${keyOf[file]}\n` : '')));
  for (const request of bearer.sent) assert.ok(!request.argv.includes(NEXT_KEY) && !request.argv.includes(OLD_KEY), 'a bearer key reached a command line');

  // Nothing is sent without a kind, a body, a signature or a usable key file; the probes that can be
  // built still go. The last field says the refusal must name the key file.
  for (const [why, options, expected, byKeyFile = false] of [
    ['KIND is unset', { kind: undefined }, []],
    ['KIND is neither bearer nor signing', { kind: 'hmac' }, []],
    ['no nonce can be made', { kind: 'signing', stubs: 'openssl() { return 1; }' }, []],
    ['the nonce comes out short', { kind: 'signing', stubs: 'openssl() { printf abc; }' }, []],
    ['the signer fails', { kind: 'signing', stubs: 'node() { return 1; }' }, ['no key']],
    ['the old key copy is missing, signing', { kind: 'signing', keys: { 'next.key': NEXT_KEY } }, ['new key', 'wrong key', 'no key'], true],
    ['the old key copy is missing, bearer', { kind: 'bearer', keys: { 'next.key': NEXT_KEY } }, ['new key', 'wrong key', 'no key'], true],
    // Codex round 2 on #103 [P2]: an empty key file passed cat and the signer, so it sent a blank
    // header or a signature made with no key. The key file must be a non-empty regular file.
    ['the old key copy is empty, signing', { kind: 'signing', keys: { 'next.key': NEXT_KEY, 'old.key': '' } }, ['new key', 'wrong key', 'no key'], true],
    ['the old key copy is empty, bearer', { kind: 'bearer', keys: { 'next.key': NEXT_KEY, 'old.key': '' } }, ['new key', 'wrong key', 'no key'], true],
    ['the old key copy is a symlink', { kind: 'bearer', keys: { 'next.key': NEXT_KEY }, prepare: (scratch, dir) => { writeFileSync(join(dir, 'elsewhere'), OLD_KEY); symlinkSync(join(dir, 'elsewhere'), join(scratch, 'old.key')); } }, ['new key', 'wrong key', 'no key'], true],
    ['the old key copy is a directory', { kind: 'signing', keys: { 'next.key': NEXT_KEY }, prepare: (scratch) => { mkdirSync(join(scratch, 'old.key')); writeFileSync(join(scratch, 'old.key', 'x'), 'x'); } }, ['new key', 'wrong key', 'no key'], true],
  ]) {
    const result = await runProbes({ calls, ...options });
    assert.deepEqual(result.sent.map((request) => request.label), expected, `${why}: these were sent`);
    assert.equal((result.out.match(/NOTHING SENT/g) ?? []).length, calls.length - expected.length, `${why}: ${result.out}`);
    if (byKeyFile) {
      assert.equal((result.out.match(/: NOTHING SENT: the key file is missing, empty or not a regular file/g) ?? []).length, calls.length - expected.length, `${why}: refused for another reason: ${result.out}`);
    }
  }

  const eighth = procedureSteps(skill)[7];
  assert.match(eighth, /Sign a fresh probe body with each key file/);
  assert.match(eighth, /a receiver that refuses replays refuses a body it has seen whatever key signed it, and that refusal reads as a retirement that took/);
  assert.match(eighth, /The example's `probe` sends either kind, by `KIND`, and sends nothing when it cannot build the request — a key file that is missing, empty or not a regular file included: an empty key makes a blank header or a signature with no key, refused for the wrong reason/);
  assert.match(probe.replace(/\s+/g, ' '), /a probe sends nothing when its key file is missing, empty or not a regular file, or its body or signature failed/);
  assert.doesNotMatch(eighth, /the probe's fixed body/, 'the signed probes share one body again');
  assert.match(probe.replace(/\s+/g, ' '), /Every probe gets a fresh body: a new timestamp and a new nonce/);
  assert.match(skill, /- \*\*A signed probe sent twice\.\*\*/);
});

// Codex round 1 on #103 (at b3ceb6e) [P2]: the reference still told the operator to send the old
// key's probe after the promotion with the body accepted before it. A receiver that refuses replays
// refuses that body even while the old key is valid, and the refusal reads as a retirement that
// took. Held by class: in every file of the skill, a sentence that speaks of a probe body being
// accepted before, the same body, reuse or sending again either forbids it or asks for a fresh body,
// and the instructions to prove the copy ask for a fresh body rather than the same probe "exactly".
test('no instruction reuses a probe body: every probe, the old key\'s after the promotion included, gets a fresh one', () => {
  const files = {
    'SKILL.md': skill,
    ...Object.fromEntries(['references/deploy-and-probe.md', 'references/proving-no-other-caller.md', 'references/dual-key-receiver.md'].map((file) => [file, read(file)])),
  };
  for (const [file, text] of Object.entries(files)) {
    const flat = text.replace(/\s+/g, ' ');
    for (const sentence of flat.split(/(?<=[.!?])\s+/)) {
      if (/\bbody\b/i.test(sentence) && /accepted before|same body|\breus|\bagain\b/i.test(sentence)) {
        assert.match(sentence, /\bnever\b|\bfresh body\b/i, `${file} reads as reusing a probe body: ${sentence}`);
      }
    }
    assert.doesNotMatch(flat, /probe with it exactly as|the same probe was accepted before/, `${file} asks for the same probe again, which a replay check refuses`);
  }
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /Never send the old key's probe after the promotion with the body that was accepted before it: the receiver refuses it as a replay even while the old key is still valid/);
  assert.match(flatProbe, /Each probe, the old key's after the promotion included, gets its own timestamp and nonce/);
  assert.match(flatProbe, /probe with it as you will afterwards — the same header or signature scheme, over a fresh body — and see it accepted/);
  assert.match(procedureSteps(skill)[3], /probe with it as step 8 will — the same header or signature scheme, over a fresh body — and see it accepted/);
});
