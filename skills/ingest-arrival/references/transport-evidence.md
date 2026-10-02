# Transport evidence

What each channel leaves behind, how to read it, and what was observed. Step `S2` reads this before
anything is copied or moved, and writes what it reads into `EVIDENCE.txt` beside the copy. Slot ids
(`B1`, `B9`, …) are the skill's own, from its `SKILL.md`.

Each row is tagged:

- **any**: the evidence is the channel's own record, read through whatever tool the project binds as
  B9, on any platform;
- **macOS**: the evidence is something macOS writes on or about a downloaded file. On another
  platform the row is recorded as "not available on <platform>", never left blank.

## Per channel

| channel | record | read it with | where |
|---|---|---|---|
| email | mailbox, message id, thread id, subject, the RFC `Message-ID`; the authentication result **exactly as the tool reports it**: spf, dkim, dmarc, alignment and the dkim domain, a `false` and a `null` included | the mail tool for the ids and the result; the raw message (`.eml`) for `Message-ID`, the `Date:` header and the `Received:` chain, which a tool's own fields may not carry | any |
| a message forwarded inside an email | its From, Date, To and Subject as quoted, marked **unauthenticated**: only the outer message was authenticated | the body | any |
| a chat message's text | workspace, channel, the message's timestamp id and its thread's, the poster's user id, whether it was posted by an app or an outside account, whether it was edited, and any flag the tool raises that the text shown and the text notified differ | the chat tool | any |
| a file fetched by a chat or mail tool | the tool's own manifest: file id, channel or message, timestamp, uploader, size, sha256, and the time it was fetched | the manifest | any |
| a ticket or a comment in a tracker | identifier, comment id, author, the account it was posted on behalf of, created and updated times | the tracker's tool | any |
| a file on a tracker comment | the link the listing gave, the time of that listing, and the download's hash. A tracker can sign such a link to expire within minutes of the listing, so download it at once | the tracker's tool, then a download | any |
| a paste into the session | the session, the transcript line and its timestamp, and the words B1 pasted it with | the skill bound as B14 | any |
| a call | the recorder and the meeting id. For spoken words pasted later: what transcribed them, or "not recorded", asked of B1 | the recorder's own records, read by their metadata | any |
| a file shared from a phone or another computer (AirDrop) | the agent (`sharingd`), the event id and the time. **No sender is recorded** | the quarantine attribute, then the quarantine-events row for that event id | macOS |
| a file saved by a chat app | the agent (the app's name) and the host and file id in the where-from | the quarantine attribute and `kMDItemWhereFroms` | macOS |
| a browser download (a shared document's export, a file-transfer link) | the agent (the browser), the where-from URLs, which can carry the document's id, and the date added | `kMDItemWhereFroms` and `kMDItemDateAdded`, read before any move | macOS |

A file fetched by a tool, and not by an app or a browser, carries no quarantine attribute and no
where-from, so the macOS rows find nothing for it: its evidence is the tool's manifest.

Then, for every channel:

- **The channel before this one**, or "not recorded". A file shared from a phone says nothing about
  how the phone got it.
- **Who did what.** Which session read the mailbox, with which tool; which agent measured which hash;
  and which value one agent passed to another. An agent that was handed a value says so.

## macOS: reading a file's evidence before it moves

Append this to `EVIDENCE.txt` for each file, where the transport put it:

```sh
f='<file>'
{ echo "== $f, read $(date -u +%FT%TZ)"
  TZ=UTC stat -f 'bytes=%z modified=%Sm' -t '%FT%TZ' "$f"
  if q=$(xattr -p com.apple.quarantine "$f" 2>/dev/null); then
    echo "quarantine $q"
    date -u -r "$((16#$(echo "$q" | cut -d';' -f2)))" '+quarantine time %FT%TZ'
  else echo "quarantine none"; fi
  mdls -name kMDItemWhereFroms -name kMDItemDateAdded "$f"
  shasum -a 256 "$f"
} >> EVIDENCE.txt
```

The quarantine attribute reads `flags;hex-time;agent;event-id`. The time is seconds since 1970, in
hex, decoded by the `date` line above. The event id finds its row in the quarantine-events database:

```sh
sqlite3 -readonly ~/Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2 \
  "SELECT datetime(LSQuarantineTimeStamp+978307200,'unixepoch')||'Z', LSQuarantineAgentName,
          LSQuarantineAgentBundleIdentifier, LSQuarantineDataURLString, LSQuarantineOriginURLString,
          quote(LSQuarantineSenderName)
   FROM LSQuarantineEvent WHERE LSQuarantineEventIdentifier='<event id>'" >> EVIDENCE.txt
```

The database counts time from 2001-01-01, hence the `978307200`.

### What was observed

Observed on macOS 26.6, with synthetic files and counts only; nothing private was printed.

- **A copy rewrites the quarantine attribute.** A copy of a quarantined file, by `cp` and by `cp -p`
  alike, carried a quarantine attribute with new flags, the copy's own time and no agent name. Only
  the event id survived. Read the attribute on the file the transport wrote, never on a copy.
- **A move resets the date added.** A file moved into another folder read a new `kMDItemDateAdded`,
  the time of the move. In one real case, two packs filed into a folder minutes after their download
  read the filing time, not the download's.
- **The date added is empty where Spotlight does not index.** In a temporary directory,
  `kMDItemDateAdded` and `kMDItemWhereFroms` read `(null)`. Read them where the transport put the
  file.
- **The quarantine-events rows held the time and the agent, and little else.** A browser's rows also
  held its bundle id. No row, from a browser or from AirDrop, had a sender name, a sender address, a
  data URL or an origin URL. A browser's where-from is on the file (`kMDItemWhereFroms`), so it is
  read there, before the file is copied or moved. An AirDrop recorded no sender in either place.
- **The day's query needs a cast.** Comparing the stored number with `strftime('%s', …)` compares a
  number with text, and silently returns nothing. With the `CAST`, the same window returned every
  event in it.

### The day's events

For the sweep in `S9`. The bounds are UTC: a day in the zone bound as B2 starts and ends at that zone's
midnight, converted to UTC with the command in [record forms](record-forms.md).

```sh
sqlite3 -readonly ~/Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2 \
  "SELECT datetime(LSQuarantineTimeStamp+978307200,'unixepoch')||'Z', LSQuarantineAgentName, LSQuarantineEventIdentifier
   FROM LSQuarantineEvent
   WHERE LSQuarantineTimeStamp+978307200 >= CAST(strftime('%s','<start, UTC>') AS INTEGER)
     AND LSQuarantineTimeStamp+978307200 <  CAST(strftime('%s','<end, UTC>') AS INTEGER) ORDER BY 1"
```

## Email: the moments the raw message holds

- **Sent** is the `Date:` header. A mail tool's own date field can be the server's time of receipt
  rather than the header, and the two are different moments.
- **Received** is the topmost `Received:` header: each server adds its hop above the others, so the
  top one is the last hop, into the mailbox.
- A time quoted inside a forwarded message is the forwarder's quotation, often with no zone. Keep it
  verbatim and mark it "zone not stated".

The command that reads them is in [record forms](record-forms.md).

## Links: what counts as contact

A fetch is contact (hard line `H1`) when the service tells the owner or the uploader about it:

- a request for access to a shared document, which emails its owner;
- a file-transfer service that notifies the uploader of each download;
- any link the service describes as sending a notice when it is opened.

Such a link is recorded as `not fetched: it would notify <whom>`, with who can fetch it, and B1 is
asked. A link that only reads is tried once, read-only, and its exact result recorded.
