# Evidence signals

What the rows of a visit can show, what they cannot, and how each signal is weighed. Read it in
S7 of the skill, one question at a time.

**UNCALIBRATED.** Every threshold in this file was set by judgement over a handful of real visits.
None has been measured against visits whose answer was known (a person, an agent, a page that did
not load), so none has a known rate of false alarms or of misses. They put the evidence in order;
they do not classify a visit. A signal that leans either way sends the reader to the rows and the
recording, never to a conclusion, and the report says the thresholds are uncalibrated wherever it
uses them. A project that calibrates them records how, and against which visits, in its own
overlay, and keeps this label until it has.

Two parts are not judgement and are marked so: how a browser reports a file's sizes (from the W3C
Resource Timing specification), and what a sign-in log row records (from the rows themselves).

## Person or agent

The weighing of one visit, from its clicks and taps, its recording, and its browser:

| signal | leans towards | threshold (uncalibrated) | what it does not prove |
|---|---|---|---|
| the browser reports itself as automated (`navigator.webdriver`, or the store's own automation flag) | an agent | set at all | a careful agent clears it, and a person's browser running an automation extension can set it |
| many clicks very close together | an agent | at least 10 clicks, and more than 10% of the gaps under 250 ms | a double click and an impatient person make short gaps too |
| a steady beat | an agent | at least 20 clicks, and the gaps' coefficient of variation (their standard deviation over their mean) under 0.5 | a person clicking through a list they know can keep a steady beat |
| the same pixel again and again | an agent | at least 20 clicks, and distinct positions under 80% of clicks | a person pressing one "next" button in one place does it too |
| no pointer movement between clicks, in a recording that covers them | an agent | none recorded | a keyboard-only visitor, and a recording that dropped its pointer events, move nothing |
| a software graphics renderer, or almost no installed fonts | an agent in a headless browser | the renderer names a software rasteriser | a locked-down or virtual desktop looks the same |
| a data-centre network | an agent | the registry names a hosting or cloud provider (H4: `whois` on the masked block; keep the owner and "hosting provider: yes or no", never the location it also returns) | a person on a company VPN or a remote desktop exits from one; and a masked block can span several registrants, so the owner named may not be the visitor's network |
| the pointer moved between clicks | a person | any pointer positions recorded between clicks | an agent that drives the real pointer moves it too |
| keys were pressed | a person | any key press counted (what had focus is read; the keys and what they typed never are) | an agent that types does this too |
| the window's focus changed | a person | any blur or focus recorded | an agent switching tabs does this too |
| text was selected | a person | any selection recorded | |
| right clicks, double clicks, rage clicks | a person | any | |
| an irregular beat | a person | the gaps' coefficient of variation at least 0.8 | an agent that waits on slow pages has an irregular beat too |
| every click on its own spot | a person | at least 5 clicks, and distinct positions at least 95% of clicks | |
| a hardware graphics chip and many installed fonts | a person's own machine | the renderer names a hardware chip | it says which machine, not who was at it |

**The weighing**, in this order:

1. No clicks or taps: *too little activity to judge*.
2. Any signal that leans towards an agent: *leans towards an agent, on these signals; who was at the
   controls is not established*, naming each signal that fired on either side, and sending the
   reader to the recording.
3. Otherwise, any signal that leans towards a person: *leans towards a person, on these signals; who
   was at the controls is not established*, naming each signal that fired on either side, with
   *(no recording stored)* when there is none.
4. No signal on either side, as with a few clicks and no recording: *too little to judge, on these
   signals*. An absence of signals is never read as a person.

Neither leaning is a finding about anyone (H7): the thresholds behind both are uncalibrated, and a
leaning towards a person is no more evidence that the named person acted than a leaning towards an
agent is that they did not.

**What none of them rules out**, said in every report that weighs a visit. A leaning either way
says how the controls were driven, never who drove them:

- someone else at the person's computer, or using their account;
- an agent that drives the real pointer and keyboard of the person's own machine, which moves the
  pointer, presses keys and changes focus as a person does;
- a person who drove an automation tool on their own behalf.

## Whether it loaded for them

A visit is marked as one that did not load when any of these holds, each counted from rows and
listed as a reason:

| signal | threshold (uncalibrated) | read from |
|---|---|---|
| one of the site's own files was refused, missing or failed | any status 401, 403, 404 or 5xx, or a failed load, on a file the site's pages link, on a host bound as F4 | the files loaded (the "files loaded" contract) |
| the page reported an error | any error event the site sends | the events |
| reloads | 3 or more in one visit | the events: the same screen loaded again with no navigation between |
| sign-ins | 3 or more in one visit | the sign-in log and the events |
| the site's own retry control was pressed | any press | the events: the control the site shows when a page cannot load |

A 404 on a file the site's pages link is the usual way a kept copy of a page fails: it asks for a
versioned file, such as a bundle with a hash in its name, that a newer release has removed.

Not a signal:

- a request the browser makes for a file the site never linked, such as an icon at the root of the
  host: its 404 is the browser's guess, not a missing file of the site's;
- another site's file that failed, which the site does not serve and the report names separately;
- why a browser did not keep a session: that is outside what the site's records can see, and the
  report says so rather than guessing.

## Live or cached

**DOCUMENTED** (W3C Resource Timing): for each file a page loaded, the browser reports the bytes it
transferred, the file's encoded size and its decoded size. Compare the first two:

| transferred | meaning |
|---|---|
| more than the encoded size (the body and its headers) | downloaded from the site |
| more than zero, but below the encoded size (the headers alone) | the site confirmed that the browser's copy was current (a 304) |
| zero, with a body size | the browser used its own copy, or a service worker answered, and the site was never asked |
| zero, and no body size | another site's file whose server does not allow its timing to be read: the sizes are hidden, and the answer is unknown |

A file no larger than a response's headers (often a few hundred bytes, more where a site sends
long security headers or cookies) cannot be judged by its sizes: a 304's headers alone can match
or pass its encoded size, and then it reads as downloaded. Report such a file as unknown, unless
its row's status is 304.

