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
ceiling_price(u) = max(list_price(u), list_price(u) * (1 + margin), provider_max_price(u))
                   for every billable unit u of the model, as its price sheet lists them
worst_attempt    = request_fee_ceiling + sum over every billable unit u of max_quantity(u) * ceiling_price(u)
worst(call)      = worst_attempt * max_attempts
```

- **Every billable unit, not only tokens.** A call can be billed for input and output tokens
  (reasoning and other hidden tokens included), cache writes priced above ordinary input, a fee per
  request, images in and out, audio in and out, hosted search or web queries, code execution, file
  search and other tool invocations — whatever the price sheet lists for that model. The frozen
  price table lists every unit the call can incur, and `worst_attempt` sums all of them. A
  reservation that counts tokens alone is exceeded by the first call that also searched the web.
- **Every unit has a bound, or the call is not admitted.** `max_quantity(u)` comes from the request
  itself: the output-token limit, the number of images sent, the cap on tool calls, the cap on
  search queries. A unit whose quantity the request does not cap — an agent allowed unlimited
  hosted searches — or that the price table does not list cannot be bounded, so the guard refuses
  the call. Cap it in the request, or leave that feature out of the study.

- **The price is a ceiling, not the list price.** Settlement (part 5) charges each attempt, unit by
  unit, the larger of its list cost and its reported cost. A reservation made at list price is therefore
  exceeded by the first attempt billed above list, and the cap with it. Take the largest of the
  frozen list price, the list price plus a margin stated in the plan, and the highest price any
  provider serving that model charges.
- **The tokens are a bound under the provider's own count.** `max_input_tokens` is the model's
  context limit, or a counted size plus a stated margin, not a local estimate that another
  tokeniser can exceed. `max_output_tokens` is the limit sent with the request. Where the provider
  bills reasoning or other hidden tokens outside that limit, add their limit as well.
- **The attempts are every attempt.** That includes retries the harness makes, retries the
  provider's client library makes on its own, and a failed attempt that is still billed.

- **Every stage has its own cap, enforced at admission.** A reservation carries the stage it belongs
  to — output parity, the main run, judging — and the stage's pre-registered cap is checked in the
  same step as the study's. A stage that would still fit the study cap but exceed its own is
  refused, so a stage cannot spend another stage's allowance and leave the audit to find out after.

The invariant is three inequalities, and the cap holds only while all of them do:

```text
at every admission:   spent + reserved + worst(call) <= cap
                      stage_spent[s] + stage_reserved[s] + worst(call) <= stage_cap[s]
