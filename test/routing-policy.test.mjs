import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const skillPath = new URL('../skills/model-routing/SKILL.md', import.meta.url);
const policyPath = new URL('../skills/model-routing/references/routing-policy.md', import.meta.url);
const skill = await readFile(skillPath, 'utf8');
const policy = await readFile(policyPath, 'utf8');

function includesAll(source, fragments) {
  for (const fragment of fragments) assert.match(source, fragment);
}

test('skill states token efficiency with acceptance quality as the objective', () => {
  includesAll(skill, [
    /fewest model tokens/i,
    /least DRIVER-context growth/i,
    /still meets the acceptance criteria/i,
    /Profiles and exact identifiers preserve[\s\S]*mechanisms, not the product goal/i,
  ]);
  assert.match(policy, /Fewer tokens with lower acceptance quality is a failed optimization/i);
});

test('shipped policy enforces local-tool-first routing and objective acceptance', () => {
  includesAll(policy, [
    /Deterministic local tool/i,
    /Deterministic local tool[\s\S]*need no language-model judgment/i,
    /Acceptance: executable checks or exact predicates/i,
    /accepted outputs have fresh verification evidence/i,
  ]);
  includesAll(skill, [/Prefer deterministic local tools before any model/i, /Set the acceptance standard/i]);
});

test('parallel policy requires every independence and benefit condition', () => {
  includesAll(policy, [
    /disjoint write ownership/i,
    /no unresolved decision dependency/i,
    /non-overlapping questions/i,
    /separate acceptance checks/i,
    /dispatch, context packaging, and reconciliation cost more/i,
  ]);
  includesAll(skill, [/savings exceed overhead/i, /non-overlapping questions/i, /no fan-out duplicates source reading/i]);
});

test('context policy prevents repeated broad payloads and bounds results', () => {
  includesAll(policy, [
    /source-of-truth paths\/URLs and only necessary excerpts/i,
    /Do not forward the whole conversation, repository, logs, or prior transcripts/i,
    /Reuse verified artifacts by path or stable source ID/i,
    /results must be decision-ready and bounded/i,
  ]);
  includesAll(skill, [/never paste whole conversations\/logs\/plans/i, /bounded result contract/i]);
});

test('retry and escalation preserve attempted evidence without blind repetition', () => {
  includesAll(policy, [
    /Never blindly retry/i,
    /one bounded retry/i,
    /failure delta/i,
    /relevant artifacts/i,
    /attempted checks/i,
    /remaining acceptance criteria/i,
  ]);
  includesAll(skill, [/Retry once only for a transient execution failure/i, /failure delta\/artifacts/i]);
});

test('verification economy keeps DRIVER acceptance independent', () => {
  includesAll(policy, [
    /cheapest decisive evidence first/i,
    /deterministic syntax\/schema checks/i,
    /focused tests/i,
    /full-suite checks at phase boundaries/i,
    /DRIVER independently verifies phase and final acceptance boundaries/i,
    /Token reduction must not reduce acceptance yield or verification coverage/i,
  ]);
  includesAll(skill, [/DRIVER independently accepts the result/i, /fresh evidence/i]);
});
