# Release ledger — reference data model

Portable SQL, written against ANSI types with PostgreSQL spellings where a choice
was needed. Rename freely; the constraints are the part that matters, and each one
is annotated with the failure it prevents.

## Overview

| Table | Holds | Written by |
|---|---|---|
| `release_capture_queue` | Raw merge payloads, unanalysed | The capture endpoint |
| `release_entries` | Analysed, user-facing entries | The analysis job |
| `release_announcements` | Hand-written, scheduled entries | Admins |
| `release_dismissals` | One watermark per user | The dismiss endpoint |
| `release_sends` | One row per digest attempt | The digest job |

## 1. Capture queue

```sql
create table release_capture_queue (
  id              bigserial primary key,
  source          text        not null,          -- 'github', 'gitlab', 'manual'
  repository      text        not null,
  change_number   integer     not null,          -- PR / MR number
  merged_at       timestamptz not null,
  payload         jsonb       not null,          -- the whole event, unmodified
  analysed_at     timestamptz,
  attempt_count   integer     not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),

  constraint release_capture_queue_natural_key
    unique (source, repository, change_number)
);

create index release_capture_queue_pending
  on release_capture_queue (merged_at)
  where analysed_at is null;
```

- **`unique (source, repository, change_number)`** is the idempotency key. Forges
  replay deliveries after a timeout or a manual redelivery; insert with
  `on conflict do nothing` and a replay costs one wasted statement.
- **`payload` stores the event unmodified.** Do not extract fields at capture
  time. Every field you decide not to keep is a field the analysis prompt cannot
  use six months from now, and re-fetching from the forge needs a credential the
  capture path deliberately does not have.
- **`attempt_count` and `last_error`** exist so a permanently unanalysable row
  can be excluded from the batch instead of blocking it every night.
- **The partial index** is what makes "select the unanalysed batch" cheap once
  the table has a year in it.

## 2. Entries

```sql
create table release_entries (
  id              uuid        primary key default gen_random_uuid(),
  queue_id        bigint      references release_capture_queue (id),
  kind            text        not null
                    check (kind in ('feature','bug_fix','improvement',
                                    'security','ops','docs','breaking')),
  title           text        not null,
  short_md        text        not null,
  medium_md       text,
  detail_md       text,
  refs            jsonb       not null default '[]'::jsonb,
  ticket_ref      text,
  reporter_user_id uuid       references users (id),
  published_at    timestamptz not null,
  created_at      timestamptz not null default now(),

  constraint release_entries_queue_unique unique (queue_id)
);

create index release_entries_published on release_entries (published_at desc);
```

- **`kind`'s check constraint** is the `describe-changes` classification, exactly.
  Keep the two in step; a ledger that invents an eighth kind and a describer that
  emits seven produce rows nothing renders.
- **`unique (queue_id)`** stops a re-run of the analysis job from producing a
  second entry for the same change. A nullable `queue_id` leaves room for entries
  an agent wrote by hand in a manual-only ledger.
- **`published_at` is the merge date, not the analysis date.** Backfill depends on
  this; so does the "since you were away" arithmetic.
- **`refs`** is the `describe-changes` reference array — path, line range, and an
  optional commit. Store it as given; render it on the detail page only.
- **`reporter_user_id` will be null for most rows** in any real product, because
  most merged changes have no linked request. Render its absence as absence.

## 3. Announcements

```sql
create table release_announcements (
  id           uuid        primary key default gen_random_uuid(),
  title        text        not null,
  body_md      text        not null,
  starts_on    date        not null,
  ends_on      date,
  audience     text        not null default 'everyone',
  audience_ids text[]      not null default '{}',
  pinned       boolean     not null default false,
  author_id    uuid        not null references users (id),
  created_at   timestamptz not null default now(),

  constraint release_announcements_window
    check (ends_on is null or ends_on >= starts_on)
);
```

- **Separate from `release_entries`** because the lifecycles differ: an
  announcement has a schedule and an audience, an entry has a diff and a
  classification, and a merged table is half-null in both directions.
- **`audience` plus `audience_ids`** keeps the common case (`everyone`) cheap and
  the targeted case explicit. Resolve it server-side, always.
- **`starts_on` is a date, not a timestamp**, because "goes live on Monday" is how
  people write announcements and a timezone-bearing instant invites a 00:00 UTC
  surprise.

## 4. Dismissals

```sql
create table release_dismissals (
  user_id       uuid        primary key references users (id) on delete cascade,
  watermark_at  timestamptz not null,
  updated_at    timestamptz not null default now()
);
```

- **One row per user**, so `primary key (user_id)`. A per-event dismissal table
  grows without bound and answers the same question more slowly.
- **The watermark is a timestamp, not an entry id**, so entries inserted out of
  order (a backfill, a late analysis) are still covered by a single comparison.
- **Where access policies exist**, this is the one ledger table an end user writes:
  allow insert and update where the row's `user_id` equals the caller, and nothing
  else.

## 5. Sends

```sql
create table release_sends (
  id            uuid        primary key default gen_random_uuid(),
  channel       text        not null,
  recipient     text,
  provider      text        not null,          -- 'slack', 'email', ...
  status        text        not null
                  check (status in ('sent','failed','skipped')),
  reason        text,
  entry_count   integer     not null default 0,
  cutoff_at     timestamptz not null,          -- entries after this were included
  external_id   text,
  external_url  text,
  error         text,
  sent_at       timestamptz not null default now(),
  triggered_by  text
);

create index release_sends_channel_time on release_sends (channel, sent_at desc);
```

- **A row per attempt, including the ones that sent nothing.** `skipped` always
  carries a `reason`. This is the difference between "quiet day" and "the job has
  been throwing for a week" — without it, both look like silence.
- **`cutoff_at`** is what the next run reads to find its range. Reading it from
  the last *successful* send means a failed night is covered by the next one
  instead of becoming a hole.
- **`external_id` and `external_url`** make a send auditable from the ledger side
  without querying the chat provider.

## The popup query

```sql
select e.id, e.kind, e.title, e.short_md, e.published_at
  from release_entries e
 where e.published_at > greatest(
         coalesce((select watermark_at from release_dismissals
                    where user_id = :user_id), 'epoch'::timestamptz),
         now() - interval '30 days')
   and e.published_at <= now()
 order by e.published_at desc
 limit 50;
```

`greatest(watermark, now - window)` is the cap. It is one expression and it covers
both the new user and the long-absent one; a code path that special-cases "no
watermark row" is a second place for the window to be wrong.

Announcements are a second query against `release_announcements` filtered by
`starts_on <= current_date`, `ends_on is null or ends_on >= current_date`, and the
caller's audience — unioned in the application, sorted with `pinned` first.

## Grants and policies

Where the database enforces per-row access:

1. **Revoke first, then grant what is needed.** A default that grants insert,
   update, and delete on every new table is how a browser-writable ledger happens
   without anything failing.
2. `release_dismissals` — the only table an end user writes. Insert and update
   where `user_id` equals the caller.
3. `release_entries` and `release_announcements` — read-only for end users if the
   popup queries the database directly; no end-user access at all if the popup
   goes through a server endpoint that filters by audience. Prefer the second: it
   keeps audience enforcement in one place.
4. `release_capture_queue` and `release_sends` — no end-user access in either
   direction. They are written by privileged server code only.