for every call:       settled cost <= worst(call)
```

After the call, the reservation is released and the actual cost is added to `spent`. If an actual
cost ever exceeds its reservation, the bound was not a bound. The guard then latches and writes
STOP exactly as it does at the floor, and the study stops until the bound is corrected in an
addendum.

Persist both halves, with the stage on every row. Write a `reserved` row to the ledger before the
call and a `settled` row after it. On start-up, and on every takeover, rebuild every total from the
ledger, per stage as well as for the study: `spent` and each `stage_spent[s]` are the sums of the
settled rows, and every reserved row with no settlement — a call that may have been billed when the
process died — counts at its worst case in `reserved` and in its own stage's `stage_reserved[s]`.
Restoring the study's total but not the stage's lets a stage spend past its cap after a restart.
The new process has read no balance yet, so it admits nothing until a fresh read sets the headroom.

### 3. A balance floor that latches

Where the provider exposes the key's remaining balance, the guard reads it before each batch and
at intervals during one. The rules:

- **The floor is part of every admission, not only of every read.** A read alone lets a call that
  fits the study cap carry the key below the floor before the next read can latch. Each successful
  read therefore sets a headroom — the balance, less the floor, less every reservation not yet
  settled and every settlement the balance may not show yet — and every admission must fit inside
  it, and takes its worst case out of it. Settlements never add headroom back; only the next read
  does. A read older than the staleness limit the plan states makes admissions wait for a fresh one.

- **It latches.** The first read below the floor sets a latch that refuses every admission for the
  rest of the process's life. A later read that shows the balance recovered does not lift it:
  balance reads lag, and a process that re-admits on a lagging read spends past the floor on stale
  data.
- **It writes a STOP flag.** On latching, the guard creates a STOP file in the study directory,
  atomically. Every process checks for it before every call and refuses while it exists. Only a
  person removes it, after reading why it was written.
- **Nothing is admitted while any read is in flight, and each read's result is applied before
  admissions resume.** A call admitted during a read is not covered by the read's verdict, so
  admissions wait. When a read returns below the floor, the latch is set and the STOP flag
  written first, under the same lock admissions take. Only then is the read counted as finished
  and are waiting calls released. Clearing the in-flight mark first opens a window in which a
  waiting call sees neither the mark nor the latch, and is admitted below the floor.
- **Reads in flight are counted, not flagged.** Two reads can overlap — a scheduled one and one
  before a batch. With a single flag, the first to finish clears it while the second is still
  running, and admissions resume uncovered. A count reaches zero only when the last read is done.
- **A read that fails is a breach: fail closed.** A balance that could not be read is treated as
  one below the floor: the guard latches and writes STOP, with the reason, and a person decides
  whether to resume. The read's bookkeeping is released on every path, error included. A read
  that throws and leaves its in-flight mark behind makes every later admission wait for ever.

Where the provider exposes no balance, record in the plan that the floor is unavailable. The cap
then governs alone, and it should be set with that in mind.

### 4. One paying process at a time

Two processes that each hold the whole remaining budget will spend twice it. The guard takes an
exclusive lock before its first admission and holds it until it exits.

- **Prefer a lock the kernel releases.** Where every paying process runs on one machine with a
  local file system, hold an operating-system lock on an open file for the life of the process.
  The kernel releases it when the process dies, so there is never a stale lock to take over — and a
  paused owner still holds it, so nobody takes over from a process that might wake up. The rest of
  this part is for locks that outlive their owner: a file on shared storage, or several hosts.
- **Create the lock atomically**, with an exclusive create that fails if the file exists. The lock
  records the owner's host, process id, start time and a heartbeat the owner refreshes every few
  seconds.
- **A stale heartbeat is not a dead owner.** It proves the owner stopped refreshing, not that it
  stopped. A paused process — a debugger, a suspended laptop, a long garbage collection — or a host
  cut off from the network can wake up and carry on admitting paid calls. So a takeover is safe
  only with one of two things:
  - **proof the owner is dead**: it was on this host, no process has its id, or the process that
    has it started after the lock was written, since a reused process id is not the owner; or
  - **a fencing token**: a generation number in the shared ledger that only ever increases. Taking
    the lock, fresh or by takeover, increments it, and the owner keeps the value it got. Every
    admission and every settlement writes to the ledger only if the generation is still the
    owner's, in one atomic step: a compare-and-append under a short lock the kernel releases, or a
    database transaction that checks the generation. A fenced owner's admission fails before its
    call is sent, and the process exits.
- **The new owner inherits the old owner's open reservations.** Reservations an older generation
  made and never settled count at their worst case, and the new owner never releases them: the old
  owner may yet have made those calls.
- **A fenced settlement is kept, never dropped.** The money was spent whether or not the owner was
  current. The settlement is appended as a stale-generation row, the reservation it settles stays
  counted, and the fenced process exits.
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

`list_cost` uses every billable unit the provider reported — tokens, requests, images, audio,
searches, tool invocations — and the frozen price table. When the provider
reports no cost for an attempt, use the list cost; when it reports no tokens for a failed attempt,
charge that attempt its `worst_attempt`. None of these can exceed the reservation, because the
reservation was made at the ceiling price. The ledger keeps one row per attempt, so the spend can be
re-added from the raw rows and the total checked.

## The admission path

Everything that reads or writes `spent`, `reserved`, `latched` or `reads_in_flight` holds one
admission lock. `wait` releases that lock while it waits and takes it again before returning, as a
condition variable does.

```text
acquire():                                      # once, before the first admission
    take the lock                               # kernel-released, exclusive create, or takeover
    my_gen = ledger.increment_generation()      # atomic; the new value is this owner's fencing token
    spent = sum of settled rows; stage_spent[s] = sum of settled rows of stage s, for every s
    for every reserved row r with no settlement, of any generation:
        reserved += r.worst; stage_reserved[r.stage] += r.worst     # the study's total AND its stage's
    last_read_at = never                        # no headroom until a fresh balance read

