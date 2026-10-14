# The budget guard

The guard sits between the harness and the provider, and every paid call passes through it. It
exists because the ways a study overspends are all ordinary: a retry loop nobody bounded, a second
terminal that started the same run, a balance that read healthy a minute after it was not, a cap
checked against what was spent rather than what was about to be. Each part below closes one of
them, and each one is armed — watched refusing — before the guard is trusted with a real call.

## Scope: one paying process, one call at a time

This guard is deliberately single-threaded. **One** paying process holds the study for the whole
run, and it admits, sends and settles **one** call at a time: nothing else is in flight while a
call is admitted, and every ledger row is written before the next admission. The cap is hard only
under that rule.

Concurrency is out of scope: calls in parallel inside the process, two paying processes, balance
reads running alongside calls, locks on shared storage or across hosts, and taking over another
process's lock. A study that needs any of them needs a different guard, and running one of them
under this one voids the cap — two processes that each believe the remaining budget is theirs
spend twice it, and parallel calls each reserve against a total the others have not yet added to.

## The parts

### 1. A dedicated research key, refused if it is production's

The study runs on its own key, with its own balance, so that a runaway study cannot spend
production's money or exhaust production's rate limit. At start-up the guard reads both keys
from their secret stores, compares their hashes in memory, prints nothing but the outcome, and
refuses to start when they are equal.

If production's key is not readable where the study runs, the check cannot run. Say so, and treat
it as a reason to run the study somewhere it can — not as a pass.

### 2. One paying process, holding a lock the kernel releases

At start-up the guard takes an exclusive operating-system lock on a file in the study directory —
an advisory lock on an open file, such as `flock`, on a local file system — without waiting, and
holds it until the process exits. A second process that tries to take it fails at once and refuses
to start.

The kernel releases the lock when the process exits or dies, so a crashed run never leaves a stale
lock behind, and there is nothing to take over. A paused process still holds it, so nobody starts
paying while it might wake up. A file whose mere existence is the lock — an exclusive create — is
not this lock: it outlives a dead owner, and the takeover it then invites is out of scope.

### 3. A hard cap, enforced by reserving the worst case before each call

A cap checked after a call has returned is a report on money already spent. Before admitting a
call, the guard reserves an **upper bound on what that call can be billed**, and the cap holds only
if the bound really is one:

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
  unit, the larger of its list cost and its reported cost. A reservation made at list price is
  therefore exceeded by the first attempt billed above list, and the cap with it. Take the largest
  of the frozen list price, the list price plus a margin stated in the plan, and the highest price
  any provider serving that model charges.
- **The tokens are a bound under the provider's own count.** `max_input_tokens` is the model's
  context limit, or a counted size plus a stated margin, not a local estimate that another
  tokeniser can exceed. `max_output_tokens` is the limit sent with the request. Where the provider
  bills reasoning or other hidden tokens outside that limit, add their limit as well.
- **The attempts are every attempt.** That includes retries the harness makes, retries the
  provider's client library makes on its own, and a failed attempt that is still billed.
- **Every stage has its own cap.** Each call belongs to a stage — output parity, the main run,
  judging — and the stage's pre-registered cap is checked in the same admission as the study's. A
  call that would still fit the study cap but exceed its stage's is refused.

The invariant, which holds only under the single-process rule above:

```text
at every admission:   spent + reserved + worst(call) <= cap
                      stage_spent[s] + stage_reserved[s] + worst(call) <= stage_cap[s]
for every call:       settled cost <= worst(call)
```

Under this guard nothing is in flight at an admission, so `reserved` holds only reservations whose
outcome is unknown: a call that threw before it could be settled, or one a crashed run left
unsettled (part 6). A settled cost above its reservation means the bound was not a
bound: the guard latches and writes STOP, and the study stops until the bound is corrected in an
addendum.

### 4. A balance floor, read before every admission, that latches

Where the provider exposes the key's remaining balance, the guard reads it **before every
admission** — nothing else is in flight at that moment, so the read describes the state the call
will start from.

- **A call that would cross the floor is not admitted.** The admission needs
  `balance - unseen_spend - reserved - worst(call) >= floor`. `unseen_spend` is spend already
  settled that the balance may not show yet — for a provider whose balance lags, everything settled
  since the balance's own as-of time. `reserved` is every reservation still standing: a call whose
  outcome is unknown (part 5), or one a crashed run left unsettled (part 6), may have been billed
  without the balance showing it, so its worst case comes off the balance too. A balance already
  below the floor fails the same test.
- **It latches.** The first failure sets a latch that refuses every admission for the rest of the
  run, and writes a STOP flag in the study directory with the reason. A later read that shows the
  balance recovered does not lift it: balance reads lag, and a run that re-admits on a lagging read
  spends past the floor on stale data. Only a person removes the STOP flag, after reading why it
  was written.
- **A read that fails is a breach.** A balance that could not be read is treated as one below the
  floor: fail closed.

Where the provider exposes no balance, record in the plan that the floor is unavailable. The study
and stage caps then govern alone, and should be set with that in mind.

### 5. Settle each call, and write it down before the next

Every attempt is costed, retries and failures included, because a failed attempt can still be
billed:

```text
cost(attempt) = max(list_cost(attempt), reported_cost(attempt))
cost(call)    = sum of cost(attempt) over every attempt the call made
```

`list_cost` uses every billable unit the provider reported — tokens, requests, images, audio,
searches, tool invocations — and the frozen price table. When the provider reports no cost for an
attempt, use the list cost; when it reports no usage for a failed attempt, charge that attempt its
`worst_attempt`. The ledger keeps one row per attempt, so the spend can be re-added from the raw
rows and the total checked.

