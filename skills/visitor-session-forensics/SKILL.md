---
name: visitor-session-forensics
description: "Find out what named people did on a live site from its own records (events, session recordings, page loads, sign-ins), evidenced row by row, consent first: write down the purpose and get a yes for this run before any query; read only the people, window and hosts named; prove every counter with a control; say whether the site loaded for them, whether they saw the live release or a cached copy, and whether a person or an agent was at the controls, weighing signals that are uncalibrated and never proof; keep addresses, devices and email addresses out of the summary; and check a published report signed out. Symptoms: what did X do on the site, show me their sessions, it would not load for her, did they see the new release, was that a person or an agent, did they really sign in. It reads records and contacts nobody; what someone said in an agent session is mine-session-transcripts', and fixing a problem a visitor reported is resolve-problem-report's."
license: MIT
compatibility: "Any site that records its visitors where the agent can read the records read-only: an analytics or observability store (events, session recordings, file timings) and an auth provider's sign-in log. The query contracts in references/query-contracts.md use a generic SQL, translated to each store's own. No script and nothing installed; it writes only the report and the run directory bound as F9."
metadata: "group=workflow; lifecycle=investigation; version=1.0.0; author=crissmoldovan"
allowed-tools: Read Write Grep Glob Bash
---

# Visitor session forensics

A site that records its visitors (page and click events, session recordings, the timings of every
file a page loaded, sign-ins) can answer what a named person did on it: which screens they opened,
what they clicked, whether the site loaded for them, whether they saw the release that was live or
a copy their browser kept, and whether the hand on the mouse was theirs or an agent's. The same
records are a dossier on that person. So this skill starts with the purpose and a yes, reads only
what the purpose needs, and makes every claim a count over rows that a reader could count again.

Three failures do the damage.

**Reading before asking.** The records exist and the query is easy, so nobody writes down why a
person is being looked at, or who agreed to it. A report made that way is surveillance whatever it
finds, and it travels: into a message, a zip, a published page.

**A zero that means "could not see".** A count of clicks that leaves out taps reports a phone
user's whole visit as idle. A sign-in log kept for a few days reports a busy day as a quiet one. A
query filtered on an environment field rather than the page's host mixes a test site's visits into
a report about the live one. Each of these looked like an answer.

**A weighing read as a verdict.** "No pointer movement and a steady beat, so an agent" is a guess
from thresholds nobody has measured against sessions whose answer was known. Said as a finding
about a named person, it is an accusation.

This skill asks first, minimises in the query and not after it, puts a control beside every
counter, and labels every signal it weighs. It ships no script and no report template: a project
that has its own report tool binds it as F11.

### What this skill does not own

| The job | Whose it is | What this skill does with it |
|---|---|---|
| What a person said to an agent in an agent session | `mine-session-transcripts` | Nothing. A session there is a conversation with an agent; here it is a visit to a site. |
| Taking a problem a visitor reported to its fix | the skill bound as F12, by default `resolve-problem-report` | Gathers what happened on the visitor's side, every claim citing its rows, and hands that over as the evidence. |
| What the site's code records, and what a recorded label points at | the skill bound as F13, by default `investigate-codebase` | Asks it when an event or a label has to be traced to the code that sends it. |
| A credential a source needs | the skill bound as F14, by default `secure-credential-setup` | Stops and hands over. A key is never asked for in the conversation. |
| A question only another person can answer, such as what the site's visitors were told | the skill bound as F15, by default `request-answers` | Writes the question. It sends nothing itself. |
| Keeping the record of who said yes to a run, to what, and when, after the raw rows are gone | the skill bound as F17, by default `decision-journal` | Hands it the request, the question asked, each answer and its time. Never a row. |
| How many people used each screen this week | none: an aggregate count | Not this skill. A count of everyone needs no names, so it is made without identifiers. |

## When to Use

- Someone asks what a named person, or a named set of people, did on a live site, and the answer has
  to be evidenced visit by visit: *"what did Dana do on the site yesterday"*, *"show me their
  sessions"*.
- A visitor reported that the site did not load or did not work for them, and their side of it has
  to be seen before anyone changes anything.
