import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCatalogueShape, fenced, procedureSteps, readSkill, section } from './helpers/skill-contract.mjs';

const name = 'preregistered-model-study';
const loaded = readSkill(name);
const { skill, read, fit } = loaded;
const flat = skill.replace(/\s+/g, ' ');
const budget = read('references/budget-guard.md').replace(/\s+/g, ' ');
const parity = read('references/parity-and-controls.md').replace(/\s+/g, ' ');
const judging = read('references/judging-and-metrics.md').replace(/\s+/g, ' ');
const files = read('references/study-files.md').replace(/\s+/g, ' ');

// The order is the contract: a plan written after the calls, or parity proven after measuring,
// is exactly what produced the verdicts this skill exists to prevent.
const PROCEDURE_ORDER = [
  /^1\. \*\*Write the PLAN, and commit it before any paid call/,
  /^2\. \*\*FREEZE every input by hash/,
  /^3\. \*\*Build the budget guard in code, and arm it/,
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
  assert.match(steps[1], /read every metric's definition against a handful of real items/);
  assert.match(steps[3], /no paid call has been made/);
  assert.match(steps[3], /may differ from it only where the plan intends/);
  assert.match(steps[6], /each addendum's commit precedes the first call it governs/);
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

test('the budget guard has its five parts, and each is armed', () => {
  const guard = procedureSteps(skill)[2];
  assert.match(guard, /refused at start-up when it equals production's key/);
  assert.match(guard, /reserving before each call an upper bound on what it can be billed/);
  assert.match(guard, /at its maximum quantity and a ceiling price \(the largest of the list price, a stated margin over it, and the provider's maximum\)/);
  assert.match(guard, /No settlement can exceed its reservation/);
  assert.match(guard, /A cap checked after the call is a report, not a cap/);
  assert.match(guard, /\*\*A balance floor that latches, and that every admission respects\.\*\*[^*]*writes a STOP flag that every other process checks before each call, and admits nothing while any balance read is still in flight — applying the read's result, latch and flag, before it lets waiting calls through/);
  assert.match(guard, /Reads in flight are counted, so overlapping reads cannot release each other, and a read that fails latches like one below the floor/);
  assert.match(guard, /A lock that can go stale is taken over only on proof the owner is dead, or with a fencing token/);
  assert.match(guard, /the larger of the list-price cost and the provider-reported cost, summed/);
  assert.match(guard, /each of the five parts has been watched refusing/);
  // The reference carries the sketch and the arming table.
  assert.match(budget, /admit\(call\):/);
  assert.match(budget, /\| Part \| Mutation \| Expected \|/);
  assert.match(budget, /A later read that shows the balance recovered does not lift it/);
  assert.match(budget, /Make the takeover atomic/);
  assert.match(budget, /every reserved row with no settlement[^.]*counts at its worst case/);
});

// Review round 1: a reservation at list price was exceeded by a settlement at the reported price.
test('the reservation is an upper bound no settlement can exceed', () => {
  assert.match(budget, /ceiling_price\(u\) = max\(list_price\(u\), list_price\(u\) \* \(1 \+ margin\), provider_max_price\(u\)\)/);
  assert.match(budget, /worst_attempt = request_fee_ceiling \+ sum over every billable unit u of max_quantity\(u\) \* ceiling_price\(u\)/);
  assert.match(budget, /at every admission: spent \+ reserved \+ worst\(call\) <= cap/);
  assert.match(budget, /for every call: settled cost <= worst\(call\)/);
  assert.match(budget, /if actual > ticket\.worst:/);
  assert.doesNotMatch(budget, /using list prices from a price table frozen/, 'the reservation is priced at list again');
});

// Review round 1 (Codex): in_flight was cleared before the latch and STOP were set, an admission
// window. Blocks, on the fix: a boolean let one of two overlapping reads release the other, and a
// read that threw never cleared it, so every later admission waited for ever.
test('a balance read is applied before waiting admissions are released, on every path', () => {
  const raw = read('references/budget-guard.md');
  const block = raw.slice(raw.indexOf('check_balance():'), raw.indexOf('```', raw.indexOf('check_balance():')));
  const at = (text) => {
    const index = block.indexOf(text);
    assert.notEqual(index, -1, `check_balance() no longer contains: ${text}`);
    return index;
  };
  const counted = at('reads_in_flight += 1');
  const failClosed = at('verdict = "breach"');
  const attempt = at('try:');
  const always = at('finally:');
  const latch = at('latched = true');
  const stop = at('create STOP flag atomically');
  const released = at('reads_in_flight -= 1');
  const woken = at('wake every waiting admission');
  assert.ok(counted < failClosed && failClosed < attempt, 'a read is not presumed a breach until it succeeds');
  assert.ok(always < latch && always < released, 'the latch and the release are not on the path a failed read takes');
  assert.ok(latch < released && stop < released, 'the read is released before its verdict is applied');
  assert.ok(released < woken, 'waiters are woken before the read is released');
  assert.doesNotMatch(block, /\bin_flight = (?:true|false)/, 'a boolean flag is back, and overlapping reads release each other');
  assert.match(raw, /while floor_available and \(reads_in_flight > 0 or now - last_read_at > staleness_limit\):\s+wait/);
  assert.match(budget, /re-checks STOP and the latch/);
  assert.match(budget, /\*\*Reads in flight are counted, not flagged\.\*\*/);
  assert.match(budget, /\*\*A read that fails is a breach: fail closed\.\*\*/);
  assert.match(raw, /^\| Read failure \| stub the balance read to throw/m);
  assert.match(raw, /^\| Overlapping reads \| start two reads/m);
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

// Review round 2: a stale-lock takeover did not fence the owner it replaced, so a paused or
// partitioned owner could wake and admit paid calls against the same budget.
test('a takeover fences the old owner: a generation every admission and settlement checks', () => {
  const raw = read('references/budget-guard.md');
  const path = raw.slice(raw.indexOf('acquire():'), raw.indexOf('check_balance():'));
  const at = (text) => {
    const index = path.indexOf(text);
    assert.notEqual(index, -1, `the admission path no longer contains: ${text}`);
    return index;
  };
  at('my_gen = ledger.increment_generation()');
  at('reserved += r.worst; stage_reserved[r.stage] += r.worst');
  const fencedReserve = at('if not ledger.append_if_generation(my_gen, reserved row with s):');
  assert.ok(fencedReserve < at('reserved += w') && fencedReserve < at('return ticket'), 'the reservation is not fenced before the call is admitted');
  const fencedSettle = at('if not ledger.append_if_generation(my_gen, settled row, one per attempt):');
  assert.ok(fencedSettle < at('reserved -= ticket.worst; spent += actual'), 'a settlement is booked before its generation is checked');
  at('ledger.append(settled row, one per attempt, marked stale, my_gen)');
  assert.doesNotMatch(path, /reserved \+= w; ledger\.append\(reserved row\)/, 'an unfenced append is back');
  assert.match(budget, /\*\*A stale heartbeat is not a dead owner\.\*\*/);
  assert.match(budget, /\*\*proof the owner is dead\*\*/);
  assert.match(budget, /\*\*Prefer a lock the kernel releases\.\*\*/);
  assert.match(budget, /\*\*A fenced settlement is kept, never dropped\.\*\*/);
  for (const drill of ['| Paused owner |', '| Fenced settlement |', '| Reused process id |']) {
    assert.ok(raw.includes(drill), `the failure drills have no ${drill.trim()} row`);
  }
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
  assert.match(procedureSteps(skill)[1], /each arm's request parameters/);
  assert.match(procedureSteps(skill)[1], /every price table the budget guard reads/);
});

// Blocks on #101 (severity 8, twice): the floor was checked only by periodic reads, so a call that fit
// the study cap could cross it before the next read; and output parity's own cap was documented but
// admit checked only the study-wide cap.
test('every admission respects the floor and its stage cap, not only the study cap', () => {
  const raw = read('references/budget-guard.md');
  const admit = raw.slice(raw.indexOf('admit(call):'), raw.indexOf('settle(ticket, attempts):'));
  assert.match(admit, /if stage_spent\[s\] \+ stage_reserved\[s\] \+ w > stage_cap\[s\]: +refuse/);
  assert.match(admit, /if floor_available and w > headroom: +refuse/);
  assert.match(admit, /now - last_read_at > staleness_limit/);
  assert.match(admit, /reserved \+= w; stage_reserved\[s\] \+= w\n\s+if floor_available: +headroom -= w/);
  const check = raw.slice(raw.indexOf('check_balance():'));
  assert.match(check, /headroom = balance - floor - reserved - settled_since\(balance\)/);
  assert.match(budget, /\*\*The floor is part of every admission, not only of every read\.\*\*/);
  assert.match(budget, /\*\*Every stage has its own cap, enforced at admission\.\*\*/);
  assert.match(budget, /stage_spent\[s\] \+ stage_reserved\[s\] \+ worst\(call\) <= stage_cap\[s\]/);
  for (const drill of ['| Floor between reads |', '| Stale read |', '| Stage cap |']) {
    assert.ok(raw.includes(drill), `the failure drills have no ${drill.trim()} row`);
  }
  assert.match(procedureSteps(skill)[4], /the guard enforces that cap at every admission/);
});

// Blocks on #101 (severity 8): a restart or takeover restored reservations to the study's total only,
// not to their stage, so a stage could spend past its own cap after recovery.
test('a restart or takeover restores every total per stage as well as for the study', () => {
  const raw = read('references/budget-guard.md');
  const acquire = raw.slice(raw.indexOf('acquire():'), raw.indexOf('admit(call):'));
  assert.match(acquire, /stage_spent\[s\] = sum of settled rows of stage s, for every s/);
  assert.match(acquire, /reserved \+= r\.worst; stage_reserved\[r\.stage\] \+= r\.worst/);
  assert.match(acquire, /last_read_at = never/);
  assert.match(budget, /Persist both halves, with the stage on every row\./);
  assert.match(budget, /Restoring the study's total but not the stage's lets a stage spend past its cap after a restart/);
  assert.ok(raw.includes('| Stage cap after restart |'), 'no drill for a stage cap after a restart');
});

// Blocks on #101 (severity 8, twice): a provider with no balance endpoint deadlocked, because admission
// waited for a read that could never come; and two successful reads finishing out of order let the
// older one overwrite a newer, smaller headroom.
test('no balance endpoint means no wait, and a late read never overwrites a newer one', () => {
  const raw = read('references/budget-guard.md');
  const check = raw.slice(raw.indexOf('check_balance():'));
  assert.match(check, /read_seq \+= 1; my_read = read_seq/);
  assert.match(check, /else if my_read > applied_read:/);
  assert.match(check, /last_read_at = started_at/);
  assert.match(check, /applied_read = my_read/);
  assert.match(budget, /\`floor_available\` is false, so admission neither waits for a read nor checks a headroom/);
  assert.match(budget, /Two successful reads can also finish in the opposite order to the one they started in/);
  for (const drill of ['| No balance endpoint |', '| Reads out of order |']) assert.ok(raw.includes(drill), `no ${drill.trim()} drill`);
});
