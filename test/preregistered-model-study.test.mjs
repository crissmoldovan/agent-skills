import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCatalogueShape, fenced, prerequisiteItems, procedureSteps, readSkill, section } from './helpers/skill-contract.mjs';

const name = 'preregistered-model-study';
const loaded = readSkill(name);
const { skill, read, fit } = loaded;
const flat = skill.replace(/\s+/g, ' ');
const budget = read('references/budget-guard.md').replace(/\s+/g, ' ');
const parity = read('references/parity-and-controls.md').replace(/\s+/g, ' ');
const judging = read('references/judging-and-metrics.md').replace(/\s+/g, ' ');
const files = read('references/study-files.md').replace(/\s+/g, ' ');
const frontmatterOf = (source) => source.slice(0, source.indexOf('\n---\n', 4));

// The order is the contract: a plan written after the calls, or parity proven after measuring,
// is exactly what produced the verdicts this skill exists to prevent.
const PROCEDURE_ORDER = [
  /^1\. \*\*Write the PLAN, and commit it before any paid call/,
  /^2\. \*\*Build the budget guard in code, and arm it/,
  /^3\. \*\*FREEZE every input by hash/,
  /^4\. \*\*Prove request parity and dry-run every arm, offline, and commit it before any paid call/,
  /^5\. \*\*Prove output parity as the first paid stage, under its own pre-registered cap/,
  /^6\. \*\*Run, with the controls/,
  /^7\. \*\*Put every change after the first paid call in a dated ADDENDUM, committed before the calls it governs/,
  /^8\. \*\*Judge with three vendors, and let the judges see provenance/,
  /^9\. \*\*Score against the bars as registered, and report more than the bars/,
  /^10\. \*\*Make every number rebuildable offline/,
  /^11\. \*\*Arm every gate by mutation/,
  /^12\. \*\*Review every study pull request independently, and record corrections in the open/,
  /^13\. \*\*Write the report for the decision/,
];

test('preregistered-model-study carries the catalogue shape', () => {
  assertCatalogueShape(name, loaded);
  assert.equal(fit.kind, 'requestOnly');
});

test('the procedure runs its thirteen acts in order', () => {
  const steps = procedureSteps(skill);
  assert.equal(steps.length, PROCEDURE_ORDER.length, `expected ${PROCEDURE_ORDER.length} steps, found ${steps.length}`);
  PROCEDURE_ORDER.forEach((pattern, index) => assert.match(steps[index], pattern, `step ${index + 1} is not the expected act`));
});

test('the plan, the freeze and the dry run come before any paid call, and later changes are addenda', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[0], /no paid call in the repository's history predates it/);
  assert.match(steps[0], /\*\*point rule\*\*[\s\S]*\*\*interval rule\*\*/, 'a bar is not both a point and an interval rule');
  assert.match(steps[0], /\*\*Invention\*\*[^.]*answering where the truth cannot be determined/);
  assert.match(steps[0], /sample size comes with its reason/);
  assert.match(steps[2], /read every metric's definition against a handful of real items/);
  assert.match(steps[3], /no paid call has been made/);
  assert.match(steps[3], /may differ from it only where the plan intends/);
  assert.match(steps[6], /each one made before its calls was committed before the first call it governs/);
  assert.match(steps[6], /It is never backdated/);
  assert.match(steps[6], /A file cannot name the commit that adds it/);
});

