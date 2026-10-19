# Proving no other caller

Retiring the old key refuses every caller still using it. The senders on the map have moved; the
question is whether the map was complete. Memory says it was. This page turns that into a
measurement, and says what the measurement cannot see.

## The reconciliation

There are two kinds of match, and the record says which one it has.

- **One to one, by a per-request id: proof.** Each sender puts a unique delivery id on every request
  — a header — and records it; the receiver logs it beside the slot. The ids are then compared
  with their counts, not as sets: each id appears as many times at the receiver as in the senders'
  records — normally exactly once on each side. An id the senders never issued is another caller;
  an id that never arrived is a lost delivery; an id the receiver logged more often than it was
  sent is a replay, or another caller reusing it. A set comparison collapses that last one into its
  original, so it is not one to one. Add the id in step 4 of the rotation, while each sender is
  being changed anyway.

  Extract each side's ids into a file with a checked command — under `pipefail`, its status read —
  and confirm every sender on the map contributed some. Then compare, failing closed: an empty or
  unreadable file, or a count that failed, is no evidence, never a match. So is any row that is not
  an id — blank, holding whitespace, or a placeholder such as `null`, `-` or `\N` that an
  extraction prints for a missing header. Two extractions that failed the same way agree with each
  other, and that agreement is not a match.

  ```bash
  # One id per line on each side. Only "ids match one to one" is a match. Add your log tool's own
  # placeholder for a missing value to the list; grep exits 1 only when it read both files and found
  # no blank, whitespace or placeholder row.
  set -o pipefail
  if ! { grep -q . receiver-ids.txt && grep -q . sender-ids.txt; }; then
    echo "NO EVIDENCE: an id file is missing or empty"; false
  elif grep -Eiq -- '^$|[[:space:]]|^(null|nil|none|undefined|nan|-|\\N|\(null\)|"")$' \
         receiver-ids.txt sender-ids.txt; [ $? -ne 1 ]; then
    echo "NO EVIDENCE: a row is blank, holds whitespace or is a placeholder such as null"; false
  elif ! { sort receiver-ids.txt | uniq -c > receiver.counts \
           && sort sender-ids.txt | uniq -c > sender.counts; }; then
    echo "NO EVIDENCE: counting the ids failed"; false
  elif diff receiver.counts sender.counts; then
    echo "ids match one to one"
  else
    echo "MISMATCH: the lines above differ, a repeat included"; false
  fi
  ```

- **By count and endpoints: aggregate evidence, not proof.** Without an id, the steps below compare
  totals and the first and last second. A delivery lost in the middle of the window and an unknown
  request in the middle of the window cancel exactly: the totals agree and the endpoints do not
  move. Comparing counts per short interval — per minute, per hour — narrows it, because a
  cancellation must then fall inside one interval, but it is still aggregate. Say so in the record.

Whichever kind it is, the slot rule holds on its own: every caller that was never moved still
holds the old key, so any request matching `current` is one, whatever the counts say. What the slot
cannot catch is an unknown caller that already holds the next key, such as a service reading the
same store; only the ids, or the counts, can show that one.

1. **Fix the window.** It starts after the last sender on the map moved to the next key, and it is
   longer than the slowest sender's cycle: a job that runs weekly needs more than a week. Write the
   start and end down in UTC before counting anything.
2. **Count the receiver's side.** The requests it authenticated and handled in the window, with the
   first and the last timestamp, to the second. If it logs the slot, count by slot.
3. **Count the senders' side.** Each sender's own record of what it delivered in the same window —
   its delivery log, its job history, its outbound request table — with the first and last
   timestamp of each. Use the senders' records, not the receiver's: the point is two independent
   accounts of the same traffic.
4. **Match exactly, and name the kind of match.** With ids: every id with the same count on both
   sides. Without: the receiver's count equals the senders' total, and the receiver's first and
   last second equal the earliest and latest of the senders' — recorded as aggregate evidence, with
   per-interval counts where the logs allow. With slots logged, every handled request matched
   `next`.

What each mismatch means:

| Observation | Meaning |
|---|---|
| Receiver count above the senders' total | Something else is calling. Find it before retiring anything. |
| Receiver count below the senders' total | Deliveries were lost, or a log has a gap. Explain it before trusting the match. |
| Counts equal, first or last second differs | Possibly a lost delivery and an unknown caller cancelling out. Match request by request. |
| Counts and endpoints equal, no ids | Aggregate evidence only. A cancellation in the middle of the window is not ruled out; the record says so. |
| An id at the receiver that no sender issued | Another caller, holding a key that works. Find it before retiring anything. |
| An id logged at the receiver more often than the senders recorded it | A replay, or another caller reusing the id. Find it before retiring anything. |
| A blank row, or a placeholder such as `null` or `-`, among the ids | A request that carried no id, or an extraction that missed it. No evidence until it is explained. |
| Any request matching `current` | A caller on the old key, whatever the counts say. |

Where clock skew or latency puts one request on either side of a second boundary, match that request
individually and record the explanation. Do not relax the rule to "within a few seconds" in general:
that is exactly the tolerance in which a stray caller hides.

## Where else senders hide

Code search finds the senders someone wrote down in a repository. Search there, and then in the
places it cannot see:

- every repository that could hold a client — not only the receiver's and the known senders';
- CI and deployment secrets that hold the old value under any name;
- schedulers and cron configurations, including ones defined in a hosted dashboard;
- database functions, triggers and scheduled jobs whose definitions can hold a literal;
- third-party services configured with the receiver's URL — webhook dashboards, monitoring probes,
  automation tools;
- runbooks, wikis and READMEs with example requests that someone may have turned into a script;
- secret stores, searched by setting name for every place the old value was copied to.

Record the search terms — the header name, the setting names, the receiver's path and host — and
every place searched, with what was found. A search reported without its terms cannot be repeated.

## What the evidence cannot see

State each of these beside the result. They are not reasons to skip the reconciliation; they are
what a reader needs in order to know how far to trust it.

- **Retention.** A log kept for seven days cannot show a caller that runs monthly. The window can be
  no longer than the shorter of the two sides' retention.
- **Per-call caps.** Some log tools return at most a fixed number of entries per call and need
  paging. A count exactly equal to the cap is a page, not a total.
- **Sampling.** A log that samples requests cannot be reconciled one for one. Find an unsampled
  source, or say that the match is approximate.
- **No caller identity.** Many request logs carry no caller identity, so a match is by count and
  time, not by name. Two callers can still be told apart by the slot they matched, which is why the
  receiver logs it.
- **Time zones.** Normalise both sides to UTC before comparing seconds.

## After the retirement

For one full sender cycle after the old key is retired, watch the receiver's refusals. A burst of
authentication failures from one source is a caller the reconciliation missed. Seeing it within the
hour costs a quick fix; seeing it when its owner reports a broken integration costs an incident.