- Whether a visitor saw the current release or a copy their browser kept.
- Whether an action recorded under a person's account was theirs, someone else's at their
  computer, or an agent's.
- Whether a person signed in, or only had a tab open that kept renewing its sign-in.

Do not use it for usage counts that need no names, to rate how hard someone worked, to find where
someone is, or to identify a visitor who never signed in (H2). Do not use it on records you are not
entitled to read for the purpose at hand.

## Bindings

A project can adapt this skill without copying it: it binds these slots and adds to the steps by
their ids, as the pack's project-adaptation guide (`docs/project-adaptation.md`) describes. A slot
nobody binds keeps its default. The slots take the letter F, because a project often adapts this
skill beside others whose `B` slots would be read as its own.

| id | slot | kind | default |
|---|---|---|---|
| F1 | who may authorise a run: the one person whose yes, given for that run, allows the site's records to be read | value | the person who asked, once they confirm they are entitled to read these records for this purpose; asked for every run, never carried over from an earlier one |
| F2 | what the site's visitors were told about what is recorded, and where they were told it | value | ask once; with nothing known, the report says so and goes to nobody but the person bound as F1 |
| F3 | the sources read, each with what it records and how long it keeps it | value | ask once; a source nobody named is not read |
| F4 | the hosts that are the site, and which of them is live | value | ask once; events from any other host are counted and left out |
| F5 | accounts that are not people: test, monitoring and the team's own | value | none known: no account is left out, and the report says so |
| F6 | the names the site's screens and controls had during the window | value | read from the window's own records (S6), never invented |
| F7 | where the release history is read from, for the live-or-cached check | value | ask once; without it, the report says the comparison was not made |
| F8 | the zones times are shown in, beside UTC | value | UTC only |
| F9 | where the raw rows are kept during a run, and when they are deleted | value | a scratch directory outside every repository, deleted once the report is handed over |
| F10 | who may receive the summary, who the detail, and by what route | value | the person bound as F1, as a file; anyone else, or any publication, only on their yes for it |
| F11 | the tool that composes the report and checks it | value | none: the report is written from the rows, and every number in it traces to one |
| F12 | where a problem a visitor reported goes once the evidence is gathered | skill | `resolve-problem-report` |
| F13 | where a question about what the site's code records goes | skill | `investigate-codebase` |
| F14 | where a credential a source needs is set up | skill | `secure-credential-setup` |
| F15 | where a question for another person goes | skill | `request-answers` |
| F16 | the project's standing limits on reading records: the sources, sites or environments a run must not read, and who, if anyone, may lift a limit for one run | value | ask once, in the question for the yes (S2); with no limit named, the hard lines below are the only limits |
| F17 | where the yes for a run, each go and each refusal are recorded, so that they outlive the raw rows | skill | `decision-journal` |

## Hard lines

- **H1. Purpose and a yes before the first query.** No source is read until the request is written
  down (who asks, why, which people, which window, which site) and the person bound as F1 has said
  yes to this run, in answer to a question that named the people, the window, the sources and where
  the result goes. A yes for an earlier run does not carry over, and a wider run needs a new one.
- **H2. Some purposes are refused, whoever asks.** Rating a person's effort, diligence or
  performance; finding where a person is from a network address; identifying a visitor who did not
  sign in; reading what a person typed; and any purpose the request will not state. The run says
  which, and stops.
- **H3. Read only what the purpose needs.** The people, the window and the hosts named, filtered in
  the query and not afterwards. A wider question is a new request, with a new yes. The controls
  that prove each counter (S3) are reads too: the question for the yes names each one, and a
  control over anyone other than the named people, or over a time outside the window, returns a
  count and no identifiers.
- **H4. Raw rows stay in the run.** They hold full network addresses, email addresses and device
  details, so they are kept where F9 says, never in a repository, a message or a ticket, and are
  deleted when F9 says. A network address is masked before it is written anywhere else (to its /64
  for IPv6, to its first two octets for IPv4), and the network's owner is read from the registry
  with `whois` on the masked block, never from a lookup service that is told the address; of what
  the registry returns, only the owner and whether it is a hosting provider are kept, never a
  location. A URL is cut to its host and path before it is written anywhere else, because its query
  and fragment can carry a sign-in link's token, an email address or an id.