// Review round 1: paid parity calls ran before the dry run was committed. Request parity is
// offline and belongs to the dry run; output parity is the first paid stage, with its own cap.
test('no step before output parity spends anything, and output parity is capped and registered first', () => {
  const steps = procedureSteps(skill);
  for (const [index, step] of steps.slice(0, 4).entries()) {
    assert.doesNotMatch(step, /\bRun the control\b|paid stage|first paid/, `step ${index + 1} spends before the dry run is committed`);
  }
  assert.match(steps[3], /Build — without sending —/);
  assert.match(steps[3], /The control's request must equal production's/);
  assert.match(steps[4], /Run the control arm alone/);
  assert.match(steps[4], /within its own cap, inside the study's/);
  assert.match(steps[4], /its plan committed before its first call/);
  assert.match(steps[0], /Output parity \(step 5\) is registered here as a stage of its own, with its items, its pass rule and its own cap/);
  assert.match(flat, /The first three are committed before any paid call\. The first paid calls are output parity's/);
  assert.match(parity, /\*\*Request parity is offline, and part of the dry run\.\*\*/);
  assert.match(parity, /\*\*Output parity is paid, and a stage of its own\.\*\* It runs only after the dry run is committed/);
  assert.match(files, /Output parity \(the first paid stage\):/);
});

// Review round 1: a file cannot contain the sha of the commit that adds it.
test('no study file is asked to name the commit that adds it', () => {
  assert.doesNotMatch(files, /commit that adds this file>/);
  assert.match(files, /"written_on": "<sha of the parent commit this file was written on>"/);
  assert.match(files, /A file cannot name the commit that adds it/);
  assert.match(files, /Written on: <sha of the parent commit>/);
  assert.doesNotMatch(files, /Applies from commit: <sha>/);
});

// Review round 1: a reservation at list price was exceeded by a settlement at the reported price.
test('the reservation is an upper bound no settlement can exceed', () => {
  assert.match(budget, /ceiling_price\(u\) = max\(list_price\(u\), list_price\(u\) \* \(1 \+ margin\), provider_max_price\(u\)\)/);
  assert.match(budget, /worst_attempt = request_fee_ceiling \+ sum over every billable unit u of max_quantity\(u\) \* ceiling_price\(u\)/);
  assert.match(budget, /at every admission: spent \+ reserved \+ worst\(call\) <= cap/);
  assert.match(budget, /for every call: settled cost <= worst\(call\)/);
  assert.match(budget, /if actual > w: +# the bound was not a bound/);
  assert.doesNotMatch(budget, /using list prices from a price table frozen/, 'the reservation is priced at list again');
});

test('parity is proven first, the provider is pinned, and the controls make a difference readable', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[3], /Pin the serving provider in every arm's request/);
  assert.match(steps[3], /a router may pick the provider by the request's layout/);
  assert.match(steps[4], /compare its answers with what production stored for them/);
  assert.match(steps[4], /Check the provider that served every call against the pin/);
  assert.match(steps[5], /\*\*An A\/A distribution, not a single draw\.\*\*/);
  assert.match(steps[5], /\*\*A layout-only control\*\*/);
  assert.match(steps[5], /\*\*Arms interleaved per item\.\*\*/);
  assert.match(steps[5], /\*\*The same inputs for every arm\.\*\*/);
  assert.match(parity, /layout effect = L - A/);
  assert.match(parity, /Never normalise array order/);
  assert.match(parity, /Sanity-check the control before trusting it/);
});

test('judges see provenance, are reported alone, and a shortcut is proven exact', () => {
  const judge = procedureSteps(skill)[7];
  assert.match(judge, /Three judges from three vendors; an item's verdict is the 2-of-3 majority/);
  assert.match(judge, /\*\*Tag the evidence with where it came from\.\*\*/);
  assert.match(judge, /source-only reading/);
  assert.match(judge, /A judge shown the same untagged evidence as the model cannot tell an invented fact from a sourced one/);
  assert.match(judge, /\*\*Report each judge alone\*\*/);
  assert.match(judge, /prove on a fixture that the shortcut gives exactly the verdicts that judging everything gives/);
  assert.match(judging, /\[model-guessed\]/);
  assert.match(judging, /would the verdict change if any one judge were removed/);
  assert.match(judging, /gives the \*\*difference\*\* between arms exactly — and gives no absolute rate at all/);
  assert.match(judging, /deterministic stand-in judge/);
});

test('metrics: invention is a bar, denominators match, predicates are stated, passing is not better', () => {
  const score = procedureSteps(skill)[8];
  assert.match(score, /Invention is reported against its own bar/);
  assert.match(score, /Denominators match across arms/);
  assert.match(score, /Every percentage carries its predicate beside it/);
  assert.match(score, /\*\*Passing the bar is not being better\.\*\*/);
  assert.match(score, /quality, the harm and the cost/);
  assert.match(judging, /A "no" on a field that does not apply/);
});

test('every number is rebuilt offline from manifest-checked inputs, and every gate is armed', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[9], /`reproduce\.sh` rebuilds every table and figure from committed data, with no network and no key/);
  assert.match(steps[9], /including files read from other studies/);
  assert.match(steps[9], /share a name with a standard-library module or with another study's module/);
  assert.match(steps[10], /Tamper with one row of raw data; remove one manifest line; mutate one scorer rule/);
  assert.match(steps[10], /Restore from a byte copy taken before the mutation, never from version control/);
  assert.match(steps[11], /`codex-review-loop`/);
  assert.match(steps[11], /never repaired silently in place/);
  assert.match(files, /shasum -a 256 --check --quiet MANIFEST\.sha256/);
  assert.match(files, /refuses a path the manifest does not list/);
});

test('the examples are asks and runnable commands, and the specimen states its predicate', () => {
  const examples = section(skill, 'Usage Examples');
  assert.ok(fenced(examples, 'text').length >= 3, 'expected at least three asks');
  const bash = fenced(examples, 'bash').join('\n');
  assert.match(bash, /\.\/reproduce\.sh/);
  assert.match(bash, /cp MANIFEST\.sha256 MANIFEST\.sha256\.bak/, 'the mutation is not taken from a byte copy');
  assert.doesNotMatch(bash, /git (?:checkout|restore|stash)/, 'a mutation is restored from version control');
  const specimen = section(skill, 'What it looks like');
  assert.match(specimen, /predicate:/);
  assert.match(specimen, /95% interval/);
  assert.match(specimen, /each judge alone/);
  assert.match(specimen, /A\/A distribution \(<k> baseline runs, paired resampling\)/);
  assert.match(flat, /The first three are committed before any paid call/);
});

// Review round 2: worst(call) counted tokens only; a call can also be billed per request, per image,
// per second of audio, per hosted search and per tool invocation.
test('the reservation bounds every billable unit, and a unit with no bound is not admitted', () => {
  const raw = read('references/budget-guard.md');
  assert.match(budget, /\*\*Every billable unit, not only tokens\.\*\*/);
  for (const unit of ['a fee per request', 'images in and out', 'audio in and out', 'hosted search or web queries', 'tool invocations']) {
    assert.ok(budget.includes(unit), `the billable units no longer include ${unit}`);
  }
  assert.match(budget, /\*\*Every unit has a bound, or the call is not admitted\.\*\*/);
  assert.match(raw, /if w is unbounded: +refuse/);
  for (const drill of ['| Unbounded unit |', '| Unlisted unit |']) assert.ok(raw.includes(drill), `no ${drill.trim()} drill`);
  assert.match(budget, /`list_cost` uses every billable unit the provider reported/);
});

// Review round 2: one A/A pair was used as a hard noise floor.
test('the noise is an estimated A/A distribution; a single A/A pair is a diagnostic, not a veto', () => {
  const sixth = procedureSteps(skill)[5];
  assert.match(sixth, /Run the baseline arm several times over the same items, or resample paired item-level differences between baseline runs/);
  assert.match(sixth, /A single A\/A comparison is a diagnostic, able to show that the harness is unstable, but never a floor and never a veto/);
  assert.match(sixth, /the A\/A distribution is estimated with its interval and its method/);
  assert.doesNotMatch(skill, /Run the baseline arm twice over the same items/);
  assert.match(parity, /## The A\/A distribution/);
  assert.match(parity, /\*\*Repeated runs\.\*\*/);
  assert.match(parity, /\*\*Paired resampling\.\*\*/);
  assert.match(parity, /It is not a floor, and it vetoes nothing/);
  assert.doesNotMatch(parity, /is the noise floor\./);
  assert.match(files, /A1\.\.Ak +A run <k> times over the same items, for the A\/A distribution/);
});

// Blocks, on the split PR: the FREEZE template hashed neither each arm's parameters nor the price
// tables the guard reads, so either could change after preregistration under a complete-looking freeze.
test('the freeze hashes each arm\'s parameters and every price table the guard reads', () => {
  const raw = read('references/study-files.md');
  const freeze = raw.slice(raw.indexOf('## FREEZE'), raw.indexOf('## ADDENDUM'));
  assert.match(freeze, /"params": \[\{ "arm": "A", "file": "params\/a\.json", "sha256": "<hash>" \}\]/);
  assert.match(freeze, /"price_tables": \[\{ "file": "prices\/<provider>\.json", "sha256": "<hash>"/);
  assert.match(freeze.replace(/\s+/g, ' '), /Every price table the guard reads is hashed/);
  assert.match(procedureSteps(skill)[2], /each arm's request parameters/);
  assert.match(procedureSteps(skill)[2], /every price table the budget guard reads/);
});

// Cut-down (#101): the guard is single-threaded. Each property it keeps is held here and armed by
// mutation; the concurrent design — fencing, takeover, overlapping reads — is a separate extension.
const guardDoc = read('references/budget-guard.md');
const guardPath = guardDoc.slice(guardDoc.indexOf('start():'), guardDoc.indexOf('\n```', guardDoc.indexOf('start():')));
const callPath = guardPath.slice(guardPath.indexOf('call(c):'));
const position = (text) => {
  const at = callPath.indexOf(text);
  assert.notEqual(at, -1, `call(c) no longer contains: ${text}`);
  return at;
};

test('the guard is single-threaded: one process holding an OS lock, one call at a time, concurrency out of scope', () => {
  const guardStep = procedureSteps(skill)[1];
  assert.match(guardStep, /\*\*One paying process, one call at a time\.\*\*/);
  assert.match(guardStep, /an exclusive lock the kernel releases when it exits or dies — `flock` or its equivalent — for the whole run/);
  assert.match(guardStep, /The cap is hard only under this rule\./);
  assert.match(guardStep, /Concurrency is out of scope/);
  assert.match(guardStep, /refused at start-up when it equals production's key/);
  assert.match(budget, /## Scope: one paying process, one call at a time/);
  assert.match(budget, /The cap is hard only under that rule\./);
  assert.match(budget, /Concurrency is out of scope: calls in parallel inside the process, two paying processes, balance reads running alongside calls, locks on shared storage or across hosts, and taking over another process's lock/);
  assert.match(guardPath, /take the OS lock on <study>\/guard\.lock without waiting/);
  for (const drill of ['| Lock |', '| Lock released on death |']) assert.ok(guardDoc.includes(drill), `no ${drill.trim()} drill`);
});

test('no concurrent mechanism is left in the admission path', () => {
  for (const term of [/generation/, /reads_in_flight/, /headroom/, /staleness/, /\bwait\b/, /applied_read/, /takeover/]) {
    assert.doesNotMatch(guardPath, term, `the single-threaded admission path still carries ${term}`);
  }
});

test('the cap and the stage cap are checked before every call, against its full worst case', () => {
  const cap = position('if spent + reserved + w > cap:');
  const stageCap = position('if stage_spent[s] + stage_reserved[s] + w > stage_cap[s]:');
  const reserve = position('ledger.append(reserved row: c, s, w); flush');
  const send = position('attempts = send c');
  assert.ok(cap < reserve && stageCap < reserve && reserve < send, 'a cap is checked after the reservation, or the call is sent before it is reserved');
  assert.match(callPath, /if w is unbounded: +refuse/);
  assert.match(procedureSteps(skill)[1], /A call is admitted only while `spent \+ reserved \+ worst <= cap`, and while its stage — output parity, the main run, judging — stays within its own pre-registered cap too/);
  for (const drill of ['| Cap |', '| Stage cap |']) assert.ok(guardDoc.includes(drill), `no ${drill.trim()} drill`);
});

test('the balance is read before every admission, and the floor latches', () => {
  const read = position('balance = read balance');
  const test = position('if the read failed or balance - unseen_spend - reserved - w < floor:');
  const latch = position('latched = true; write STOP flag with the reason;  refuse');
  const reserve = position('ledger.append(reserved row: c, s, w); flush');
  assert.ok(read < test && test < latch && latch < reserve, 'the floor is not settled before the call is reserved');
  assert.match(callPath, /^\s+if latched: +refuse/m);
  assert.match(budget, /A later read that shows the balance recovered does not lift it/);
  assert.match(budget, /\*\*A read that fails is a breach\.\*\*/);
  // Blocks on #101 (severity 8): an unknown-outcome reservation was left out of the floor test.
  assert.match(budget, /`reserved` is every reservation still standing: a call whose outcome is unknown \(part 5\), or one a crashed run left unsettled \(part 6\), may have been billed without the balance showing it/);
  assert.ok(guardDoc.includes('| Floor with an unknown call |'), 'no drill for the floor with an unknown call');
  assert.match(procedureSteps(skill)[1], /A read below that, or a read that fails, latches the run and writes a STOP flag with the reason/);
  assert.match(procedureSteps(skill)[1], /less any settled spend it may not show yet and every reservation still standing, stays at or above the floor/);
  for (const drill of ['| Floor |', '| Floor crossing |', '| Read failure |', '| No balance endpoint |']) {
    assert.ok(guardDoc.includes(drill), `no ${drill.trim()} drill`);
  }
});

test('a settlement above its reservation latches, and every row is on disk before the next admission', () => {
  const send = position('attempts = send c');
  const settled = position('ledger.append(settled rows: s, one per attempt); flush');
  const over = position('if actual > w:');
  const overLatch = callPath.indexOf('latched = true; write STOP flag with the reason', over);
  assert.ok(send < settled && settled < over && over < overLatch, 'the settlement is not written, or not checked against its reservation');
  assert.match(procedureSteps(skill)[1], /A settled cost above its reservation latches, writes STOP and closes the ledger: continuing takes an addendum and a new ledger/);
  assert.ok(guardDoc.includes('| Settlement above the reservation |'), 'no settlement drill');
});

test('a restart restores the study and every stage from the ledger, unsettled reservations at their worst case', () => {
  const start = guardPath.slice(0, guardPath.indexOf('call(c):'));
  assert.match(start, /spent, stage_spent\[s\] += sums of the settled rows/);
  assert.match(start, /reserved, stage_reserved\[s\] = worst cases of reservations with no settlement/);
  assert.match(start, /if STOP flag exists or the ledger records a latch: refuse/);
  assert.match(budget, /Restoring the study's total but not the stage's lets a stage spend past its cap/);
  assert.match(procedureSteps(skill)[1], /\*\*Restart by re-deriving every invariant from the ledger\.\*\*/);
  assert.ok(guardDoc.includes('| Restart |'), 'no restart drill');
});

// Blocks on #101 (severity 8): a thrown provider call skipped settlement and was never counted in
// memory, so a harness that caught the error could admit the next call past the caps.
test('a call that throws keeps its worst case reserved; nothing releases it but a person', () => {
  const reserve = position('ledger.append(reserved row: c, s, w); flush');
  const counted = position('reserved += w; stage_reserved[s] += w');
  const attempt = position('try:');
  const thrown = position('except any error:');
  const unknown = position('ledger.append(unknown-outcome row: c, s); flush');
  const reraise = position('raise');
  const released = position('reserved -= w; stage_reserved[s] -= w');
  const settled = position('ledger.append(settled rows: s, one per attempt); flush');
  assert.ok(reserve < counted && counted < attempt, 'the reservation is not counted in memory before the call is sent');
  assert.ok(thrown < unknown && unknown < reraise, 'a thrown call is not recorded as unknown-outcome');
  assert.ok(reraise < settled && settled < released, 'the reservation is released before the call is settled');
  assert.match(budget, /Its reservation stays counted at its worst case, in memory and through an unknown-outcome row in the ledger, and the guard never releases it/);
  assert.ok(guardDoc.includes('| Thrown call |'), 'no drill for a thrown call');
});

// Codex round 3 on #101: start() restored the totals and trusted them. A run that died after
// flushing a settlement above its reservation, and before writing the latch it earned, resumed
// unlatched; so did a reconciliation above the worst case. Start-up re-derives every invariant.
test('a restart re-derives every invariant from the ledger before it admits a call', () => {
  const start = guardPath.slice(0, guardPath.indexOf('call(c):'));
  const at = (text) => {
    const index = start.indexOf(text);
    assert.notEqual(index, -1, `start() no longer contains: ${text}`);
    return index;
  };
  const restored = at('spent, stage_spent[s]       = sums of the settled rows');
  const perCall = at('for every settled call in the ledger:');
  const overSettled = at('if its settled cost > its reservation, or it has no reservation:');
  const overLatch = start.indexOf('latched = true; write STOP flag with the reason', overSettled);
  const caps = at('if spent + reserved > cap, or stage_spent[s] + stage_reserved[s] > stage_cap[s] for any s:');
  const capLatch = start.indexOf('latched = true; write STOP flag with the reason', caps);
  const refuse = at('if STOP flag exists or the ledger records a latch: refuse');
  assert.ok(restored < perCall && perCall < overSettled && overSettled < overLatch && overLatch < caps, 'the settlements are not rechecked against their reservations after the totals are restored');
  assert.ok(caps < capLatch && capLatch < refuse, 'a breach found at start-up does not latch before the refusal check');
  assert.match(budget, /### 6\. A restart re-derives every invariant from the ledger/);
  assert.match(budget, /\*\*Every settled call is checked against its reservation again\.\*\* A run can die after flushing a settlement above its reservation and before writing the latch it earned, and a person's reconciliation of an unknown call can record more than its worst case/);
  assert.match(budget, /A reconciliation therefore takes effect only at the next start, which checks it like any other settlement/);
  assert.ok(guardDoc.includes('| Restart after an over-settlement |'), 'no drill for a restart after an over-settlement');
  assert.match(procedureSteps(skill)[1], /checks every settled call against its reservation again — a run can die between a settlement and the latch it earned — and every total against its cap, latching on a breach/);
  assert.match(procedureSteps(skill)[1], /Write a settlement above its reservation with no latch, restart, and watch it latch/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /rechecked every settled call against its reservation and every total against its cap before admitting anything/);
  // Codex round 4 on #101: the recheck finds a historical over-settlement on every start, so
  // clearing STOP could never resume. A broken bound closes the ledger; continuing is a new one.
  assert.match(budget, /\*\*A broken bound closes the ledger for good\.\*\* A settlement above its reservation, or a total above its cap, stays in the ledger, so every later start finds it again and refuses: clearing STOP does not resume that ledger/);
  assert.match(budget, /Continuing the study takes a dated addendum that corrects the bound and re-freezes what it changed, and a new, empty ledger\. Its caps are what the old caps had left after everything the closed ledger settled, per stage, with that ledger's unsettled calls reconciled first/);
  assert.match(budget, /the guard latches, writes STOP and closes the ledger \(part 6\)/);
  assert.doesNotMatch(budget, /the study stops until the bound is corrected in an addendum/, 'an over-settlement is resumable again');
  assert.match(guardDoc, /\| Restart after an over-settlement \|[^\n]*clearing STOP and starting again refuses again \|/);
});

// Codex round 3 on #101: a client library that retries on its own and returns only the last
// attempt hides billed attempts from settlement. Codex round 4: the capped-library path still
// settled from what the library returned. One option is left, and it fails closed: retries off.
test('the client library\'s own retries are off, and the guard refuses to start otherwise', () => {
  assert.match(budget, /\*\*The attempts are every attempt the harness makes, and only those\.\*\*/);
  assert.match(budget, /So the library's own retries are off, and the guard refuses to start while they are on\. A library whose retries cannot be turned off cannot be used for paid calls/);
  for (const gone of [/cap them in the library's configuration/, /settle the call from the provider's own per-request records/, /retries the provider's client library makes on its own, and a failed attempt/]) {
    assert.doesNotMatch(budget, gone, `a library-retry path is back: ${gone}`);
  }
  const start = guardPath.slice(0, guardPath.indexOf('call(c):'));
  assert.match(start, /refuse if the client library retries on its own/);
  assert.doesNotMatch(start, /max_attempts/, 'start() admits a capped library retry again');
  assert.match(guardDoc, /\| Hidden retry \| turn the client library's own retries on, at any limit, then start the run \| refuses at start-up \|/);
  assert.ok(guardDoc.includes('| Harness retry |'), 'no harness retry drill');
  for (const drill of ['| Capped library retry |', '| Library retry past the reservation |']) assert.ok(!guardDoc.includes(drill), `the ${drill.trim()} path is back`);
  assert.match(procedureSteps(skill)[1], /for every attempt it may make; the client library's own retries are off, or the guard refuses to start/);
  assert.doesNotMatch(skill, /per-request records/, 'SKILL.md offers the provider-record path again');
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /for every attempt, the client library's own retries off — and checked the study cap/);
});

// Codex round 3 on #101: FREEZE hashed the scorer alone, so the request harness, the budget guard
// and the judge runner could change after the dry run under a complete-looking freeze; and nothing
// pinned the runtime or the dependencies reproduce.sh runs under.
test('the freeze hashes every executable and configuration that can change a request, a spend or a verdict, and the runtime', () => {
  const raw = read('references/study-files.md');
  const freeze = raw.slice(raw.indexOf('## FREEZE'), raw.indexOf('## ADDENDUM'));
  for (const file of ['code/harness.<ext>', 'code/guard.<ext>', 'code/judge.<ext>', 'code/score.<ext>', 'reproduce.sh']) {
    assert.ok(freeze.includes(`{ "file": "${file}", "sha256": "<hash>" }`), `the freeze no longer hashes ${file}`);
  }
  assert.match(freeze, /"config": \[\{ "file": "config\/<name>", "sha256": "<hash>" \}\]/);
  assert.match(freeze, /"runtime": \{ "name": "<runtime>", "version": "<exact version>", "lock": \{ "file": "<lock file>", "sha256": "<hash>" \} \}/);
  assert.match(freeze.replace(/\s+/g, ' '), /\*\*every executable and every configuration that can change a request, a spend decision or a verdict\*\*/);
  assert.match(procedureSteps(skill)[2], /every executable and configuration that can change a request, a spend decision or a verdict — harness, the guard armed in step 2, judge runner, scorer, `reproduce\.sh` — with the runtime's version and the dependency lock/);
  assert.match(procedureSteps(skill)[2], /every file of code and configuration it runs, has a hash in the committed freeze/);
  assert.doesNotMatch(procedureSteps(skill)[2], /; the scorer code\./, 'step 3 freezes the scorer alone again');
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /The freeze hashes every executable and configuration that can change a request, a spend decision or a verdict, with the runtime's version and the dependency lock/);
  // Codex round 4 on #101: the freeze hashed a guard step 3 had not built yet. The guard is built
  // and armed first, its stubs restored, and only then frozen.
  assert.match(procedureSteps(skill)[1], /^2\. \*\*Build the budget guard in code, and arm it before it guards anything\.\*\*/);
  assert.match(procedureSteps(skill)[2], /^3\. \*\*FREEZE every input by hash\.\*\*/);
  assert.match(procedureSteps(skill)[1], /\*\*Complete when:\*\* each part has been watched refusing, every stub is restored before the freeze/);
  assert.match(files, /The freeze is taken after the budget guard is built and armed, so that the guard it hashes is the one that runs/);
  assert.match(files, /An addendum that changes a frozen file updates that file's entry in FREEZE\.json in the same commit, and records the old hash/);
});

// Codex round 4 on #101: deleting the lock's manifest row passed `shasum --check`, and the lock was
// installed unverified. Frozen files are checked against FREEZE.json itself, and each must have a row.
test('reproduce.sh checks every frozen file and the runtime against the freeze itself before it installs or computes', () => {
  const raw = read('references/study-files.md');
  const script = fenced(raw.slice(raw.indexOf('## reproduce.sh')), 'bash')[0];
  const at = (text) => {
    const index = script.indexOf(text);
    assert.notEqual(index, -1, `reproduce.sh no longer contains: ${text}`);
    return index;
  };
  const frozen = at('<each "file" and "sha256" pair in FREEZE.json, printed as "<sha256>  <file>"> | shasum -a 256 --check --quiet');
  const member = at('<each "file" in FREEZE.json has a row in MANIFEST.sha256, or exit 1>');
  const runtime = at('test "$(<runtime> --version)" = "<exact version from FREEZE.json>" || { echo "runtime is not the frozen one" >&2; exit 1; }');
  const manifest = at('shasum -a 256 --check --quiet MANIFEST.sha256');
  const install = at('<install the dependencies from the lock file only, from a vendored copy or a local cache, offline>');
  const compute = at('<runtime> code/score.<ext>');
  assert.ok(frozen < member && member < runtime && runtime < manifest && manifest < install && install < compute, 'reproduce.sh installs or computes before the freeze and the manifest are checked');
  assert.match(script.replace(/\n#\s*/g, ' ').replace(/\s+/g, ' '), /This reads the freeze, not the manifest, so a deleted manifest row stops the run here/);
  assert.match(files, /a byte-identical rebuild needs both pinned/);
  assert.match(files, /dependencies installed only from the lock the freeze hashes/);
  assert.match(procedureSteps(skill)[9], /the script checks every frozen file and the runtime against the freeze itself, then the manifest, before it computes anything/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /from a clean checkout, under the frozen runtime and dependency lock/);
});

// Codex round 3 on #101: production requests and responses were to be committed in the clear,
// with nothing asking first what they carry.
test('the data is classified before anything carrying it is committed', () => {
  const items = prerequisiteItems(skill);
  const classified = items.find((item) => /^\d+\. \*\*The data classified\.\*\*/.test(item));
  assert.ok(classified, 'no prerequisite classifies the data');
  assert.match(classified, /Wherever this skill says \*committed\*, it means as the class allows: in the clear, or in approved private or encrypted storage with its hash committed in its place/);
  assert.match(classified, /\*\*Complete when:\*\* the plan names the data's class and where each artefact carrying it is kept/);
  assert.match(items.find((item) => /^4\. /.test(item)), /committed, as prerequisite 7 allows/);
  assert.match(section(skill, 'Verification').replace(/\s+/g, ' '), /The data was classified, and every artefact carrying it is kept where its class allows/);
  assert.match(files, /the manifest lists the private copies by hash/);
});

// Codex round 3 on #101: three checklist lines demanded more than the procedure allows, so a
// study following the procedure could never pass its own verification. Each pair is held here.
test('the checklist allows exactly what the procedure allows', () => {
  const steps = procedureSteps(skill);
  const checklist = section(skill, 'Verification').replace(/\s+/g, ' ');
  const budgetItem = prerequisiteItems(skill).find((item) => /^6\. /.test(item));
  // No balance endpoint: the compatibility line, the floor rule and the prerequisite all allow it.
  assert.match(frontmatterOf(skill), /without one the floor is recorded as unavailable/);
  assert.match(steps[1], /With no balance endpoint, the plan says the floor is unavailable/);
  assert.match(budgetItem, /the floor recorded as unavailable/);
  assert.match(budgetItem, /\*\*Complete when:\*\* the cap is a number someone agreed to, and the floor is one too or is recorded as unavailable/);
  assert.doesNotMatch(budgetItem, /both are numbers someone agreed to/, 'the prerequisite demands a numeric floor again');
  assert.match(checklist, /where none exists, the plan records the floor as unavailable/);
  // A change found after its calls ran is a correction, never backdated.
  assert.match(steps[6], /A change discovered after its calls ran is recorded as a correction to those calls\. It is never backdated\./);
  assert.match(steps[6], /each found after them is marked as a correction to them, never backdated/);
  assert.match(checklist, /one made before its calls was committed before them; one found after them is marked as a correction, never backdated/);
  assert.doesNotMatch(checklist, /has a dated addendum committed before the calls it governs\./, 'the checklist requires every addendum to predate its calls again');
  // The judging shortcut: only the items where the arms differ are judged.
  assert.match(steps[7], /\*\*Judge only where the arms differ\*\*/);
  assert.match(steps[7], /every item — or, under a shortcut the plan registered, every item where the arms differ — has three raw judge verdicts/);
  assert.match(checklist, /scored every item — or, under a shortcut the plan registered, every item where the arms differ, with absolute rates reported as not measured/);
  assert.doesNotMatch(checklist, /Three judges from three vendors scored every item;/, 'the checklist requires every item judged under the shortcut again');
});
