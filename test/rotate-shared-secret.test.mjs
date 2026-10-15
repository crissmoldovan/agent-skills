import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tempDir } from './helpers/temp-dir.mjs';
import { assertCatalogueShape, fenced, procedureSteps, readSkill, section } from './helpers/skill-contract.mjs';

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
  assert.match(second, /compare their hashes inside the shell and print only "same" or "different"/);
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /^umask 077$/m);
  assert.match(bash, /openssl rand -hex 32 \| tr -d '\\n' > /);
  assert.match(bash, /&& echo same \|\| echo DIFFERENT/);
  // Every read of the key file goes into a file, never to the terminal or onto a command line.
  for (const line of bash.split('\n').filter((text) => /cat "\$SCRATCH\/(?:next|old)\.key"/.test(text))) {
    assert.match(line, /^\{ printf '[^']*'; cat "\$SCRATCH\/(?:next|old)\.key"; echo; \} > /, `the key reaches the terminal or a command line: ${line}`);
  }
  assert.doesNotMatch(bash, /\$\(cat [^)]*(?:next|old)\.key\)/, 'a key is substituted onto a command line');
  assert.doesNotMatch(bash, /shasum[^|\n]*next\.key\s*$/m, 'a hash of the key is printed');
  assert.match(probe, /Moving the value: standard input or a file, never an argument/);
  assert.match(probe, /## The newline trap/);
});