That answers *downloaded or kept*. *Which release* is a second check:

- A file whose URL carries a version tag (often a prefix of a hash of its content) was loaded at
  that version. Compare the tag with the tags the release live at that minute would carry,
  recomputed from that release's own files where the tag is a content hash (the "releases"
  contract).
- A merge or deploy time is a release time give or take the deploy. Say so, rather than implying
  the exact second.
- Without the release history (F7), the report says the comparison was not made.

Counting requests answers neither question: a cached file is requested again, or is not, for
reasons a count cannot tell apart.

## Signed in, or a tab left open

**From the rows**, never from a mechanism nobody verified:

- A sign-in log row that grants a new session from a password, a link or a provider is a sign-in.
- A row that renews a session (a refresh-token grant) with no screens or clicks in the same minutes
  is a tab left open, not a visit.
- Where sign-in runs on the site's own servers, the auth store records the servers' user agent and
  addresses, never the visitor's browser. It is not a sign of automation, and the report says where
  sign-in runs.
- A log past its retention returns nothing for a day, exactly as a quiet day does. A day known to
  be busy is read first, as the control.

## Devices

- A device is read per browser identifier, never per person. A person's second machine is a second
  device, and the visit that failed may have been on it: compare the graphics chip, the cores and
  the memory between their browsers.
- A browser may send its fingerprint only on its first visit in the window. A person whose browser
  sent none has *device unknown*, never a device filled in from another browser.
- A device's details are personal data. They go in the detail, never in the summary (H5).

## What a source cannot show

Said in the report wherever it applies, so a reader does not take a gap for an answer:

- A recording does not cover every minute of a visit. Say which minutes each recording covers.
- What a person typed is not read (H2), whether or not the source recorded it: S3 says which
  sources record it, and the queries leave it out.
- Another site's files hide their sizes.
- The auth store sees the site's servers, not the visitor's browser, wherever sign-in runs on the
  server.
- A source keeps rows for a limited time, and the window may be older than its oldest row.