- **H5. Nothing outside the detail identifies anybody beyond the names asked about.** The answers
  that lead the report and the summary carry no network addresses, network names, device details,
  email addresses, session ids or URL queries. The detail, which may carry them, goes only to those
  bound as F10, and the report says plainly what the detail carries.
- **H6. Nothing invented.** Every number is a count of rows or arithmetic over rows, and every claim
  names its rows. A query that returns nothing is "none in the window", never "did nothing"; a visit
  with no recording is "no recording stored"; a mechanism that no row shows is not described.
- **H7. Person or agent is a weighing, never a finding.** The signals in
  [evidence signals](references/evidence-signals.md) are uncalibrated. The report gives the signals
  on both sides and what none of them rules out, and never states on their strength alone that a
  named person did or did not do something.
- **H8. Read-only, and contacts nobody.** The run writes to no source, changes no account or
  session, never signs in as a visitor, and never contacts the people it is about. A refusal by the
  harness, or a permission prompt, is reported as it came and never worked around.
- **H9. A published report's link goes to nobody until every address that serves it refuses a
  reader who is not signed in.** Publishing needs a yes for that publication (F10). Once it is up,
  each address the host serves it at, aliases the host made on its own included, is fetched with no
  cookie and no token, and each result is recorded. An address that serves it to that fetch means
  the report is taken down at once, the person bound as F1 is told, and the exposure is recorded:
  which addresses served it, and from when until it came down.
- **H10. The project's standing limits hold.** The run reads nothing the limits bound as F16 rule
  out. Where a limit can be lifted, only the person it names lifts it, for this run, in answer to a
  question that named the limit, and the go is recorded with its time. The yes for the run (H1)
  lifts no limit its question did not name, a go for an earlier run does not carry over, and a
  limit nobody may lift stops the run with that limit given as the reason.

## Procedure

[Query contracts](references/query-contracts.md) has the query for each step that reads a source:
what it filters on, the row it returns, and its control.
[Evidence signals](references/evidence-signals.md) has what the rows mean.

1. **S1. Write down the request.** Who asks; the purpose, in one sentence; the people, by name; the
   window, in UTC, with the zone it was given in; the site (F4); and where the result goes (F10).
   Ask for anything missing, and never guess a person or a window. A purpose H2 refuses ends the
   run here.
   **Complete when:** the request names who asks, a purpose H2 does not refuse, the people, a
   window, the hosts and the recipients.

2. **S2. Ask for the yes.** Put the request to the person bound as F1 as one question: these people,
   this window, these sources (F3), this purpose, the controls S3 will run and whose records each
   reads, what the summary and the detail will carry, where they go, and when the raw rows are
   deleted (F9). Say what the visitors were told about being recorded (F2), or that it is not known.
   Name every source a standing limit (F16) rules out, and who may lift that limit. Their go, for
   this run, is asked for in the same question when they are the person bound as F1; otherwise it
   is written as a question of its own through F15 (H10). A source that needs a credential goes to
   F14 first. Record each answer and its time through F17.
   **Complete when:** a yes for this run, and every go H10 requires, is recorded with its time, or
   the run has stopped.

3. **S3. Prove each source can see the window, and each counter can count.** For each source, read
   the time of the earliest and latest row it holds: a window older than its retention is reported
   as not held, not as quiet. Then run each counter the report will carry once on a control the yes
   named, a case whose true count is known not to be zero: a visit made for the purpose by the
   person bound as F1, an account bound as F5, a day known to be busy, a tap from a touch device.
   A control need not fall in the window: the same query, over the control's own identity and a
   time it is known to have been there within the source's held range, has to find it. A control
   over anyone other than the named people, or over a time outside the window, is run as a count
   and returns no identifiers (H3). A counter that does not find its control is not used, and the
   report says why.
   **Complete when:** every source has its held range, every counter has found its control, and
   every control read was one the yes named.