// Review round 1: psql's :'name' variables are expanded into the statement text on the client, so the
// server receives, and can log, the literal value. No file of the skill may recommend building SQL
// text around the value; the way in is a bound parameter, after checking parameter logging.
test('the key never travels inside SQL text, and parameter logging is checked first', () => {
  const files = [skill, receiver, read('references/proving-no-other-caller.md'), probe];
  for (const text of files) {
    assert.doesNotMatch(text, /\\set \w+ `cat/, 'a file recommends reading the key into a psql variable');
    assert.doesNotMatch(text, /and then `:'\w+'`/, 'a file recommends interpolating a psql variable');
  }
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /A client-side variable is not a separate channel\. The client expands it into the statement before sending it/);
  assert.match(flatProbe, /\*\*A parameterised call, with the value as a bound parameter\.\*\*/);
  assert.match(probe, /client\.query\('select <store>\.set_secret\(\$1, \$2\)', \['shared_key', value\]\)/);
  assert.match(flatProbe, /\*\*Check, and switch off, what the server logs before you send it\.\*\*/);
  assert.match(flatProbe, /`log_parameter_max_length`, which writes bound parameters beside every logged statement and by default writes them in full/);
  const fourth = procedureSteps(skill)[3];
  assert.match(fourth, /the value travels as a bound parameter or through the store's own interface, never inside the statement text/);
  assert.match(skill, /- \*\*The key inside a SQL statement\.\*\*/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /never as an argument, a tool parameter or part of a SQL statement's text/);
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
  for (const label of ['new key', 'old key', 'wrong key', 'no key']) assert.ok(bash.includes(`-w '${label}: %{http_code}\\n'`), `no ${label} probe`);
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
  assert.match(steps[5], /keep a private copy of the old key for step 8/);
  assert.doesNotMatch(steps[5], /From this deploy on, the old key is refused\./, 'step 6 claims the refusal that only step 8 can show');
  assert.doesNotMatch(skill, /if you still hold it/i, 'the old-key probe is optional again');
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /-w 'old key: %\{http_code\}\\n' -H @"\$SCRATCH\/old\.hdr"/);
  assert.match(bash, /^rm -f [^\n]*"\$SCRATCH\/old\.key"[^\n]*"\$SCRATCH\/old\.hdr"/m);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /the new key was accepted, and the old key, a wrong key and no key were refused; a signing key was probed by signature and never sent; otherwise the retirement is recorded as UNVERIFIED/);
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
  assert.match(bash, /^rm -f "\$SCRATCH\/next\.key"/m);
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
  assert.match(exampleBash, /-H @"\$SCRATCH\/sig-old\.hdr" --data-binary @"\$SCRATCH\/probe\.json"/);
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

// [P2] Both parameter-logging settings and statement logging, switched off before the call.
test('statement logging and both parameter-logging settings are read and switched off before the value is sent', () => {
  for (const setting of ["SET log_statement = 'none';", 'SET log_min_duration_statement = -1;', 'SET log_parameter_max_length = 0;', 'SET log_parameter_max_length_on_error = 0;']) {
    assert.ok(probe.includes(setting), `the settings no longer switch off: ${setting}`);
  }
  assert.match(probe, /SHOW log_parameter_max_length_on_error;/);
  assert.match(probe.replace(/\s+/g, ' '), /If any of them cannot be switched off for that session, do not send the value this way/);
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
  assert.match(probe, /rm -f [^\n]*"\$SCRATCH\/sig-new\.hdr" "\$SCRATCH\/sig-old\.hdr"/, 'the reference cleanup leaves the signature header files');
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
// the refusal reads as a retirement that took. The copy is proven by being accepted first.
test('the old key copy is accepted before the promotion, or the old-key probe proves nothing', () => {
  const sixth = procedureSteps(skill)[5];
  assert.match(sixth, /in the store's raw form where it has one/);
  assert.match(sixth, /prove the copy: with the window closed and the old key still `CURRENT`, probe with it exactly as step 8 will — header or signature — and see it accepted/);
  assert.match(sixth, /the old key is in a 0600 file that the receiver accepted before the promotion, or the record says why no such copy could be had/);
  assert.match(procedureSteps(skill)[7], /no copy of it was accepted before the promotion/);
  const lines = exampleBash.split('\n');
  const exported = lines.findIndex((line) => line.endsWith('> "$SCRATCH/old.key"'));
  const control = lines.findIndex((line) => line.includes("-w 'old key, before promotion (must pass): %{http_code}\\n' -H @\"$SCRATCH/old.hdr\""));
  const after = lines.findIndex((line) => line.includes("-w 'old key: %{http_code}\\n'"));
  assert.ok(exported >= 0, 'the example no longer exports the old key');
  assert.ok(control > exported, 'the example does not probe with the old key copy after exporting it');
  assert.ok(after > control, 'the copy is not proven before the old-key probe');
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /A refusal means something only if the same probe was accepted before/);
  assert.match(flatProbe, /no copy of the old key could be read from its store and accepted before the promotion/);
});

// [P1] Not an enumeration of switches but a rule: nothing on the connection records the parameters.
test('SQL is the way in only over a connection shown to record no bound parameters anywhere', () => {
  const flatProbe = probe.replace(/\s+/g, ' ');
  assert.match(flatProbe, /These are the server's own switches, and the server is not the only recorder/);
  assert.match(flatProbe, /\*\*send the value over SQL only when you can show that nothing on that connection records bound parameters\.\*\*/);
  assert.match(flatProbe, /Where you cannot show it — a layer you cannot inspect, a setting you cannot read or change — use the store's own interface, or place it by hand/);
  assert.match(procedureSteps(skill)[3], /SQL is the way in only over a connection shown to record no bound parameters anywhere/);
  const verification = section(skill, 'Verification').replace(/\s+/g, ' ');
  assert.match(verification, /the value was a bound parameter, over a connection shown to record no bound parameters anywhere/);
  assert.doesNotMatch(verification, /the server's parameter logging was read first/, 'the checklist treats the server switches as sufficient again');
});

// [P2] Ids are compared with their counts. The reference's own diff is run against fixtures.
test('delivery ids are reconciled as multisets: a repeated id is a mismatch', async () => {
  const raw = read('references/proving-no-other-caller.md');
  const line = raw.split('\n').map((text) => text.trim()).find((text) => text.startsWith('diff <(sort receiver-ids.txt'));
  assert.ok(line, 'the reference has no runnable id comparison');
  const compare = async (receiverIds, senderIds) => {
    const dir = await tempDir('rotate-ids-');
    writeFileSync(join(dir, 'receiver-ids.txt'), `${receiverIds.join('\n')}\n`);
    writeFileSync(join(dir, 'sender-ids.txt'), `${senderIds.join('\n')}\n`);
    const run = spawnSync('bash', ['-c', line], { cwd: dir, encoding: 'utf8' });
    return { status: run.status, matched: run.stdout.includes('ids match one to one') };
  };
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
