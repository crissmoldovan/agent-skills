import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const skillDirectory = fileURLToPath(new URL('skills/report-progress/', root));

// A missing SKILL.md must surface as a readable assertion in every test below,
// not as one module-load stack trace that hides which contract terms are unmet.
async function readOrEmpty(path) {
  try {
    return await readFile(new URL(path, root), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

const skill = await readOrEmpty('skills/report-progress/SKILL.md');
const lifecycle = await readOrEmpty('skills/agent-lifecycle/SKILL.md');

// Prose is hard-wrapped in this pack, so a sentence-level assertion is made against a
// whitespace-collapsed copy: reflowing a paragraph is allowed, losing the sentence is not.
const flat = skill.replace(/\s+/g, ' ');

function descriptionOf(source) {
  const match = source.match(/^description:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\n]+?))[ \t]*$/m);
  return match ? (match[1] ?? match[2] ?? match[3]) : '';
}

function frontmatterField(source, key) {
  const match = source.match(new RegExp(`^${key}:[ \\t]*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\n]+?))[ \\t]*$`, 'm'));
  return match ? (match[1] ?? match[2] ?? match[3]) : '';
}

// Mirrors scripts/verify-skills.mjs: the cap applies to the body, not the file.
function bodyLineCount(source) {
  if (!source.startsWith('---\n')) return source.split('\n').length;
  const close = source.indexOf('\n---\n', 4);
  if (close < 0) return source.split('\n').length;
  const body = source.slice(close + 5);
  if (body === '') return 0;
  return body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
}

