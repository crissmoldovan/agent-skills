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

### 2. A hard cap, enforced by reserving an upper bound before the call

A cap checked after a call has returned is a report on money already spent. The guard reserves,
before admitting a call, an **upper bound on what that call can be billed**, and the cap holds
only if the bound really is one:

```text
ceiling_price = max(list_price, list_price * (1 + margin), provider_max_price)   per model, per token kind
worst_attempt = max_input_tokens * ceiling_input_price + max_output_tokens * ceiling_output_price
worst(call)   = worst_attempt * max_attempts
```

- **The price is a ceiling, not the list price.** Settlement (part 5) charges each attempt the
  larger of its list cost and its reported cost. A reservation made at list price is therefore
  exceeded by the first attempt billed above list, and the cap with it. Take the largest of the
  frozen list price, the list price plus a margin stated in the plan, and the highest price any
  provider serving that model charges.
- **The tokens are a bound under the provider's own count.** `max_input_tokens` is the model's
  context limit, or a counted size plus a stated margin, not a local estimate that another
  tokeniser can exceed. `max_output_tokens` is the limit sent with the request. Where the provider
  bills reasoning or other hidden tokens outside that limit, add their limit as well.
- **The attempts are every attempt.** That includes retries the harness makes, retries the
  provider's client library makes on its own, and a failed attempt that is still billed.

The invariant is two inequalities, and the cap holds only while both do:

```text
at every admission:   spent + reserved + worst(call) <= cap
for every call:       settled cost <= worst(call)
```

After the call, the reservation is released and the actual cost is added to `spent`. If an actual
cost ever exceeds its reservation, the bound was not a bound. The guard then latches and writes
STOP exactly as it does at the floor, and the study stops until the bound is corrected in an
addendum.

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
- **Nothing is admitted while a read is in flight, and the read's result is applied before
  admissions resume.** A call admitted during the read is not covered by the read's verdict, so
  admissions wait. When the read returns below the floor, the latch is set and the STOP flag
  written first, under the same lock admissions take. Only then is the read marked finished and
  are waiting calls released. Clearing the in-flight mark first opens a window in which a waiting
  call sees neither the mark nor the latch, and is admitted below the floor.

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
charge that attempt its `worst_attempt`. None of these can exceed the reservation, because the
reservation was made at the ceiling price. The ledger keeps one row per attempt, so the spend can be
re-added from the raw rows and the total checked.

## The admission path

Everything that reads or writes `spent`, `reserved`, `latched` or `in_flight` holds one admission
lock. `wait` releases that lock while it waits and takes it again before returning, as a condition
variable does.

```text
admit(call):                                    # holds the admission lock
    while in_flight:                 wait       # never admit during a balance read
    if STOP flag exists or latched:  refuse     # re-checked after every wait
    w = worst(call)                             # an upper bound on what it can be billed
    if spent + reserved + w > cap:   refuse
    reserved += w; ledger.append(reserved row)  # persisted before the call
    return ticket

settle(ticket, attempts):                       # holds the admission lock
    actual = sum(max(list_cost(a), reported_cost(a)) for a in attempts)
    reserved -= ticket.worst; spent += actual
    ledger.append(settled row, one per attempt)
    if actual > ticket.worst:                   # the bound was not a bound
        latched = true
        create STOP flag atomically

check_balance():
    with admission lock:
        in_flight = true                        # from here, admissions wait
    balance = read balance endpoint             # slow; the lock is not held
    with admission lock:
        if balance < floor:
            latched = true                      # applied first ...
            create STOP flag atomically
        in_flight = false                       # ... cleared only after
        wake every waiting admission            # each re-checks STOP and the latch
```

If `in_flight` were cleared before the latch and the flag were set, a waiting call could wake in
the gap, find neither, and be admitted below the floor. The order above closes that window: by the
time any waiter can run, the read's verdict is already in force.

## Arming each part

A guard nobody has watched refuse is a claim. Each part takes about a minute to arm, with no paid
call and no real key:

| Part | Mutation | Expected |
|---|---|---|
| Research key | set both key variables to the same fake value | refuses at start-up, prints no value |
| Cap | set the cap below one call's worst case | refuses the first admission |
| Ceiling | settle an attempt whose reported cost is above its reservation | latches, writes STOP, refuses the next admission |
| Floor | stub the balance read to return less than the floor | latches, writes STOP, refuses the next admission |
| STOP flag | create the flag by hand, start a second process | the second process refuses its first call |
| In-flight read | stub the balance read to block and then return below the floor; request an admission during it | the admission waits, then is refused — never admitted |
| Lock | start a second paying process while the first holds the lock | the second refuses to start |
| Stale takeover | leave a lock whose process no longer exists | it is taken over, once, by one contender |
| Costing | feed a settled attempt with reported cost above list but within the ceiling | the ledger records the reported cost, and no latch |

Record each run's output in the audit, with the mutation that produced it. Restore every stub
before the real run, and check that it is restored by reading the code, not by trusting that the
next run passes.
