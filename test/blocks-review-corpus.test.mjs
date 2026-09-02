import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { classifyBlocksEvidence } from '../skills/blocks/scripts/blocks-review.mjs';

// The corpus this file exists because of.
//
// The classifier decided completion by matching two literal strings, which was true
// on the day it was written and quietly stopped being true when the bot rephrased its
// verdict. A caller then waited forty minutes for a verdict that had arrived in four
// seconds, and on the next round read a clean review as reporting findings. Nothing
// went red, because nothing was watching the prose.
//
// `blocks-review.fixtures.json` holds seven bodies observed on one real pull request
// plus generated ones that stress the seams those seven exposed: negation at a
// distance, markdown tables, quoted prior rounds, inverted resolutions, partial
// passes, and help text that quotes the words a finished verdict uses.
const FIXTURES = JSON.parse(readFileSync(join(import.meta.dirname, 'blocks-review.fixtures.json'), 'utf8'));

// Deliberately below the current score. Prose classification has a long tail, and
// chasing the last few cases would encode this corpus rather than the rules. What
// must not regress is the observed set and the accepted-wrongly count, both asserted
// exactly rather than as a floor.
const MIN_CORRECT = 72;

/**
 * One Blocks comment, alone, after the baseline — the path where prose decides.
 *
 * Inline comments and formal reviews are stronger evidence and are consulted first,
 * so a fixture supplying them would exercise the structural path instead of the one
 * that broke.
 */
function stateOf(body) {
  const result = classifyBlocksEvidence(
    {
      comments: [{ id: 1, author: 'blocksorg', createdAt: '2026-01-01T00:00:10Z', body }],
      reviews: [],
      inline: [],
      prState: 'OPEN',
    },
    { requestedAt: '2026-01-01T00:00:00Z', baselineIds: {} },
  );
  return result.state === 'clean' || result.state === 'findings' ? result.state : 'nonterminal';
}

const scored = FIXTURES.map((item) => ({ ...item, got: stateOf(item.body) }));
const wrong = scored.filter((item) => item.got !== item.expected);

test('every body this bot actually posted is classified correctly', () => {
  // Not judgement calls about hypothetical phrasings — things the bot really said.
  const missed = wrong.filter((item) => item.id.startsWith('real-'));
  assert.deepEqual(
    missed.map((item) => `${item.id}: expected ${item.expected}, got ${item.got}`),
    [],
  );
});

test('nothing is wrongly reported clean, which is the only error that merges', () => {
  // A false `findings` costs a reader the seconds it takes to open the comment. A
  // false nonterminal costs a timeout, which still surfaces the current state.
  // Calling an unclean or unfinished review clean is the one that lets it through.
  const accepted = wrong.filter((item) => item.got === 'clean');
  assert.deepEqual(
    accepted.map((item) => `${item.id}: expected ${item.expected}, got clean`),
    [],
  );
});

test(`classifies at least ${MIN_CORRECT} of the ${FIXTURES.length} corpus bodies`, () => {
  assert.ok(
    scored.length - wrong.length >= MIN_CORRECT,
    `${scored.length - wrong.length}/${scored.length} correct, below the floor of ${MIN_CORRECT}`,
  );
});