4. **S4. Find the people in the sources.** Run the "who is there" query over the hosts bound as F4,
   chosen by each page's own host and never by an environment field, and filtered to the named
   people's sign-in identities; it lists every account in the window only when the request asked
   about everyone. Map each person to the browser identifiers seen with their sign-in. One person
   may use several browsers and machines, so a device is read per browser and never per person.
   An account bound as F5 that turns up (a request about everyone, or a browser a named person
   shares with a test account) is left out and counted. A visitor the records do not name is
   "unnamed", never matched by a guess.
   **Complete when:** each named person has zero or more browser identifiers, each with its first
   and last time, and any account left out is counted.

5. **S5. Pull the rows, as returned.** Run the queries the questions need (events, visit facts,
   devices, recordings, files loaded, page loads, accounts, sign-ins, releases), over the people's
   identifiers, the hosts and the window only. Save each result in the run directory (F9) exactly as
   the tool returned it. A large result the tool wrote to a file is copied, not printed again; a
   small one is copied, never retyped, because a digit changed by hand is a fault nobody can find
   later. A store that keeps recent rows apart from older ones is read in both places with the
   overlap removed. A log that caps its rows per query is read a day at a time.
   **Complete when:** each input is saved with its query, the time it ran and its row count, and
   nothing outside the request and the controls it named was read.

6. **S6. Name what they saw by the names it had then.** Screens and controls are named as the site
   named them during the window (F6): line up a navigation click with the screen event that follows
   it, or read the labels the window's own events carry. Today's names are a fallback, and the
   report says where one was used. A screen nobody can name keeps its key.
   **Complete when:** every screen and control in the report has a name from the window, or is
   marked as named from today's build, or as unnamed.

7. **S7. Answer each question from its rows.** One section per question the request asked, each
   citing the rows it counts and saying what its source cannot show: a recording does not cover
   every minute, typed text is masked, another site's files hide their sizes, and a sign-in made on
   the server shows the site's servers rather than the visitor's browser.
   - **What they did.** Visits, screens and the time on each, clicks and taps, the order, the gaps.
   - **Whether it loaded for them.** The did-not-load signals, each counted, and the reasons listed.
   - **Live or cached.** Per file, the bytes transferred against its encoded size, and the version
     it was loaded at against the release live at that minute (F7).
   - **Person or agent.** The signals on both sides, labelled uncalibrated, and what none of them
     rules out (H7).
   - **Signed in, or a tab left open.** Sign-ins and renewals against screens and clicks in the
     same minutes.

   A question about what a recorded event or label means in the site's code goes to F13.
   **Complete when:** every question written down in S1 has an answer citing its rows, or "not
   gathered" with the reason.

8. **S8. Write the report.** Lead with the answer to each question, then the summary, both under
   H5, and, only when it was asked for, the detail. Queries run in UTC; the report shows UTC and the zones bound
   as F8, carries the snapshot time (when the rows were read), and says when a person was still
   active at that moment. A report about one person carries that person's visits and nobody
   else's. The coverage closes it: the sources and the range each holds, the window, each control
   and its result, every exclusion counted by kind (other hosts, accounts bound as F5, overlap
   removed), and what was not read. When F11 names a tool, it composes and checks the report; a
   rendered page is opened and looked at, because a page that renders is not a page that reads
   correctly.
   **Complete when:** every number traces to a row, the answers and the summary carry nothing H5
   forbids, and the coverage is stated.

9. **S9. Hand it over, and clean up.** Deliver by the route bound as F10. Publishing follows H9. A
   problem a visitor reported goes to F12 with the report, and a question for another person to
   F15. Delete the raw rows when F9 says, and say that they were deleted.
   **Complete when:** the report reached only those bound as F10; anything published refused a
   signed-out fetch at every address before its link went to anyone, or was taken down with the
   exposure recorded and the person bound as F1 told; and the deletion of the raw rows is recorded.

## Usage Examples

```text
Dana Example says the site would not load for her on Tuesday afternoon. I run the
site and I'm entitled to its records. Find her visits that afternoon and tell me
what failed on her side. Summary only: no addresses or device details.
```