admit(call):                                    # holds the admission lock; call.stage is its stage s
    while reads_in_flight > 0 or now - last_read_at > staleness_limit:
        wait                                    # never admit during a read, or on a stale one
    if STOP flag exists or latched:  refuse     # re-checked after every wait
    w = worst(call)                             # every billable unit, at its bound and ceiling price
    if w is unbounded:               refuse     # a unit with no cap, or missing from the price table
    s = call.stage
    if spent + reserved + w > cap:                              refuse     # the study's cap
    if stage_spent[s] + stage_reserved[s] + w > stage_cap[s]:   refuse     # the stage's own cap
    if w > headroom:                                            refuse     # the floor, between reads
    if not ledger.append_if_generation(my_gen, reserved row with s):   # one atomic step, before the call
        exit "fenced: a newer owner holds the study"
    reserved += w; stage_reserved[s] += w; headroom -= w
    return ticket

settle(ticket, attempts):                       # holds the admission lock
    actual = sum(max(list_cost(a), reported_cost(a)) for a in attempts)
    if not ledger.append_if_generation(my_gen, settled row, one per attempt):
        ledger.append(settled row, one per attempt, marked stale, my_gen)   # real spend is kept
        if actual > ticket.worst:  create STOP flag atomically             # the flag is shared
        exit "fenced"                           # its reservation stays counted by the new owner
    reserved -= ticket.worst; spent += actual
    stage_reserved[ticket.stage] -= ticket.worst; stage_spent[ticket.stage] += actual   # headroom is not returned
    if actual > ticket.worst:                   # the bound was not a bound
        latched = true
        create STOP flag atomically

check_balance():
    with admission lock:
        reads_in_flight += 1                    # from here, admissions wait
    verdict = "breach"                          # fail closed unless the read succeeds
    try:
        balance = read balance endpoint         # slow; the lock is not held
        if balance >= floor:  verdict = "ok"
    finally:                                    # runs on success and on any error
        with admission lock:
            if verdict == "breach":             # below the floor, or unreadable
                latched = true                  # applied first ...
                create STOP flag atomically     # with the reason
            else:
                headroom = balance - floor - reserved - settled_since(balance)   # what it may not show yet
                last_read_at = now
            reads_in_flight -= 1                # ... released only after
            wake every waiting admission        # each re-checks STOP and the latch
```

The fencing token works because of where the reservation is written. It is appended under the
owner's generation before the call is sent, so a paused owner that wakes after a takeover is in one
of two states: its next append fails and it sends nothing, or the call it is about to send was
already recorded — and the new owner, which counted every older unsettled reservation at its worst
case when it took over, has already budgeted for it. Either way no paid call escapes the cap.

Three orderings matter in `check_balance`. The latch and the flag are set before
`reads_in_flight` is decremented, so no waiter can wake in a gap where it finds neither. The decrement sits in
`finally`, so a read that throws still releases its count — having first latched, because an
unreadable balance is a breach. And the count, unlike a flag, stays above zero until the last of
several overlapping reads is done.

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
| Read failure | stub the balance read to throw; request an admission during it | latches, writes STOP with the reason; the admission is refused, not left waiting |
| Overlapping reads | start two reads; let the first return above the floor while the second still blocks; request an admission | the admission waits until the second read finishes |
| Lock | start a second paying process while the first holds the lock | the second refuses to start |
| Paused owner | suspend the owner, let its heartbeat go stale and a second process take over, then resume the first and request an admission | the first is refused as fenced before any call and exits; its unsettled reservations still count at worst case |
| Fenced settlement | settle a call from an owner whose generation is no longer current | the settlement is kept as a stale-generation row; the reservation stays counted; the process exits |
| Reused process id | leave a lock whose process id now belongs to a process started after the lock was written | not taken as proof of death: the takeover fences by generation |
| Floor between reads | let a read leave a headroom smaller than one call's worst case, with the study cap far away; admit that call | refused: it fits the study cap but would cross the floor |
| Stale read | let the last successful read age past the staleness limit; request an admission | the admission waits for a fresh read |
| Stage cap | admit an output-parity call whose worst case fits the study cap but exceeds the parity stage's cap | refused |
| Stage cap after restart | stop a process with parity reservations unsettled, start another, admit a parity call that fits only if those reservations were forgotten | refused: the restored reservations count against the parity stage |
| Unbounded unit | admit a call whose hosted-search or tool invocations are not capped in the request | refused at admission: the unit has no bound |
| Unlisted unit | admit a call that can incur a unit the frozen price table does not list | refused at admission |
| Stale takeover | leave a lock whose process no longer exists | it is taken over, once, by one contender |
| Costing | feed a settled attempt with reported cost above list but within the ceiling | the ledger records the reported cost, and no latch |

Record each run's output in the audit, with the mutation that produced it. Restore every stub
before the real run, and check that it is restored by reading the code, not by trusting that the
next run passes.