function section(source, heading) {
  const start = source.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing ## ${heading}`);
  const rest = source.slice(start + heading.length + 3);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

function subsection(source, heading) {
  const start = source.indexOf(`### ${heading}`);
  assert.notEqual(start, -1, `missing ### ${heading}`);
  const rest = source.slice(start + heading.length + 4);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

// The five rules are the skill's substance. Each is asserted by its exact published
// name, because a rewording that loosens one ("prefer verified numbers") is precisely
// the silent drift this file exists to catch.
const FIVE_RULES = [
  'Verified and claimed are different words',
  'Report state, not activity',
  'Name the user-facing consequence, not the code change',
  'Corrections are first-class and plain',
  'Nothing-to-report is a valid report; invention never is',
];

test('report-progress is a discoverable skill within the catalogue field limits', () => {
  assert.ok(skill, 'skills/report-progress/SKILL.md does not exist');
  assert.match(skill, /^---\nname: report-progress\n/);
  const description = descriptionOf(skill);
  assert.ok(description.length > 0, 'frontmatter description missing');
  assert.ok([...description].length <= 1024, 'description exceeds the 1024-character limit');
  const compatibility = frontmatterField(skill, 'compatibility');
  assert.ok([...compatibility].length <= 500, 'compatibility exceeds the 500-character limit');
  assert.ok(bodyLineCount(skill) <= 484, `body is ${bodyLineCount(skill)} lines; the cap is 484`);
});

test('report-progress keeps the pack section order', () => {
  const order = ['## When to Use', '## Prerequisites', '## Procedure', '## Usage Examples', '## Pitfalls', '## Verification'];
  let previous = -1;
  for (const heading of order) {
    const at = skill.indexOf(heading);
    assert.notEqual(at, -1, `missing ${heading}`);
    assert.ok(at > previous, `${heading} is out of order`);
    previous = at;
  }
});

test('every procedure step states when it is complete', () => {
  const procedure = section(skill, 'Procedure');
  const steps = procedure.split(/\n(?=\d+\. )/).filter((chunk) => /^\d+\. /.test(chunk.trim()));
  assert.ok(steps.length >= 6, `expected a numbered procedure, found ${steps.length} steps`);
  for (const step of steps) {
    const label = step.trim().split('\n')[0].slice(0, 60);
    assert.ok(step.includes('**Complete when:**'), `procedure step has no completion clause: ${label}`);
  }
});

test('all five reporting rules are present by name', () => {
  for (const rule of FIVE_RULES) {
    assert.ok(flat.includes(rule), `missing rule: ${rule}`);
  }
  // The rules must be numbered so the worked examples and pitfalls can cite them.
  for (let index = 1; index <= 5; index += 1) {
    assert.match(skill, new RegExp(`rule ${index}\\b`), `nothing cites rule ${index}`);
  }
});

test('the skill is honest that instructions cannot enforce anything at runtime', () => {
  assert.ok(flat.includes('A skill is instructions'), 'the scope limit is not stated');
  assert.match(flat, /cannot make a model do anything/);
  assert.match(flat, /no ambiguity about what was owed/);
  assert.match(flat, /no way to claim compliance without/);
  // Overclaiming a runtime guarantee would be the same failure the skill forbids.
  assert.doesNotMatch(skill, /\b(?:guarantees|ensures|enforces at runtime|makes the agent|forces the agent|forces the model)\b/i);
});

test('"what is running" is sourced from agent-lifecycle, with its exact fallback sentence', () => {
  const fallback = lifecycle.match(/state exactly:\s*\n`([^`]+)`/);
  assert.ok(fallback, 'agent-lifecycle no longer publishes an exact no-evidence sentence');
  const sentence = fallback[1];
  assert.ok(sentence.length > 20, 'the extracted lifecycle sentence looks wrong');
  assert.ok(skill.includes('agent-lifecycle'), 'the lifecycle composition is not named');
  assert.ok(skill.includes(sentence), `report-progress must carry the lifecycle sentence verbatim: ${sentence}`);
  assert.match(skill, /lifecycle evidence/);
});

test('the trigger points and the counter-triggers are both explicit', () => {
  const when = section(skill, 'When to Use');
  for (const trigger of [/phase or milestone boundary/i, /background/i, /status/i, /already reported was wrong/i]) {
    assert.match(when, trigger, `missing trigger: ${trigger}`);
  }
  assert.match(when, /Do not use it/);
  assert.match(when, /single-step/i);
  assert.match(when, /no phases/i);
  assert.match(when, /ceremony/i);
});

test('the usage examples carry a copyable good report and a named-failure bad one', () => {
  const examples = section(skill, 'Usage Examples');
  const fenced = [...examples.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]);
  assert.ok(fenced.length >= 3, `expected pasteable text blocks, found ${fenced.length}`);

  const good = subsection(skill, 'A report that works');
  assert.match(good, /Done — verified/);
  assert.match(good, /Done — claimed/);
  assert.match(good, /Running:/);
  assert.match(good, /Next:/);
  assert.match(good, /\b\d+ of \d+\b/, 'the good example has no count with a denominator');

  const bad = subsection(skill, 'The same moment, reported badly');
  assert.match(bad, /```text\n[\s\S]*?\n```/, 'the bad example is not a pasteable block');
  assert.match(bad, /rule \d/, 'the bad example does not name which rule it breaks');
  assert.ok(
    [...bad.matchAll(/rule \d/g)].length >= 3,
    'the bad example names fewer than three specific failures',
  );
});

test('pitfalls name a failure and its consequence', () => {
  const pitfalls = section(skill, 'Pitfalls');
  const bullets = [...pitfalls.matchAll(/^- \*\*[^*]+\*\*/gm)];
  assert.ok(bullets.length >= 6, `expected at least six named pitfalls, found ${bullets.length}`);
  for (const pattern of [/child/i, /silent repair/i, /predict/i]) {
    assert.match(pitfalls, pattern, `missing pitfall: ${pattern}`);
  }
});

test('verification is a checklist a reviewer can run over a written report', () => {
  const verification = section(skill, 'Verification');
  const boxes = [...verification.matchAll(/^- \[ \] /gm)];
  assert.ok(boxes.length >= 8, `expected at least eight checklist items, found ${boxes.length}`);
  for (const pattern of [/claim/i, /lifecycle/i, /correction/i, /has not happened yet/i, /count or a named artefact/i]) {
    assert.match(verification, pattern, `missing checklist item: ${pattern}`);
  }
});

test('the skill promises no carried file it does not ship, and no local path', () => {
  assert.ok(skill, 'skills/report-progress/SKILL.md does not exist');
  const carried = /(?:^|[^A-Za-z0-9._/-])((?:references|scripts|assets)\/[A-Za-z0-9._/-]+)/g;
  for (const match of skill.matchAll(carried)) {
    const token = match[1].replace(/[.,;:)\]]+$/, '');
    assert.ok(existsSync(resolve(skillDirectory, token)), `names a carried file the skill does not carry: ${token}`);
  }
  assert.doesNotMatch(skill, /(?:\/Users\/|\/home\/|C:\\Users\\)/);
  assert.doesNotMatch(skill, /\bCUE\b|\bRGC\b/);
});

// The composition doc restates the same sentence in prose. It is the copy a reader of
// docs/ meets first, and until this assertion existed nothing tied it to the source: a
// reword in agent-lifecycle would leave the skill corrected by the test above and the
// doc quietly wrong, which is the drift this pair of files exists to prevent.
test('the composition doc quotes the same lifecycle sentence, verbatim', async () => {
  const composition = await readOrEmpty('docs/composition.md');
  assert.ok(composition, 'docs/composition.md does not exist');
  const fallback = lifecycle.match(/state exactly:\s*\n`([^`]+)`/);
  assert.ok(fallback, 'agent-lifecycle no longer publishes an exact no-evidence sentence');
  assert.ok(
    composition.includes(fallback[1]),
    `docs/composition.md must carry the lifecycle sentence verbatim: ${fallback[1]}`,
  );
  assert.ok(composition.includes('report-progress'), 'the composition doc does not place report-progress');
});

// The head line, the cadence and the bindings arrived together. Each block below holds one
// claim the skill or its reference makes, so a reword that drops the claim fails by name.
const cadence = await readOrEmpty('skills/report-progress/references/percentage-eta-cadence.md');
const cadenceFlat = cadence.replace(/\s+/g, ' ');

test('report-progress declares the slots, hard lines and steps a project adapts it by', () => {
  assert.match(skill, /^## Bindings$/m);
  for (let n = 1; n <= 9; n += 1) assert.match(skill, new RegExp(`^\\| B${n} \\|`, 'm'), `slot B${n} is not declared`);
  for (let n = 1; n <= 8; n += 1) assert.match(skill, new RegExp(`^(?:- |\\d+\\. )\\*\\*H${n}\\. `, 'm'), `hard line H${n} is not declared`);
  // Ids are names, and the text's order is the steps' order: S1 to S11, in that order.
  let previous = -1;
  for (let n = 1; n <= 11; n += 1) {
    const at = skill.search(new RegExp(`^\\d+\\. \\*\\*S${n}\\. `, 'm'));
    assert.notEqual(at, -1, `step S${n} is not declared`);
    assert.ok(at > previous, `step S${n} is out of order`);
    previous = at;
  }
  // The five rules are the first five hard lines, in their published order.
  FIVE_RULES.forEach((rule, index) => {
    assert.ok(flat.includes(`**H${index + 1}. ${rule}`), `rule ${index + 1} is not hard line H${index + 1}`);
  });
  // Every handoff to a sibling is a skill slot whose default is the pack skill.
  assert.match(skill, /\| B7 \|[^\n]*\| skill \| `agent-lifecycle` \|/);
  assert.match(skill, /\| B8 \|[^\n]*\| skill \| `describe-changes` \|/);
  assert.match(skill, /\| B9 \|[^\n]*\| skill \| `request-blocks-review` \|/);
  // Unbound, the skill does what it did before: no timed cadence, UTC only.
  assert.match(skill, /\| B1 \|[^\n]*\| value \| none: a report at each point "When to Use" names/);
  assert.match(skill, /\| B2 \|[^\n]*\| value \| UTC only \|/);
  assert.match(skill, /H6\. Nothing in this skill installs or arms the gate/);
  // An installed copy carries no docs/, so the guide is cited by a URL that resolves anywhere.
  assert.match(skill, /\(https:\/\/github\.com\/crissmoldovan\/agent-skills\/blob\/main\/docs\/project-adaptation\.md\)/);
});

test('the head line is optional, sits above the three sections, and replaces none of them', () => {
  const head = subsection(skill, 'A percentage, an ETA, and updates nobody has to ask for');
  const headFlat = head.replace(/\s+/g, ' ');
  assert.match(headFlat, /directly under its first line and above the three sections/);
  assert.match(headFlat, /The three sections are still owed/);
  // A cadence owes a head line whoever set it, the reader or a project binding B1.
  assert.match(headFlat, /or updates run on a cadence \(B1\), the report carries a \*\*head line\*\*/);
  assert.match(headFlat, /outside a cadence, a report nobody asked for a percentage or an ETA carries no head line/);
  // A register's in-flight count is task metadata; the running rows stay lifecycle evidence.
  assert.match(headFlat, /task metadata, never a running row/);
  assert.match(headFlat, /references\/percentage-eta-cadence\.md/);
  assert.match(headFlat, /H7\. A figure nobody measured is reported as not measured, with its reason, never as 0/);
  assert.match(headFlat, /H8\. An ETA is an estimate, and says so/);
  // H8 is what keeps an ETA from being the prediction rule 5 forbids, and rule 5 says so itself.
  assert.match(headFlat, /Unlabelled, an ETA is a forecast written in the grammar of an observation, the prediction rule 5 forbids/);
  assert.match(flat, /\*\*H5\. [^*]+\*\*[^*]*?An ETA labelled as an estimate with its basis \(H8\) is not that failure/);
  const procedure = section(skill, 'Procedure').replace(/\s+/g, ' ');
  assert.match(procedure, /S1\. On a cadence, re-arm the next tick before anything else/);
  assert.match(procedure, /S3\. Write the head line when one is owed/);
  assert.match(procedure, /in the denominator and never in the numerator/);
  assert.match(procedure, /every time and zone label pasted from a command/);
  // The wall-clock divides by the running section's count, never by a number nobody observed.
  assert.match(procedure, /wall-clock at the agents actually running, as the running section counts them \(B7\)/);
  assert.match(procedure, /With no lifecycle evidence, divide by the agents dispatched, when there are any, and say they were not observed/);
  // Evidence that shows no agent running leaves nothing to divide by, so no wall-clock is invented.
  assert.match(procedure, /With evidence that shows no agent running, or no evidence and no agent dispatched, give agent-hours alone and say the wall-clock and the clock time are not measured, and why \(H7\)/);
  // A clock time that leaves part of the work out says what it covers, so it never reads as the goal's.
  assert.match(procedure, /a clock time that leaves part of it out says what it covers/);
  assert.match(procedure, /With no register, it reads "Progress not measured: no register of the work" \(H7\)/);
  // A labelled ETA is the third kind of number S6 allows, so S6 cannot strip what S3 requires.
  assert.match(procedure, /or part of an ETA labelled as an estimate with its basis \(H8\)/);
  assert.match(procedure, /next update's clock time beside the acts, or, in the last update, says the updates stop/);
  const when = section(skill, 'When to Use');
  assert.match(when, /"eta\?"/);
  assert.match(when.replace(/\s+/g, ' '), /tick of a cadence \(B1\)\*\*, whether the reader set it or the project binds it/);
  const verification = section(skill, 'Verification');
  const verificationFlat = verification.replace(/\s+/g, ' ');
  assert.match(verificationFlat, /or is part of an ETA labelled as an estimate with its basis \(H8\)/);
  assert.match(verificationFlat, /has not happened yet; an ETA labelled as an estimate says when the work may end/);
  assert.match(verification, /an ETA labelled as an estimate/);
  assert.match(verification, /"not measured", never 0/);
  assert.match(verification, /the last update says the\s+updates stop/);
  assert.match(descriptionOf(skill), /a percentage, an ETA, or updates at a set interval/);
});

// S3 gives the head line what the reader asked for, and both figures only on a cadence. The
// checklist has to owe the same, or a report S3 accepts can never pass S11: each figure's
// checks bind that figure where it is given, and none of them demands the other figure.
function headLineCheck() {
  const verification = section(skill, 'Verification');
  const item = verification.split(/\n(?=- \[ \] )/).find((box) => box.startsWith('- [ ] A head line'));
  assert.ok(item, 'the checklist has no item for the head line');
  return item.replace(/\s+/g, ' ');
}

test('a head line asked for a percentage alone passes the checklist without an ETA', () => {
  const procedure = section(skill, 'Procedure').replace(/\s+/g, ' ');
  assert.match(procedure, /It is owed when the reader asked for a percentage or an ETA, and carries what they asked for; on a cadence it carries both/);
  const check = headLineCheck();
  assert.match(check, /carries what the reader asked for, and both on a cadence/);
  assert.match(check, /an ETA is labelled as an estimate with its basis, covers all the work, and has its clock times pasted from a command/);
  assert.doesNotMatch(check, /gives an ETA/, 'the head-line check demands an ETA of a line asked for a percentage alone');
});

test('a head line asked for an ETA alone passes the checklist without a register', () => {
  const check = headLineCheck();
  assert.match(check, /carries what the reader asked for, and both on a cadence/);
  assert.match(check, /A percentage names its register and counts in one unit, with work blocked on a person out of the numerator/);
  assert.doesNotMatch(check, /where there is one, names its register/, 'the head-line check demands a register of a line asked for an ETA alone');
});

// The no-evidence fallback divides by the agents dispatched, so it holds only while there is one:
// a long task one agent works alone has no lifecycle evidence and none dispatched, and dividing by
// that zero would invent a wall-clock. It gives agent-hours alone, as observed zero concurrency does.
test('with no lifecycle evidence and no agent dispatched, the ETA gives agent-hours alone', () => {
  const procedure = section(skill, 'Procedure').replace(/\s+/g, ' ');
  assert.match(procedure, /With no lifecycle evidence, divide by the agents dispatched, when there are any, and say they were not observed/);
  assert.match(procedure, /or no evidence and no agent dispatched, give agent-hours alone and say the wall-clock and the clock time are not measured, and why \(H7\)/);
  assert.doesNotMatch(procedure, /divide by the agents dispatched and say/, 'the no-evidence fallback divides by the agents dispatched even when none were');
});

// A cadence longer than the harness's cap cannot be one tick: an hourly update armed under a
// 30-minute cap is killed before it is due. So the wake-ups are chained, each strictly inside the
// cap and none past the update's time, and only the one that reaches that time writes the update.
test('a cadence longer than the harness cap chains wake-ups, and only the one that is due writes', () => {
  const procedure = section(skill, 'Procedure').replace(/\s+/g, ' ');
  const s1At = procedure.indexOf('**S1. ');
  const s2At = procedure.indexOf('**S2. ');
  assert.ok(s1At !== -1 && s2At > s1At, 'steps S1 and S2 are not both declared, in order');
  const s1 = procedure.slice(s1At, s2At);
  assert.match(s1, /When the interval is longer than the cap, chain wake-ups/);
  assert.match(s1, /each armed for the time left until the update or strictly inside the cap, whichever is shorter/);
  assert.match(s1, /A wake-up before the update is due re-arms the next one and writes nothing/);
  assert.match(s1, /the one that reaches the update's time writes it/);
  assert.match(s1, /\*\*Complete when:\*\* the next tick, or the next wake-up towards it, is armed/);

  const tickAt = cadenceFlat.indexOf("**Tick strictly inside the harness's cap (B5).**");
  const rearmAt = cadenceFlat.indexOf('**Re-arm before you write.**');
  assert.ok(tickAt !== -1 && rearmAt > tickAt, "the reference's tick and re-arm bullets are not both there, in order");
  const tick = cadenceFlat.slice(tickAt, rearmAt);
  assert.match(tick, /When the interval is longer than the cap, no single tick can reach it: chain wake-ups/);
  assert.match(tick, /each armed for the time left until the update or strictly inside the cap, whichever is shorter/);
  assert.match(tick, /A wake-up before the update is due re-arms the next one and writes nothing/);
  // The worked case is the one that had no arming strategy, and its numbers have to add up: every
  // wake-up strictly inside the cap, and together exactly the interval, so the update is not late.
  const worked = tick.match(/For hourly updates under a (\d+)-minute cap: wake-ups of (\d+) minutes, at \2 and (\d+) minutes past, write nothing; the third, armed for the (\d+) minutes left, writes the update on the hour/);
  assert.ok(worked, 'the reference has no worked case of an hourly cadence under a shorter cap');
  const [cap, wake, second, left] = worked.slice(1).map(Number);
  assert.ok(cap < 60, 'the worked cap is not shorter than the hour');
  assert.ok(wake < cap && left < cap, 'a worked wake-up is not strictly inside the cap');
  assert.equal(second, 2 * wake, 'the second wake-up is not one wake-up after the first');
  assert.equal(second + left, 60, 'the worked wake-ups do not reach the hour exactly');
});

test('the reference carries each lesson the head line and the cadence rest on', () => {
  assert.ok(cadence, 'skills/report-progress/references/percentage-eta-cadence.md does not exist');
  for (const lesson of [
    /count it just before you write/i,
    /One unit, and the rows add up/,
    /Work blocked on a person counts in the denominator and never in the numerator/,
    /State the ceiling the work can reach without that person/,
    /When the denominator moves, say what moved it, and give both percentages/,
    /the two numbers do not compare/,
    /Agent-hours\.[\s\S]*Wall-clock\.[\s\S]*A clock time, in each reader's zone \(B2\)/,
    /actually running now, not the number that could run/,
    /That number is the count of rows in the running section, which come from lifecycle evidence \(B7\)/,
    /not observed running/,
    /No register, no number/,
    /does not divide/,
    /It is an estimate, and it says so \(H8\)/,
    /The headline covers all the work up to the goal/,
    /A clock time that leaves a part out says what it covers, and never reads as the goal's/,
    /the goal's own time is not measured \(H7\)/,
    /Every item's known effort goes into the agent-hours, work that waits on a person included/,
    /Only the clock time, and the wall-clock it is counted from, may leave out work that waits on a person/,
    /"Not in it" is for work outside the goal, never for a part of it/,
    /When the evidence shows no agent running[\s\S]*?there is nothing to divide by: give agent-hours alone, and say that the wall-clock and the clock time are not measured, and why \(H7\)/,
    /Assume a review finds something/,
    /printed and never typed/,
    /"not measured" in the report, with that reason \(H7\)/,
    /Tick strictly inside the harness's cap \(B5\)/,
    /Re-arm before you write/,
    /where a compaction cannot take it \(B6\)/,
    /The last update says the updates stop/,
    /into every running agent/,
  ]) {
    assert.match(cadenceFlat, lesson, `the reference has lost: ${lesson}`);
  }
  // It declares nothing of its own, so a project adapts all of it through SKILL.md.
  assert.doesNotMatch(cadence, /^## Bindings$/m);
  assert.doesNotMatch(cadence, /^\s*(?:(?:[-*+]|\d+[.)])\s+\*\*|#{1,6}\s+)[BHS][1-9]/m);
});

test('the reference prints its clock from a command and keeps every zone out but UTC', () => {
  const commands = cadence.match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(commands, 'the reference has no clock commands');
  assert.match(commands[1], /^date -u '\+%H:%M %Z'/m);
  assert.match(commands[1], /TZ="\$READER_ZONE" date/);
  assert.match(commands[1], /-v\+95M/, 'the BSD form is missing');
  assert.match(commands[1], /-d '\+95 minutes'/, 'the GNU form is missing');
  // A time ahead is printed with its date, so a range past midnight does not read as today.
  for (const line of commands[1].split('\n').filter((l) => /95/.test(l))) assert.match(line, /'\+%a %d %b %H:%M %Z(?: \(UTC%z\))?'/);
  assert.match(cadenceFlat, /keep the date wherever it is not today's in that zone/);
  for (const text of [skill, cadence]) {
    assert.doesNotMatch(text, /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/);
    assert.doesNotMatch(text, /\b(?:[A-Z][A-Z]?[SD]T),? ?UTC ?[+-]\d/, 'a zone label typed into the text');
  }
});

// The ETA's clock time is owed in each reader's zone (B2), so a time ahead is printed there too, by
// the BSD and the GNU form, with its zone and offset: a time ahead printed in UTC alone leaves the
// reader's label to be typed, which is the mistake the section exists to stop.
test("the reference prints a time ahead in a reader's zone, by the BSD and the GNU form", () => {
  const commands = cadence.match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(commands, 'the reference has no clock commands');
  assert.match(commands[1], /^TZ="\$READER_ZONE" date -v\+95M '\+%a %d %b %H:%M %Z \(UTC%z\)'/m, "the BSD form of a time ahead in a reader's zone is missing");
  assert.match(commands[1], /^TZ="\$READER_ZONE" date -d '\+95 minutes' '\+%a %d %b %H:%M %Z \(UTC%z\)'/m, "the GNU form of a time ahead in a reader's zone is missing");
});

// A claim a document makes about itself is checkable, so the specimen's numbers are checked:
// a worked example whose rows do not add up teaches the failure it was written to prevent.
test("the reference's specimen adds up, and the gate reads it as a complete report", async () => {
  const specimen = section(cadence, 'A report with a head line, on a cadence').match(/```text\n([\s\S]*?)\n```/);
  assert.ok(specimen, 'the reference has no specimen report');
  const report = specimen[1];
  // A missing figure fails by name, not as a TypeError on a null match.
  const numbers = (pattern, what) => {
    const match = report.match(pattern);
    assert.ok(match, `the specimen no longer states ${what}`);
    return match.slice(1).map(Number);
  };
  const [percent, done, total] = numbers(/Progress (\d+)%: (\d+) of (\d+) /, 'its percentage and basis');
  const [d, f, t, b] = numbers(/done (\d+) · in flight (\d+) · to do (\d+) · blocked on a person (\d+)/, 'its rows');
  assert.equal(d, done);
  assert.equal(d + f + t + b, total, 'the rows do not add up to the denominator');
  assert.equal(Math.round((100 * done) / total), percent);
  const [ceiling] = numbers(/ceiling without that person (\d+)%/, 'its ceiling');
  assert.equal(Math.floor((100 * (total - b)) / total), ceiling);
  const [previous, before, after] = numbers(
    /up from (\d+) at [^.]*? which took the percentage from (\d+)% to (\d+)%/,
    'what moved its denominator, with both percentages',
  );
  assert.equal(Math.round((100 * done) / previous), before);
  assert.equal(after, percent);
  // Its clock time leaves out the work blocked on a person, so it says what it covers, and the
  // goal's own time is not measured until the person's timing is known: never a bare "done".
  const eta = report.split('\n').find((line) => line.startsWith('ETA'));
  assert.ok(eta, 'the specimen has no ETA line');
  assert.doesNotMatch(eta, /; done \d/, "the specimen's clock time reads as the goal's while part of it is left out");
  const [covered] = numbers(
    /the (\d+) handlers not blocked on a person: about \S+ wall-clock at the \d+ agents running, done \d{2}:\d{2}–\d{2}:\d{2} UTC/,
    'what its clock time covers',
  );
  assert.equal(covered, total - b, 'the clock time covers another number of handlers than the work not blocked on a person');
  assert.match(eta, /the whole migration's time is not measured until/i);

  const gate = await import('../adapters/claude-code/report-progress-gate.mjs');
  assert.deepEqual(gate.findReportFailures(report), []);
  assert.deepEqual(gate.findReportFailures(report, { runningTaskCount: 2 }), []);
  // The head line is not read as a section: only the three labelled lines below it are.
  const headOnly = report.split('\n').slice(0, 3).join('\n');
  for (const id of ['done', 'running', 'next']) {
    assert.equal(gate.hasSectionLabel(headOnly, id), false, `the head line reads as the ${id} section`);
  }
});

// Known effort always goes into the headline agent-hours, the work blocked on a person included:
// when its answer comes is unknown, what the work costs once it does is not. Only the clock time
// may leave that work out, and it says so. The basis gives each state the percentage line counts
// as "N <state> at X–Y each", so the headline is a plain sum of it and the review rounds.
test("the specimen's headline agent-hours include every item's known effort", () => {
  const specimen = section(cadence, 'A report with a head line, on a cadence').match(/```text\n([\s\S]*?)\n```/);
  assert.ok(specimen, 'the reference has no specimen report');
  const report = specimen[1];
  const rows = report.match(/in flight (\d+) · to do (\d+) · blocked on a person (\d+)\)/);
  assert.ok(rows, 'the specimen no longer states its rows');
  const eta = report.split('\n').find((line) => line.startsWith('ETA'));
  assert.ok(eta, 'the specimen has no ETA line');
  const headline = eta.match(/^ETA, an estimate: (\d+)–(\d+) agent-hours\b/);
  assert.ok(headline, 'the specimen no longer opens its ETA with agent-hours');
  const basis = eta.match(/Basis(?:, in agent-minutes)?: ([^.]*)\./);
  assert.ok(basis, 'the specimen no longer states its basis');
  const items = new Map();
  for (const [, count, state, low, high] of basis[1].matchAll(/(\d+) (in flight|to do|blocked on a person|review rounds?)\b[^,]*? at (\d+)(?:–(\d+))?/g)) {
    items.set(state.replace(/rounds$/, 'round'), { count: Number(count), low: Number(low), high: Number(high ?? low) });
  }
  assert.ok(items.has('blocked on a person'), 'the basis leaves out the known effort of the work blocked on a person');
  assert.deepEqual(
    ['in flight', 'to do', 'blocked on a person'].map((state) => items.get(state)?.count),
    rows.slice(1).map(Number),
    'the basis costs another number of items than the register counts in a state',
  );
  assert.ok(items.has('review round'), 'the basis costs no review round');
  const sum = (end) => [...items.values()].reduce((total, item) => total + item.count * item[end], 0);
  assert.deepEqual(
    [sum('low'), sum('high')],
    headline.slice(1).map((hours) => Number(hours) * 60),
    "the headline agent-hours are not the sum of every item's known effort, in agent-minutes",
  );
  // The template asks for the same: each state in the basis, and "Not in it" only for work outside the goal.
  const template = cadence.match(/```text\n(Progress [^\n]*)\n(ETA[^\n]*)\n```/);
  assert.ok(template, 'the reference has no head-line template');
  assert.match(template[2], /Basis, in agent-minutes: F in flight at X–Y each, T to do at X–Y each, B blocked on a person at X–Y each/);
  assert.match(template[2], /Not in it: <work outside the goal/);
});

test('the reference keeps out what identifies a person, a client or a machine', async () => {
  // The organisation markers are read from the block above that checks SKILL.md for them, so the
  // two cannot drift and this block need not restate them.
  const ownSource = await readOrEmpty('test/report-progress.test.mjs');
  const markerSource = ownSource.match(/assert\.doesNotMatch\(skill, \/((?:\\b[A-Z]+\\b\|?)+)\/\);/);
  assert.ok(markerSource, 'the block above no longer checks SKILL.md for organisation markers');
  const organisationMarkers = new RegExp(markerSource[1]);
  assert.ok(markerSource[1].split('|').length >= 2, 'every marker that block checks is checked here, not only the first');
  for (const text of [skill, cadence]) {
    assert.doesNotMatch(text, organisationMarkers);
    assert.doesNotMatch(text, /~\/work\//);
    assert.doesNotMatch(text, /(?:\/Users\/|\/home\/|C:\\Users\\)/);
    for (const address of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(address, /@example\.com$/);
  }
});
