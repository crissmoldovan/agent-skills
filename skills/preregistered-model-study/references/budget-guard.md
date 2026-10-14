# The budget guard

The guard sits between the harness and the provider, and every paid call passes through it. It
exists because the ways a study overspends are all ordinary: a retry loop nobody bounded, a second
terminal that started the same run, a balance that read healthy a minute after it was not, a cap
checked against what was spent rather than what was about to be. Each part below closes one of
them, and each one is armed — watched refusing — before the guard is trusted with a real call.

## The five parts

### 1. A dedicated research key, refused if it is production's

The study runs on its own key, with its own balance, so that a runaway study cannot spend
production's money or exhaust production's rate limit. At start-up the guard reads both keys
from their secret stores, compares their hashes in memory, prints nothing but the outcome, and
refuses to start when they are equal.

If production's key is not readable where the study runs, the check cannot run. Say so, and treat
it as a reason to run the study somewhere it can — not as a pass.

### 2. A hard cap, enforced by reserving the worst case before the call

A cap checked after a call has returned is a report on money already spent. The guard reserves
each call's **worst case** before admitting it:

```text
worst(call) = (max_input_tokens * input_price + max_output_tokens * output_price) * max_attempts
```

using list prices from a price table frozen with the study's other inputs, and the attempt limit
the harness actually enforces. A call is admitted only while `spent + reserved + worst <= cap`.
After the call, the reservation is released and the actual cost is added to `spent`.

Persist both halves. Write a `reserved` row to the ledger before the call and a `settled` row
after it. On start-up, `spent` is the sum of the settled rows, and every reserved row with no
settlement — a call that may have been billed when the process died — counts at its worst case.

### 3. A balance floor that latches

Where the provider exposes the key's remaining balance, the guard reads it before each batch and
at intervals during one. Three rules:

- **It latches.** The first read below the floor sets a latch that refuses every admission for the
  rest of the process's life. A later read that shows the balance recovered does not lift it:
  balance reads lag, and a process that re-admits on a lagging read spends past the floor on stale
  data.
- **It writes a STOP flag.** On latching, the guard creates a STOP file in the study directory,
  atomically. Every process checks for it before every call and refuses while it exists. Only a
  person removes it, after reading why it was written.
- **Nothing is admitted while a read is in flight.** A call admitted during the read is not covered
  by the read's verdict. Admissions pause until the read returns.

Where the provider exposes no balance, record in the plan that the floor is unavailable. The cap
then governs alone, and it should be set with that in mind.

### 4. One paying process at a time

Two processes that each hold the whole remaining budget will spend twice it. The guard takes an
exclusive lock before its first admission and holds it until it exits.

- **Create the lock atomically**, with an exclusive create that fails if the file exists. The lock
  records the owner's host, process id, start time and a heartbeat the owner refreshes every few
  seconds.
- **A stale lock may be taken over; a live one may not.** A lock is stale when its owner is on this
  host and its process no longer exists, or when its heartbeat is older than several refresh
  intervals. A lock from another host can only be judged by its heartbeat, so set that threshold
  generously.
- **Make the takeover atomic.** Two contenders that both judge a lock stale must not both win.
  Create a takeover marker exclusively — only one contender can — re-check staleness while holding
  it, replace the lock by an atomic rename, then remove the marker.

### 5. Conservative per-attempt costing

Every attempt is costed, retries and failures included, because a failed attempt can still be
billed:

```text
cost(attempt) = max(list_cost(attempt), reported_cost(attempt))
cost(call)    = sum of cost(attempt) over every attempt the call made
```

`list_cost` uses the tokens the provider reported and the frozen price table. When the provider
reports no cost for an attempt, use the list cost; when it reports no tokens for a failed attempt,
charge that attempt its worst case. The ledger keeps one row per attempt, so the spend can be
re-added from the raw rows and the total checked.

## The admission path

```text
admit(call):
    if STOP flag exists:                        refuse   # another process tripped the floor
    if latched:                                 refuse
    if balance read in flight:                  wait     # never admit during a read
    w = worst(call)
    if spent + reserved + w > cap:              refuse
    reserved += w; ledger.append(reserved row)  # persisted before the call
    return ticket

settle(ticket, attempts):
    actual = sum(max(list_cost(a), reported_cost(a)) for a in attempts)
    reserved -= ticket.worst; spent += actual
    ledger.append(settled row, one per attempt)

check_balance():
    in_flight = true
    balance = read balance endpoint
    in_flight = false
    if balance < floor:
        latched = true
        create STOP flag atomically
```

If the harness makes calls concurrently inside one process, the admission check and the
reservation must happen under one lock, or two calls can both see room for one.

## Arming each part

A guard nobody has watched refuse is a claim. Each part takes about a minute to arm, with no paid
call and no real key:

| Part | Mutation | Expected |
|---|---|---|
| Research key | set both key variables to the same fake value | refuses at start-up, prints no value |
| Cap | set the cap below one call's worst case | refuses the first admission |
| Floor | stub the balance read to return less than the floor | latches, writes STOP, refuses the next admission |
| STOP flag | create the flag by hand, start a second process | the second process refuses its first call |
| In-flight read | stub the balance read to block, then request an admission | the admission waits |
| Lock | start a second paying process while the first holds the lock | the second refuses to start |
| Stale takeover | leave a lock whose process no longer exists | it is taken over, once, by one contender |
| Costing | feed a settled attempt with reported cost above list | the ledger records the reported cost |

Record each run's output in the audit, with the mutation that produced it. Restore every stub
before the real run, and check that it is restored by reading the code, not by trusting that the
next run passes.
