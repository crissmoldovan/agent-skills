# A learning library

The shape of a lasting library a project can keep for the people who are learning it. The teaching
skill reads one where it exists (B3). It never creates one on its own: building or changing a
library is a change to the repository, offered only when the learner asks for something lasting,
and made as its own task the way B9 says, or through B11 when the change is to documentation the
repository already keeps.

## Why keep one

Chat answers vanish with the session. A library keeps the explanations that worked, in the words
the team already uses, so the next learner starts from them and every answer builds on the same
vocabulary instead of inventing its own.

## What it holds

One folder, conventionally `docs/learn/`, with an index:

| File | What it is |
| --- | --- |
| `README.md` | The index: what each file is for, and the order to read them in |
| The lessons page | The illustrated course (an HTML page, built as [lesson pages](lesson-pages.md) describes) — lesson zero for every later answer |
| `map.md` | The whole system on one page: every piece, what it does, what talks to what, and which key or pass each uses (names only) |
| One guide per technology | Short answer, the comparison from the learners' field, how it works, *in this project* with real paths, and a closing table of the official pages it was written from |
| `glossary.md` | Every word in one line, each linking to the guide that explains it |
| Saved official pages (optional) | A folder of official documentation saved page by page, with an index per source, fetched by a script and kept out of git |

## Rules that keep it useful

- **Only material that helps someone understand how things work.** No project status, plans,
  progress logs, runbooks, credentials or decisions: those have homes of their own, and a library
  that mixes them stops being read.
- **Every guide names what it was checked against:** the revision or version, and the date.
- **The code wins.** When a guide is found out of date, the learner is told what changed, and the
  guide is corrected in a change of its own (B11).
- **When the stack changes, the library changes with it**, in the same change: a new service, a
  renamed setting, a removed component means the map, the affected guide, the lessons page, the
  glossary and the list of saved sources all move together.
- **Saved official pages are refreshed, not edited.** The script that fetches them is the only
  thing that writes there.
