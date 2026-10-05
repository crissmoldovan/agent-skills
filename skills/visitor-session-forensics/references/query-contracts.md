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
| `{RELEASE_FILES}` | the paths of the files the releases live in the window ship, from R1: the files whose path a loaded file may keep | `'/assets/app-3f2a9c.js'` |
| `{VISITS}` | the visits the "who is there" query tied to the named people: a visit in which a named identity signed in and no other identity appears | `'00000000-0000-4000-8000-000000000101'` |

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
  arrives on top of the clicks it is made of.
- **Typed text is never read.** Some sources record what is typed, as input or change events or as
  field values inside a recording, and some do not; that is a property of the source, so S3 checks
  it per source, from the source's own settings or schema, before the first query. Every query
  names the fields it returns and leaves out any input value, field value or keystroke payload, and
  a source that cannot leave typed values out of what a query returns is not read; the report says
  which source and why (H2).
- **Saved as returned.** A result the tool wrote to a file is copied; a small one shown inline is
  copied, never retyped.
- **A URL is cut to its host and route.** A page address, a referrer or a request the page made can
  carry a sign-in link's token, an email address or an id: in its query, in its fragment, or as a
  segment of its path (`/verify/<token>`). So the query and the fragment are dropped, and each
  segment of the path is kept only when it is a plain word of the site's routes, lowercase letters
  and hyphens, at most 32 characters; any other segment (one holding a digit, a capital, an `@`, a
  `%`, a `.` or an `=`, or a longer run) is replaced by `:segment`. The one exception is a file a
  page loaded from the site's own hosts, which keeps its path only when it is one of
  `{RELEASE_FILES}`, the files the release ships, because its name carries the version tag Q5
  compares with the release (R1); an avatar named for an account or an export named for a token is
  not one, and is cut like any URL. Its query is dropped either way. Cut it in the query where the
  store can, as in
  `concat(domain(url), arrayStringConcat(arrayMap(s -> if(s = '' OR match(s, '^[a-z-]{1,32}$'), s, ':segment'), splitByChar('/', path(url))), '/'))`;
  where it cannot, cut it before the row leaves the run directory (H4).
- **Controls are named, and read no more than they must.** Each control is one the yes named (H3).
  A control over anyone other than the named people, or over a time outside the window, returns a
  count and no identifiers. A control need not fall in the window: the same query, over the
  control's identity and a time it is known to have been there within the source's held range,
  has to find it.

The filter every events query after Q0 starts from:

```sql
WITH visits AS (
  SELECT DISTINCT dt, raw FROM (
    SELECT dt, raw FROM {TABLE}
      WHERE source_id = {SOURCE_ID} AND dt BETWEEN {FROM} AND {TO}
    UNION ALL  -- this half, and the DISTINCT, only where the store keeps an archive apart
    SELECT dt, raw FROM {ARCHIVE_TABLE}
      WHERE source_id = {SOURCE_ID} AND dt BETWEEN {FROM} AND {TO}
  )
  WHERE JSONExtractString(raw, 'visit_id') IN ({VISITS})
    AND domain(JSONExtractString(raw, 'page_url')) IN ({HOSTS})
)
```

Q0 has no `{VISITS}` yet, because finding them is its job: it starts from the same shape without
the visit line. Where the store keeps no archive apart, both read `{TABLE}` alone.

**The visit, never the browser.** A browser identifier outlives a sign-out: one browser can carry a
named person's visit, then another person's, then a visitor who never signed in. A filter on the
browser reads all three as the named person's. So every query after Q0 reads the visits Q0 tied to
the named people and nothing else their browsers sent. A visit that also carries another identity,
as a shared machine or an account switched within one visit does, is left out and counted, never
split by a guess. Events of a kept visit sent before its sign-in carry no identity, and on a shared
machine may be whoever used the browser first: they are reported apart, as the visit's before
sign-in, never as the person's own.

## Q0. Who is there

**Reads** the events in the window over `{HOSTS}`, filtered to `{IDENTITIES}`, and for the visit
rows every event of a visit a named identity signed in to. Only when the request asked about
everyone in the window is that filter dropped.

**Returns** one row per identity and browser:
`["<identity>", "<name the page recorded>", "<visitor id>", visits, events, "<first seen>", "<last seen>"]`,
and one row per visit in which a named identity signed in:
`["<identity>", "<visit id>", "<visitor id>", "<first seen>", "<signed in>", "<last seen>", other_identities]`,
where `<signed in>` is the time of the visit's first event that carries the identity.