```text
We shipped a release on Monday. Did the three reviewers we invited see it, or were
they still on a copy their browsers kept? Ask me before you query anything.
```

```text
An approval was recorded under Sam Example's account at 02:14 UTC. Was a person at
the controls, or an agent? Weigh the signals on both sides and say what you cannot
rule out.
```

Filling a query contract, with the placeholders the contracts use:

```text
{SOURCE_ID}  the site's source id in the store
{TABLE}      the events table, and the archive table where the store keeps one apart
{HOSTS}      'app.example.com'
{IDENTITIES} 'dana@example.com'
{FROM}/{TO}  '2026-01-06 12:00:00' / '2026-01-06 18:00:00' (UTC)
```

## Pitfalls

- **Counting `click` and calling it every click.** A touch device sends taps and no clicks at all,
  so a phone user's visit disappears. Count both; a rage click arrives on top of the clicks it is
  made of, so it is not added to them.
- **Choosing the site by an environment field.** The same browser may have visited a test site, and
  its events then land in a report about the live one. Choose by the page's own host.
- **One device per person.** A second computer is a second device, and the visit that failed may
  have been on it. Read devices per browser, and compare the graphics chip, cores and memory.
- **Reading a silent day as a quiet one.** A log past its retention returns nothing, exactly like a
  day with nobody on the site. Check a day known to be busy first.
- **Counting the overlap twice.** A store that keeps its recent rows apart from its archive holds
  the same rows in both for a while. Remove the overlap before counting.
- **Reading a sign-in made on the server as automation.** The auth log then shows the site's own
  servers, a server runtime's user agent and a cloud network. That is how sign-in works there, not
  a bot.
- **Describing a mechanism nobody saw.** "The page refreshes its sign-in in the background" is a
  claim about code. Say what the rows show: renewals, with no screens or clicks.
- **Describing a response nobody saw.** "The list came back empty" is a claim about a response.
  Say what the table shows: the account has no rows of that kind.
- **Judging the cache by counting requests.** A cached file is still requested, or is not, for
  reasons a count cannot tell apart. Compare the bytes transferred with the encoded size.
- **Today's names for yesterday's screens.** A screen renamed since the window is reported under a
  name the visitor never saw. Use the names the window's own events carry.
- **Keeping the run directory in a repository.** Its inputs hold full addresses and every account's
  email address, and one `git add .` commits them.
- **Checking only the address you were given.** A host can serve one deployment at several
  addresses, protect the long one and leave a short alias public. Fetch every address signed out.
- **Quoting a URL whole.** A page address or a referrer can carry a sign-in link's token or an email
  address in its query. Cut it to the host and the path.
- **A control that reads more than the request.** A busy day of the sign-in log, or another
  visitor's touch visit, is everyone's records. Name it in the yes and read it as a count.

## Verification

- [ ] The purpose and the yes for this run were recorded before the first query, and the yes named
  the people, the window, the sources and the recipients.
- [ ] Only the people, window and hosts named were read, and the hosts were chosen by the page's
  own host.
- [ ] Nothing a standing limit (F16) rules out was read without a go for this run from the person
  that limit names, recorded with its time.
- [ ] Every source has its held range, every counter in the report found its control, and every
  control was named in the yes and read beyond the named people only as a count.
- [ ] Every number traces to a row; "none in the window" and "no recording stored" are said where
  they apply.
- [ ] The person-or-agent section gives both sides, says the signals are uncalibrated, and says
  what they cannot rule out.
- [ ] The answers and the summary carry no network address, network name, device detail, email
  address, session id or URL query.
- [ ] Nothing was published without a yes, and its link went to nobody before every address it is
  served at refused a signed-out fetch; an address that did not was taken down and recorded.
- [ ] The raw rows stayed in the run directory and their deletion is recorded.

## Deeper reading

- [Evidence signals](references/evidence-signals.md): what each signal can and cannot show, with
  every threshold marked uncalibrated, for person or agent, did-not-load, live or cached, and
  signed in or a tab left open.
- [Query contracts](references/query-contracts.md): each query's filters, the row it returns and its
  control, written with `{SOURCE_ID}`, `{TABLE}` and `example.com` placeholders.
