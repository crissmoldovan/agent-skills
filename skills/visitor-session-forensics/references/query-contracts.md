# Query contracts

One contract per query the skill runs: what it reads, what it filters on, the row it returns, and
the control that proves it can see what it counts. They are contracts, not one store's dialect.
The SQL below is illustrative, in a generic SQL with ClickHouse-style JSON functions, and is
translated to the store's own; the filters, the row shape and the control are what must survive
the translation.

## Placeholders

| placeholder | holds | example |
|---|---|---|
| `{SOURCE_ID}` | the site's source or application id in the store | stays a placeholder here; the project's overlay holds the real one |
| `{TABLE}` | the table holding the site's events; where the store keeps recent rows apart from older ones, `{TABLE}` for the recent rows and `{ARCHIVE_TABLE}` for the older | stays a placeholder here, as `{SOURCE_ID}` does |
| `{FROM}`, `{TO}` | the window, in UTC | `'2026-01-06 12:00:00'`, `'2026-01-06 18:00:00'` |
| `{HOSTS}` | the hosts bound as F4, quoted | `'app.example.com'` |
| `{IDENTITIES}` | the named people's sign-in identities, quoted | `'dana@example.com', 'sam@example.com'` |
| `{VISITORS}` | the browser identifiers the "who is there" query found for them | `'00000000-0000-4000-8000-000000000001'` |

A real source id, table name or host goes in the project's overlay, never in this file.

## Rules for every query

- **One column of JSON rows.** Each row is one JSON array, so a result is saved as it was returned
  and nothing has to read a table's formatting.
- **UTC.** The window is UTC in every query, whatever zone the report is shown in.
- **The host, never an environment field.** Each event is kept or left out by its page's own host
  (`{HOSTS}`). The same browser may have visited a test site, and an environment field is set by
  whoever configured the sender.
- **Both stores, once.** Where recent rows and older rows are kept apart, read both and take the
  distinct rows, because for a while the two hold the same ones.
- **A click is `click` or `tap`.** A touch device sends taps and no clicks at all. A rage click
  arrives on top of the clicks it is made of. A form field's input, a select and a text area send
  no event.
- **Saved as returned.** A result the tool wrote to a file is copied; a small one shown inline is
  copied, never retyped.

The filter every events query starts from:

```sql
WITH visits AS (
  SELECT DISTINCT dt, raw FROM (
    SELECT dt, raw FROM {TABLE}
      WHERE source_id = {SOURCE_ID} AND dt BETWEEN {FROM} AND {TO}
    UNION ALL
    SELECT dt, raw FROM {ARCHIVE_TABLE}
      WHERE source_id = {SOURCE_ID} AND dt BETWEEN {FROM} AND {TO}
  )
  WHERE JSONExtractString(raw, 'visitor_id') IN ({VISITORS})
    AND domain(JSONExtractString(raw, 'page_url')) IN ({HOSTS})
)
```

## Q0. Who is there

**Reads** the events in the window over `{HOSTS}`, filtered to `{IDENTITIES}`. Only when the
request asked about everyone in the window is that filter dropped.

**Returns** one row per identity and browser:
`["<identity>", "<name the page recorded>", "<visitor id>", visits, events, "<first seen>", "<last seen>"]`.

- The identity and the name are per visit: an event sent before sign-in carries neither. A visitor
  with no identity is reported *unnamed*, never matched by a guess.
- Accounts bound as F5 are counted and left out.

**Control.** The person bound as F1, or an account bound as F5, visits the site in the window and
is found.

## Q1. Events

**Reads** the visits filter above.

**Returns** one row per event, in time order: `["<visit>", ms, "<event>", "<label>"]`, with
`"<from screen>"` added for a screen change and `0, x, y` for a pointer event. `<visit>` may be a
short prefix of the visit id, enough to keep visits apart; the full id goes in Q2.

- The label is the first of these the element carries: the site's own tracking attribute, its
  accessible label, its navigation target, its selector.
- Clicks are counted as `event IN ('click', 'tap')`.

**Control.** A visit known to have used a touch device shows taps, and a visit known to have
clicked shows clicks.

