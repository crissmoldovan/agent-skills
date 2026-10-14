import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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

// [P1] Behind a load balancer, one probe reaches one backend.
test('backends that cannot be addressed one by one leave the retirement UNVERIFIED without evidence for every backend', () => {
  const eighth = procedureSteps(skill)[7];
  assert.match(eighth, /a probe through the live domain reaches one backend and says nothing of the rest: the retirement stays \*\*UNVERIFIED\*\* unless deployment evidence shows every backend on the new configuration/);
  assert.match(eighth, /or the probes are shown to have reached every backend, by answers that identify the backend that gave them/);
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
