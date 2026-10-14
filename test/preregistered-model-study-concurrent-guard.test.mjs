import assert from 'node:assert/strict';
import test from 'node:test';
import { readSkill } from './helpers/skill-contract.mjs';

// The concurrent budget guard is a draft, later extension of preregistered-model-study: fencing,
// takeover, balance reads in flight and overlapping, and a headroom kept between reads. These are the
// tests that held it on #101 before the shipped guard was cut down to one process and one call at a
// time; they now hold the extension's own reference, references/concurrent-guard.md.
const { skill, read } = readSkill('preregistered-model-study');
const budget = read('references/concurrent-guard.md').replace(/\s+/g, ' ');

test('the concurrent guard is marked a draft extension, and the skill links it as one', () => {
  assert.match(budget, /\*\*Status: a draft extension, not part of the shipped guard\.\*\*/);
  assert.match(skill, /\[A concurrent budget guard\]\(references\/concurrent-guard\.md\): a draft, later extension/);
});

test('a balance read is applied before waiting admissions are released, on every path', () => {
  const raw = read('references/concurrent-guard.md');
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


test('a takeover fences the old owner: a generation every admission and settlement checks', () => {
  const raw = read('references/concurrent-guard.md');
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


test('every admission respects the floor and its stage cap, not only the study cap', () => {
  const raw = read('references/concurrent-guard.md');
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
});


test('a restart or takeover restores every total per stage as well as for the study', () => {
  const raw = read('references/concurrent-guard.md');
  const acquire = raw.slice(raw.indexOf('acquire():'), raw.indexOf('admit(call):'));
  assert.match(acquire, /stage_spent\[s\] = sum of settled rows of stage s, for every s/);
  assert.match(acquire, /reserved \+= r\.worst; stage_reserved\[r\.stage\] \+= r\.worst/);
  assert.match(acquire, /last_read_at = never/);
  assert.match(budget, /Persist both halves, with the stage on every row\./);
  assert.match(budget, /Restoring the study's total but not the stage's lets a stage spend past its cap after a restart/);
  assert.ok(raw.includes('| Stage cap after restart |'), 'no drill for a stage cap after a restart');
});


test('no balance endpoint means no wait, and a late read never overwrites a newer one', () => {
  const raw = read('references/concurrent-guard.md');
  const check = raw.slice(raw.indexOf('check_balance():'));
  assert.match(check, /read_seq \+= 1; my_read = read_seq/);
  assert.match(check, /else if my_read > applied_read:/);
  assert.match(check, /last_read_at = started_at/);
  assert.match(check, /applied_read = my_read/);
  assert.match(budget, /\`floor_available\` is false, so admission neither waits for a read nor checks a headroom/);
  assert.match(budget, /Two successful reads can also finish in the opposite order to the one they started in/);
  for (const drill of ['| No balance endpoint |', '| Reads out of order |']) assert.ok(raw.includes(drill), `no ${drill.trim()} drill`);
});