- The identity and the name are per visit: an event sent before sign-in carries neither. A visitor
  with no identity is reported *unnamed*, never matched by a guess.
- `other_identities` is how many identities the visit's events carry besides the one it is tied
  to, read in the query over every event of that visit and returned as a count, never a name (H3).
  Another named person counts as much as anyone: a visit two of the named people signed in to is
  tied to neither.
- `{VISITS}` is the visits whose `other_identities` is 0. A visit with more is left out of every
  later query and counted, and the report gives the count and never whose the other identity is.
- Accounts bound as F5 are counted and left out.

```sql
-- the filter above, without its visit line; then, one row per visit a named identity signed in to:
SELECT JSONExtractString(raw, 'visit_id') AS visit,
  any(JSONExtractString(raw, 'visitor_id')) AS browser,
  groupUniqArrayIf(JSONExtractString(raw, 'identity'), JSONExtractString(raw, 'identity') IN ({IDENTITIES})) AS named,
  uniqIf(JSONExtractString(raw, 'identity'), JSONExtractString(raw, 'identity') != '') - 1 AS other_identities,
  min(dt) AS first_seen, minIf(dt, JSONExtractString(raw, 'identity') IN ({IDENTITIES})) AS signed_in, max(dt) AS last_seen
FROM visits GROUP BY visit HAVING length(named) > 0
```

**Control.** The same query, with `{IDENTITIES}` set to a control identity the yes named (the
person bound as F1, or an account bound as F5) and the window set to a time that identity is known
to have visited within the source's held range, finds it. A visit made now for the purpose is one
such time, and the "control visit" the contracts below refer to.

## Q1. Events

**Reads** the visits filter above.

**Returns** one row per event, in time order: `["<visit>", ms, "<event>", "<label>"]`, with
`"<from screen>"` added for a screen change and `0, x, y` for a pointer event. `<visit>` may be a
short prefix of the visit id, enough to keep visits apart; the full id goes in Q2.

- The label is the first of these the element carries: the site's own tracking attribute, its
  accessible label, its navigation target, its selector; a navigation target is cut like any URL.
  It is the site's words for the element, and can hold what the page showed a person, as
  `Open Dana Example's profile` and `Approve INV-ABCD` do with no `@`, long number or long token
  for a pattern to find. So no pattern sorts the labels: every label is written in the detail and
  nowhere else, and outside it the element is described only by its type and place, such as "a
  link" or "a button in the header", or as `:label` (S6, H5).
- Clicks are counted as `event IN ('click', 'tap')`.
- An event before its visit's `<signed in>` (Q0) is counted apart, as the visit's before sign-in.

**Control.** A visit known to have used a touch device shows taps, and a visit known to have
clicked shows clicks. A control visit that is not a named person's returns the two counts only.

## Q2. Visit facts

**Returns** one row per visit:
`["<visit>", "<full visit id>", "<identity>", "<screen size>", "<window size>", "<pixel ratio>", automated, ["<masked address>", …], "<entry referrer>", "<release>"]`.

- Addresses are masked in the query where the store can (H4); where it cannot, they are masked
  before the row leaves the run directory. The entry referrer is cut to its host and route the same
  way.
- `automated` is the browser's own report (the evidence signals say what it does not prove).

**Control.** The control visit from Q0 has one row, with its release.

## Q3. Devices

**Returns** one row per browser, not per person:
`["<visitor id>", "<user agent>", "<graphics renderer>", cores, memory_gb, fonts, plugins, touch_points, "<zone the browser reports>", "<language>"]`.

- The fingerprint often arrives on a visit's opening event, which may carry no user agent or
  language. Take those from other events of the same visits (`{VISITS}`), never from anything
  else the browser sent, or the device reads as blank.
- A browser may send its fingerprint only on its first visit in the window. A browser with none is
  *device unknown*.
- A kept visit's events before its sign-in carry no identity, and the opening event that holds the
  fingerprint is often one of them. They are read for the device all the same: the row is the
  browser's, keyed by its visitor id and never by an identity, so an event with none does not
  become a second, nameless person, and the device says which browser the visit ran in, never who
  used it.

**Control.** The control visit's browser has a row with a user agent.

