# Release ledger — system model

The six stages, their contracts, and what each is allowed to do when the next one
is unavailable. Names here are roles, not table names; map them onto the host's
vocabulary in the implementation document.

## Stage contracts

| Stage | Input | Output | Must not |
|---|---|---|---|
| Capture | One merge event | One queue row, or none if the key already exists | Call a model, enrich, filter on business rules, block the caller |
| Analysis | A batch of unanalysed queue rows | One ledger entry per row; the row marked analysed | Reorder, drop silently, run unbounded |
| Popup | A user identity | Entries newer than the user's watermark, within the window | Return entries the user's audience excludes |
| Dismiss | A user identity and a timestamp | The watermark advanced | Advance past the newest entry the user was shown |
| Digest | A time range and a channel | One post and one send row | Report success when it posted nothing |
| Announcements | A human author | A scheduled, audience-targeted entry | Enter the analysis queue |

## Sequence: automatic capture through to the popup

```text
forge            endpoint          queue          analysis job        entries      user
  │                 │                │                 │                 │           │
  ├─ merge event ──►│                │                 │                 │           │
  │                 ├─ verify sig    │                 │                 │           │
  │                 ├─ insert ──────►│  (on conflict   │                 │           │
  │                 │                │   do nothing)   │                 │           │
  │◄── 200 ─────────┤                │                 │                 │           │
  │                 │                │                 │                 │           │
  │              nightly ────────────┼────────────────►│                 │           │
  │                 │                │  select where   │                 │           │
  │                 │                │  analysed_at is  │                │           │
  │                 │                │  null, limit N  │                 │           │
  │                 │                │                 ├─ describe ─────►│           │
  │                 │                │◄── mark analysed┤                 │           │
  │                 │                │                 │                 │           │
  │                 │                │                 │                 │◄─ open ───┤
  │                 │                │                 │      entries after watermark│
  │                 │                │                 │      ──────────────────────►│
  │                 │                │                 │                 │◄─ dismiss ┤
  │                 │                │                 │       watermark := now      │
```

The 200 is returned before analysis exists. That is the point of the queue: the
forge's retry policy and the model's availability are decoupled.

## Sequence: the daily digest

```text
scheduler ──► digest job
                 ├─ read the previous send row for this channel
                 ├─ select entries created after that send's cutoff
                 ├─ select announcements whose start date is today
                 ├─ if both sets are empty:
                 │      write send row {status: skipped, reason: "no entries"}  ── stop
                 ├─ render markdown to the channel's block format
                 ├─ truncate to the channel's block limit with an "and N more" tail
                 ├─ post
                 └─ write send row {status: sent | failed, external_id, error}
```

The cutoff comes from the previous **send row**, not from "now minus 24 hours". A
job that failed yesterday must not create a hole; reading the last successful
cutoff makes the next run cover both days.

## Failure behaviour at each boundary

- **Forge unreachable at capture.** Nothing to do — the forge retries. Do not
  poll as a fallback unless capture has been missing events long enough to
  measure; a poller and a webhook both writing the same natural key is fine, and
  a poller replacing the webhook is a different design.
- **Store unreachable at capture.** Return a non-2xx so the forge retries. This
  is the one case where failing the request is correct.
- **Model unavailable during analysis.** The queue rows stay unanalysed. The next
  night picks them up. Cap the retry count per row and record the last error, so
  a permanently poisonous payload does not occupy the batch forever.
- **A single row fails analysis.** Record the failure on that row, continue with
  the batch. One bad payload must not stop the other twelve.
- **The popup cannot reach entries.** Render nothing. A what's-new popup that
  shows an error dialog on login is worse than a popup that does not appear.
- **The channel rejects the digest post.** Write the send row with `failed` and
  the error, and leave the cutoff unadvanced so the next run retries the same
  range.

## The watermark, precisely

The watermark is a per-user timestamp. The set a user sees is:

```text
entries where published_at > max(user.watermark, now - window)
                          and published_at <= now
                          and audience matches the user
order by published_at desc
```

Two consequences worth stating explicitly:

- **A new user sees the window, not the history.** Their watermark is null, so
  `max(null, now - window)` is the window floor. That is the desired behaviour:
  a first login is not a changelog archive.
- **Dismissal sets the watermark to the newest entry the user was shown**, not to
  `now`. If an entry is published while the popup is open, setting the watermark
  to `now` would swallow it unseen.

## Announcements

An announcement is authored, not derived. It carries:

- `starts_on` — the date it becomes visible. A pinned announcement posts to the
  digest channel on this date, once.
- `ends_on` — optional. After it, the announcement stops appearing in the popup
  even for users whose watermark predates it.
- `audience` — roles, groups, or "everyone". Resolved server-side.
- `pinned` — whether it sorts above analysed entries in the popup.

Announcements and analysed entries share a rendering path and nothing else. Keep
them in separate tables: they have different lifecycles, different authorship, and
different permissions, and merging them produces a table where half the columns
are always null.

## Backfill

Backfill runs through the same analysis path as the nightly job, with three
additions:

1. **Count the input first** and print an estimate of the model cost before
   anything is called. A month of merged work on a busy repository is a large
   number of tokens.
2. **Cap the batch size** and run batches under an explicit total limit, so a
   miscounted estimate cannot become an unbounded bill.
3. **Set `published_at` from the merge date**, not from the backfill run time.
   Otherwise every historical change appears to have shipped today and every
   user's popup shows the entire history at once.
