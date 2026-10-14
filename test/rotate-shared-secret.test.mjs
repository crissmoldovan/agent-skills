import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.match(flatProbe, /\*\*Check what the server logs before you send it\.\*\*/);
  assert.match(flatProbe, /unless `log_parameter_max_length` is 0/);
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
  assert.match(steps[7], /record the retirement as \*\*UNVERIFIED\*\*, with the reason, and do not write that the old key is refused/);
  assert.match(steps[7], /the new key accepted and the old key, the wrong key and the missing key refused, each with its status code — or the retirement recorded as UNVERIFIED/);
  assert.match(steps[5], /keep a private copy of the old key for step 8/);
  assert.doesNotMatch(steps[5], /From this deploy on, the old key is refused\./, 'step 6 claims the refusal that only step 8 can show');
  assert.doesNotMatch(skill, /if you still hold it/i, 'the old-key probe is optional again');
  const bash = fenced(section(skill, 'Usage Examples'), 'bash').join('\n');
  assert.match(bash, /-w 'old key: %\{http_code\}\\n' -H @"\$SCRATCH\/old\.hdr"/);
  assert.match(bash, /^rm -f [^\n]*"\$SCRATCH\/old\.key"[^\n]*"\$SCRATCH\/old\.hdr"/m);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /the new key was accepted, and the old key, a wrong key and no key were refused — or the retirement is recorded as UNVERIFIED/);
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