## Q4. Recordings

**Returns** one row per recording:
`["<visit>", "<recording id>", first_ms, last_ms, pointer_positions, pointer_batches, scrolls, selections, key_presses, blurs, focuses, multi_clicks, api_calls]`.

- `first_ms` and `last_ms` say which minutes the recording covers. A recording is not the whole
  visit.
- A recording is read only as these counts and times: never a key, a value or a frame of what was
  on screen. What had focus when a key was pressed may be read from the recording's breadcrumbs,
  as the element and not what it held.
- `api_calls` counts requests to the site's own paths that the questions are about, such as an
  assistant's endpoint or a sign-in renewal.
- The detail names a recording by its id, which someone signed in to the store opens there; no
  link to it is written. A recording's address carries its id, and sometimes a signed token, in its
  path: cut to its route it opens nothing, and uncut it would take that id out of the run (H4).

**Control.** The control visit has a recording that covers it, with pointer positions.

## Q5. Files loaded

**Returns** one row per file a page loaded:
`["<visit>", ms, "<kind>", "<host>", "<path>", "<version tag>", transfer_size, encoded_size, decoded_size, status]`.

- The three sizes are the browser's Resource Timing values; the evidence signals give their
  meaning.
- `status` separates a refused file (401, 403) from a missing one (404) and a failed one (5xx).
- `<path>` is cut to its route as every URL is, unless it is one of `{RELEASE_FILES}`, whose path
  is kept for its version tag; no query is returned. R1 runs first, to give that list.

**Control.** A file of a few kilobytes or more that the control visit loaded for the first time
shows a transfer above its encoded size.

## Q6. Page loads (optional)

**Returns** one row per page load:
`["<identity>", ms, duration_s, largest_contentful_paint_s, "<referrer>", visible_at_start, "<connection type>"]`,
with the referrer cut to its host and route.

**Control.** The control visit's first page load has a row.

## A1. Accounts

**Reads** the auth store, filtered to `{IDENTITIES}` and to the window, as every other query is.

**Returns** one row per account: its sessions active in the window, created at or before `{TO}`
and renewed or ended at or after `{FROM}` (created, renewed, user agent, address, masked before it
leaves the run), and counts of what the product stored for it in the window. Counts only: never
the contents of a person's own records, and nothing about the account dated before or after the
window.

- A session's time that falls outside the window, such as the creation of one that began before
  it, is shown as `before the window` or `after the window`, never as its value.
- An account's history outside the window (when it was created or invited, a sign-in before or
  after, its sessions then) is read only when the request names it and the yes covers it (S2), as
  a read of its own. Otherwise the report says it was not read.
- Where sign-in runs on the site's servers, a session's user agent and address are the servers'.
  The report says so.

**Control.** The control account has a session active at the control visit's time.

## A2. Sign-in log

**Reads** the auth provider's log, filtered to the people's account ids or identities and to the
window, **a day at a time** where the log caps the rows one query returns.

**Returns** one row per log line: `["<time>", "<kind>", "<message>"]`, saved as returned.

- A day that returns nothing may be past the log's retention, not quiet.

**Control.** A day known to be busy returns rows, read as a count of that day's lines with no
filter to the people and no identifiers returned, or the control identity's own sign-in on a day
it is known to have signed in. Without either, the report says the sign-in record could not be
shown to be complete.

## R1. Releases (for live or cached)

**Reads** the project's release history (F7): the merges or deploys in the window, and the
release live at each minute that matters.

```bash
git log <release branch> --first-parent --since=<from> --until=<to> --format='%h|%cI|%s'
git rev-list -1 --first-parent --before=<UTC time> <release branch>   # the release live then
git show <commit>:<file> | sha256sum | cut -c1-16                     # that file's tag, where the served file is committed as served
```

**Returns** the merges with their times, and per release the paths of the files it ships
(`{RELEASE_FILES}`) and the version tags they would carry.

- A merge time is a release time give or take the deploy; the report says so.
- The tag's length and hash are the project's; read them from its build, never assume them.
- The `git show` line holds only where the file is served exactly as it is committed. A built
  site's tag hashes build output that git does not hold: build that release, or read its build
  manifest, and take the tag from there. `sha256sum` is `shasum -a 256` where only that is
  installed.

**Control.** The release live at the control visit's time carries the tag that visit loaded.
