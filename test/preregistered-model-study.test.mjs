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
  /^4\. \*\*Prove parity with production before measuring anything/,
  /^5\. \*\*Dry-run every arm, and commit the diff/,
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
  assert.match(steps[4], /still no paid call has been made/);
  assert.match(steps[4], /Every difference must be one the plan intends/);
  assert.match(steps[6], /each addendum's commit precedes the first call it governs/);
  assert.match(steps[6], /It is never backdated/);
});

test('the budget guard has its five parts, and each is armed', () => {
  const guard = procedureSteps(skill)[2];
  assert.match(guard, /refused at start-up when it equals production's key/);
  assert.match(guard, /reserving each call's worst case before the call/);
  assert.match(guard, /A cap checked after the call is a report, not a cap/);
  assert.match(guard, /\*\*A balance floor that latches\.\*\*[^*]*writes a STOP flag that every other process checks[^*]*admits nothing while a balance read is still in flight/);
  assert.match(guard, /exclusive lock with safe stale-lock takeover/);
  assert.match(guard, /the larger of the list-price cost and the provider-reported cost, summed/);
  assert.match(guard, /each of the five parts has been watched refusing/);
  // The reference carries the sketch and the arming table.
  assert.match(budget, /admit\(call\):/);
  assert.match(budget, /\| Part \| Mutation \| Expected \|/);
  assert.match(budget, /A later read that shows the balance recovered does not lift it/);
  assert.match(budget, /Make the takeover atomic/);
  assert.match(budget, /every reserved row with no settlement[^.]*counts at its worst case/);
});

test('parity is proven first, the provider is pinned, and the controls make a difference readable', () => {
  const steps = procedureSteps(skill);
  assert.match(steps[3], /requests and its outputs with production's/);
  assert.match(steps[3], /Pin the serving provider for every arm/);
  assert.match(steps[3], /a router may pick the provider by the request's layout/);
  assert.match(steps[5], /Run the baseline arm twice over the same items/);
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
  assert.match(specimen, /noise floor/);
  assert.match(flat, /The first three are committed before any paid call/);
});