The reservation row is appended and flushed **before** the call is sent, and counted in memory, and
the settled rows **after** it and before the next admission. The ledger on disk is then always at
most one call behind the truth, and that one call is recorded as reserved.

A call that throws — a network error, a timeout, a client library that gives up — may still have
been billed, and nothing says how much. It is not settled, because there is no cost to settle it
at. Its reservation stays counted at its worst case, in memory and through an unknown-outcome row in
the ledger, and the guard never releases it. A person reconciles it against the provider's own
record and writes the outcome into the ledger. A harness that catches the error and admits the next
call therefore still has the unknown call's worst case standing against both caps.

### 6. A restart restores everything from the ledger

A run that stopped — a crash, a kill, a reboot — is resumed by a new process that rebuilds its
totals from the ledger before it admits anything:

- `spent` and each `stage_spent[s]` are the sums of the settled rows, per stage as well as for the
  study. Restoring the study's total but not the stage's lets a stage spend past its cap.
- A reservation with no settlement is a call that may have been billed when the run stopped. It
  counts at its worst case in `reserved` and in its stage's `stage_reserved[s]`, and is never
  released by the guard: a person reconciles it against the provider's own record and writes the
  outcome into the ledger.
- A STOP flag, or a latch recorded in the ledger, refuses the restart until a person clears it.

## The admission path

```text
start():
    take the OS lock on <study>/guard.lock without waiting      # held until the process exits
        or refuse: "another paying process holds this study"
    refuse if the research key equals production's              # compared by hash, never printed
    spent, stage_spent[s]       = sums of the settled rows       # restore from the ledger
    reserved, stage_reserved[s] = worst cases of reservations with no settlement   # never released here
    if STOP flag exists or the ledger records a latch: refuse

call(c):                                                         # one at a time: nothing else is in flight
    if latched:                                               refuse
    w = worst(c)                                                 # every billable unit, at its bound and ceiling
    if w is unbounded:                                        refuse        # a unit with no cap or no price
    s = c.stage
    if spent + reserved + w > cap:                            refuse        # the study's cap
    if stage_spent[s] + stage_reserved[s] + w > stage_cap[s]: refuse        # the stage's own cap
    if floor_available:
        balance = read balance                                   # before this admission, every time
        if the read failed or balance - unseen_spend - reserved - w < floor:
            latched = true; write STOP flag with the reason;  refuse
    ledger.append(reserved row: c, s, w); flush                  # on disk before the call is sent
    reserved += w; stage_reserved[s] += w                        # counted in memory until it settles
    try:
        attempts = send c                                        # the only call in flight
    except any error:                                            # the outcome is unknown: it may be billed
        ledger.append(unknown-outcome row: c, s); flush          # the reservation stays counted, never released here
        raise                                                    # a call whose bill is unknown is not settled
    actual = sum(max(list_cost(a), reported_cost(a)) for a in attempts)
    ledger.append(settled rows: s, one per attempt); flush       # on disk before the next admission
    reserved -= w; stage_reserved[s] -= w
    spent += actual; stage_spent[s] += actual
    if actual > w:                                               # the bound was not a bound
        latched = true; write STOP flag with the reason
```

There is no lock around the totals because there is nothing to race: one process, one call. That
simplicity is the point of the scope rule, and the reason it is a rule — every line above assumes
it.

## Arming each part

A guard nobody has watched refuse is a claim. Each part takes about a minute to arm, with no paid
call and no real key:

| Part | Mutation | Expected |
|---|---|---|
| Research key | set both key variables to the same fake value | refuses at start-up, prints no value |
| Lock | start a second paying process while the first holds the lock | the second refuses to start |
| Lock released on death | kill the first process outright, then start another | the new process takes the lock at once: no stale lock, no takeover |
| Cap | set the cap below one call's worst case | refuses the first admission |
| Stage cap | admit an output-parity call whose worst case fits the study cap but exceeds the parity stage's cap | refused |
| Floor | stub the balance read to return less than the floor | latches, writes STOP with the reason, refuses this and every later admission |
| Floor with an unknown call | let a call throw after its reservation, then stub a lagging balance that does not show it, and admit a call that fits only if the thrown call is forgotten | latches and refuses: the thrown call's worst case comes off the balance |
| Floor crossing | stub a balance just above the floor, then admit a call whose worst case would cross it | latches and refuses, though the call fits the study cap |
| Read failure | stub the balance read to fail | latches and refuses: an unreadable balance is a breach |
| No balance endpoint | run with the floor marked unavailable; admit a call that fits the caps | admitted on the caps alone |
| Settlement above the reservation | settle a call whose reported cost exceeds its reservation | latches, writes STOP, refuses the next admission |
| Thrown call | make the send throw after the reservation row is written, catch it, and admit the next call | the thrown call's worst case still counts against the study and stage caps; nothing released it |
| Restart | kill the process after a reservation row and before its settlement, then start another | the unsettled reservation counts at its worst case, for the study and its stage; settled totals are restored per stage |
| STOP flag | create the flag by hand, then start the run | refuses until a person removes it |
| Unbounded unit | admit a call whose hosted-search or tool invocations are not capped in the request | refused at admission: the unit has no bound |
| Unlisted unit | admit a call that can incur a unit the frozen price table does not list | refused at admission |
| Costing | settle an attempt with reported cost above list but within the ceiling | the ledger records the reported cost, and no latch |

Record each run's output in the audit, with the mutation that produced it. Restore every stub
before the real run, and check that it is restored by reading the code, not by trusting that the
next run passes.
