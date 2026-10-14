# The dual-key receiver

The overlap that makes a rotation free of downtime lives in the receiver: for as long as the senders
are moving, it accepts either key. The code is short. The rule that makes it safe is one line, and
it is the line most often left out.

## The comparison

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

export type Slot = 'current' | 'next';

// An empty value never matches anything — not an empty header, not a missing one.
function sameKey(presented: string, expected: string): boolean {
  if (presented === '' || expected === '') return false;
  // Hash both sides so the buffers have equal length and the comparison takes constant time.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function matchSlot(
  presented: string | undefined,
  current: string | undefined,
  next: string | undefined,
): Slot | null {
  const key = presented ?? '';
  if (sameKey(key, current ?? '')) return 'current';
  if (sameKey(key, next ?? '')) return 'next';
  return null;
}
```

In the handler:

```ts
const slot = matchSlot(
  request.headers.get('x-shared-key') ?? undefined,
  process.env.SHARED_KEY,
  process.env.SHARED_KEY_NEXT,
);
if (slot === null) return new Response('unauthorized', { status: 401 });
// The slot and the sender's delivery id, never the key.
log.info({ event: 'shared-key-auth', slot, delivery: request.headers.get('x-delivery-id') ?? null });
```

The same shape works for a signed webhook: verify the signature with `CURRENT`, then with `NEXT`
when it is non-empty, and record which one verified.

### Why the empty-value rule is the one that matters

Without the guard, an unset `NEXT` reads as the empty string, a request with no key reads as the
empty string, and the two are equal. The receiver then accepts every unauthenticated request for
exactly as long as no rotation is in progress — which is most of the time. Nothing fails, and
nothing in normal traffic shows it.

### Log the slot, and the delivery id

Logging which slot matched is what turns the reconciliation from a count into a check. Once every
sender has moved, every handled request should say `next`. One that says `current` is a caller still
on the old key, found before the old key is retired rather than after.

The slot cannot see an unknown caller that already holds the next key. The delivery id can: where
each sender puts a unique id on every request and records it, the ids the receiver logs are matched
one to one against the senders' records, and an id no sender issued is a caller nobody mapped. A
match by count alone is aggregate evidence, because a lost delivery and an unknown request can
cancel.

### Configuration with whitespace

A configured key with leading or trailing whitespace — usually a newline from the file it was
generated into — is a configuration error. Report it loudly at start-up, without the value. Do not
trim it silently: trimming hides the mismatch on this side while a sender may still send the other
form.

## The tests

| Case | `CURRENT` | `NEXT` | Presented | Expected |
|---|---|---|---|---|
| Current key | k1 | unset | k1 | `current` |
| Next key | k1 | k2 | k2 | `next` |
| Current key during overlap | k1 | k2 | k1 | `current` |
| Wrong key | k1 | k2 | x | refused |
| Missing header, `NEXT` unset | k1 | unset | none | refused |
| Empty header, `NEXT` unset | k1 | unset | empty | refused |
| Empty header, `NEXT` set to empty | k1 | empty | empty | refused |
| Nothing configured | unset | unset | empty | refused |
| Nothing configured, any key | unset | unset | k1 | refused |
| A prefix of the key | k1 | unset | k1 without its last character | refused |
| Old key after promotion | k2 | unset | k1 | refused |

Use made-up values in tests, never a real key.

## Arming them

Break the empty-value rule — delete the `=== ''` guard — and run the tests. The two "empty header"
cases and the "missing header" case must fail. Restore the file from a byte copy and confirm the
guard is back by searching for it before running the tests again. A suite that stays green with the
guard deleted is not testing the guard.