## Q2. Visit facts

**Returns** one row per visit:
`["<visit>", "<full visit id>", "<identity>", "<screen size>", "<window size>", "<pixel ratio>", automated, ["<masked address>", …], "<entry referrer>", "<release>"]`.

- Addresses are masked in the query where the store can (H4); where it cannot, they are masked
  before the row leaves the run directory.
- `automated` is the browser's own report (the evidence signals say what it does not prove).

**Control.** The control visit from Q0 has one row, with its release.

## Q3. Devices

**Returns** one row per browser, not per person:
`["<visitor id>", "<user agent>", "<graphics renderer>", cores, memory_gb, fonts, plugins, touch_points, "<zone the browser reports>", "<language>"]`.

- The fingerprint often arrives on a visit's opening event, which may carry no user agent or
  language. Take those from the browser's other events, or the device reads as blank.
- A browser may send its fingerprint only on its first visit in the window. A browser with none is
  *device unknown*.
- An event sent before sign-in was known has no identity; leave it out, or it becomes a second,
  nameless person.

**Control.** The control visit's browser has a row with a user agent.

## Q4. Recordings

**Returns** one row per recording:
`["<visit>", "<recording id>", first_ms, last_ms, "<link>", pointer_positions, pointer_batches, scrolls, selections, key_presses, blurs, focuses, multi_clicks, api_calls]`.

- `first_ms` and `last_ms` say which minutes the recording covers. A recording is not the whole
  visit.
- What had focus when a key was pressed may be read from the recording's breadcrumbs. The keys
  themselves are never recorded.
- `api_calls` counts requests to the site's own paths that the questions are about, such as an
  assistant's endpoint or a sign-in renewal.
- The link opens the recording in the store and needs a sign-in there; it goes in the detail only.

**Control.** The control visit has a recording that covers it, with pointer positions.

## Q5. Files loaded

**Returns** one row per file a page loaded:
`["<visit>", ms, "<kind>", "<host>", "<path>", "<version tag>", transfer_size, encoded_size, decoded_size, status]`.

- The three sizes are the browser's Resource Timing values; the evidence signals give their
  meaning.
- `status` separates a refused file (401, 403) from a missing one (404) and a failed one (5xx).

**Control.** A file the control visit loaded for the first time shows a transfer at least its
encoded size.

## Q6. Page loads (optional)

**Returns** one row per page load:
`["<identity>", ms, duration_s, largest_contentful_paint_s, "<referrer>", visible_at_start, "<connection type>"]`.

**Control.** The control visit's first page load has a row.

## A1. Accounts

**Reads** the auth store, filtered to `{IDENTITIES}`.

**Returns** one row per account: when it was created, invited and confirmed, its last sign-in, its
sessions (created, renewed, user agent, address, masked before it leaves the run), and counts of
what the product stores for it. Counts only: never the contents of a person's own records.

- Where sign-in runs on the site's servers, a session's user agent and address are the servers'.
  The report says so.

**Control.** The control account has a row whose last sign-in is in or after the window.

## A2. Sign-in log

**Reads** the auth provider's log, filtered to the people's account ids or identities, **a day at a
time** where the log caps the rows one query returns.

**Returns** one row per log line: `["<time>", "<kind>", "<message>"]`, saved as returned.

- A day that returns nothing may be past the log's retention, not quiet.

**Control.** A day known to be busy returns rows. Without one, the report says the sign-in record
could not be shown to be complete.

## R1. Releases (for live or cached)

**Reads** the project's release history (F7): the merges or deploys in the window, and the
release live at each minute that matters.

```bash
git log <release branch> --first-parent --since=<from> --until=<to> --format='%h|%cI|%s'
git rev-list -1 --first-parent --before=<UTC time> <release branch>   # the release live then
git show <commit>:<file> | shasum -a 256 | cut -c1-16                  # that file's tag, where the tag is a content hash
```

**Returns** the merges with their times, and per release the version tags its files would carry.

- A merge time is a release time give or take the deploy; the report says so.
- The tag's length and hash are the project's; read them from its build, never assume them.

**Control.** The release live at the control visit's time carries the tag that visit loaded.
