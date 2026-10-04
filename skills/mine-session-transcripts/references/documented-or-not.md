# Documented or not: is what a person said written down anywhere?

The question is narrow on purpose: do the words of a message appear in the files that count as the
record (slot B3)? It is the cheap first cut through a long history: it sorts hundreds of messages
into the ones the repository already says and the few that exist only in a transcript, which are the
ones worth a person's time. It does not say whether anyone acted on a message. That is a question
about the code, for the skill bound as B10.

## The method

1. **The messages.** Every message the procedure's S3 counts: typed, queued and slash command
   arguments, with other records left out. A subagent's message with its parent session's words is
   judged too, and its row says so, since it may be the same message relayed.
2. **Normalise both sides with one function.** Lower case, Unicode-normalised, every run of
   characters that are not letters turned into one space. The same function, the same code path, for
   the messages, the corpus and the controls.
3. **Cut each message into runs.** Consecutive, non-overlapping eight-word slices of the normalised
   text, at most 60 per message. A message of fewer than eight words has no run and is reported as
   too short to judge, never as written down or not.
4. **Look for each run in the corpus.** Every window of eight consecutive words in every corpus
   file, normalised the same way. A window never spans two files.
5. **Score each message** by the share of its runs found, and put it in a bucket:

   | bucket | share of runs found |
   |---|---|
   | mostly written down | 60% or more |
   | partly | 20% to 59% |
   | not written down | under 20% |
   | too short to judge | no run at all |

## Symmetry is the whole trick

A message normalised one way and a corpus normalised another finds nothing, and reports nothing as
written down. That happened: messages with their punctuation stripped were compared with files that
still had their commas, and the count came back 0 of 11 documented when most of the 11 were. Nothing
looked wrong, because "not written down" is exactly the answer the check exists to give.

So any change to the normalisation is made in one function that both sides call, and the controls
below are run every time, not once.

## Controls, before any count

- **A positive control.** At least one sentence of eight or more words, copied from a file the
  corpus holds, punctuation and capitals as they are in the file. It goes through the same function
  as the messages. If any of its runs is not found, the matcher is broken on this corpus, and no
  count is shown.
- **A negative control.** The script generates a run of eight nonsense words each time. If it is
  found, the matcher finds anything, and no count is shown.

A control that fails is reported as such, with the words "the matcher cannot be trusted on this
corpus", and the run exits 3. A number from a matcher whose controls failed is never reported, even
with a caveat.

## The corpus

By default (B3) it is every file git tracks in the repository, read as text, under 8 MB. Left out,
and counted by reason in the output (B4):

- binary files (a NUL byte in the first 8 KB);
- files over the size cap: a generated bundle or an archive repeats everything and costs time;
- any file under the history directory, if the corpus contains it;
- paths given with `--exclude`.

Leave out, too, any file that is itself a copy of transcript text, such as an export of messages
kept in the repository. Every message would then be "written down" in it, and the check would
measure nothing. Bind such files in B4, with the reason.

## Relays

A typed message proves who pasted it and when, not who wrote the words. A message that relays
someone else ("Dana said the launch moves", a forwarded block) is marked when a name bound in B7,
passed as `--relay-name <name>` once per name, stands within a few characters of a verb of speaking
(said, wrote, asked, sent, replied, from, message and the like), in either order, or appears inside
a fenced block. Both orders matter: a pattern that matched only "message from Dana" missed a third
of the relays it was meant to find. With no names bound, relays are not checked, and the output
says so.

## What a match proves, and what it does not

- **Mostly written down** means the words are in some file of the corpus. It does not say which
  file is the authority, whether the file was written before or after the message, or whether the
  request was carried out.
- **Not written down** means not found in this corpus, with this normalisation. A paraphrase is not
  found: a decision recorded in other words scores low. Read the message (S5) before calling it lost.
- **Too short to judge** is its own bucket. "go", "status?" and "yes, do that" carry meaning only
  with what came before them, and their share would be noise.

## The register

The output gives the count in each bucket and lists the messages not written down, each by its
file, line, time, kind, length and share. `--all` lists every message instead, and `--json` prints
the register below.

`--out <file>` writes the result as JSON: the method, the corpus counts, the controls, the buckets,
and one row per message with its file, line, time, session, kind, length, runs, runs found, share and
relay mark. Message text never reaches a file from this command.

No message text does not make the register safe to publish. It names this machine: its `coverage`
lines hold the history directory (under the home directory, so the user name) and the repository's
absolute path; each row's `file` begins with a directory name that encodes the absolute path a
session ran in; and each row carries the session's id. Write it only where B5 says, and commit it
only to a repository whose readers may see those. Before it goes anywhere shared, replace the paths
with placeholders and drop the session ids, or keep it on the machine.
