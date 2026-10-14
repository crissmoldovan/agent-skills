# Proving no other caller

Retiring the old key refuses every caller still using it. The senders on the map have moved; the
question is whether the map was complete. Memory says it was. This page turns that into a
measurement, and says what the measurement cannot see.

## The reconciliation

1. **Fix the window.** It starts after the last sender on the map moved to the next key, and it is
   longer than the slowest sender's cycle: a job that runs weekly needs more than a week. Write the
   start and end down in UTC before counting anything.
2. **Count the receiver's side.** The requests it authenticated and handled in the window, with the
   first and the last timestamp, to the second. If it logs the slot, count by slot.
3. **Count the senders' side.** Each sender's own record of what it delivered in the same window —
   its delivery log, its job history, its outbound request table — with the first and last
   timestamp of each. Use the senders' records, not the receiver's: the point is two independent
   accounts of the same traffic.
4. **Match exactly.** The receiver's count equals the senders' total, and the receiver's first and
   last second equal the earliest and latest of the senders'. With slots logged, every handled
   request matched `next`.

What each mismatch means:

| Observation | Meaning |
|---|---|
| Receiver count above the senders' total | Something else is calling. Find it before retiring anything. |
| Receiver count below the senders' total | Deliveries were lost, or a log has a gap. Explain it before trusting the match. |
| Counts equal, first or last second differs | Possibly a lost delivery and an unknown caller cancelling out. Match request by request. |
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
