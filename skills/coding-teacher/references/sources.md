# Sources

Where each kind of fact in an answer comes from, how to find it, and how to cite it so the learner
can open it too. `SKILL.md` gives the order; this file gives the method.

## The library first (B3)

If the project keeps plain-language material for learners — a `docs/learn/` folder, a glossary, a
lessons page, per-technology guides — start there. It is written in words the learner may already
have met, so build on it, use the same words, and point to it for the basics rather than
re-explaining them differently.

A library is a claim about the code, not the code. Where it disagrees with the repository, **the
code wins** on what the project does: tell the learner, and offer to have the guide corrected
through B11 once the explanation is done. [A learning library](learning-library.md) describes the
shape of one, for a project that has none and asks for one.

## The repository: the truth for *in this project*

Read the file before naming it (H3). The places that usually answer *what does this project use,
and where*:

| Question | Where to look |
| --- | --- |
| Which technologies, at which versions | The manifest and its lock file (`package.json` and its lock, `pyproject.toml`, `go.mod`, `Gemfile.lock`, `Cargo.lock`) |
| What runs where | Deploy and hosting config, container files, CI workflows, infrastructure folders |
| How the pieces are laid out | The top-level folders, a workspace or monorepo config, the README, any architecture document |
| Which outside services it talks to | Client libraries in the manifest, and environment variable **names** in example env files — never their values (H2) |
| The shape of the data | Schema files, migrations, models, generated types |
| The everyday commands | The manifest's scripts, a Makefile or task runner, the contributing guide |

Say what you read: *(from `infra/deploy.yaml`)*. When something cannot be found, say that it was
looked for and where, rather than describing what projects usually have.

## Official documentation (B4)

Every exact fact about a technology — what a setting does, a limit, a default, a definition — comes
from its official documentation, read at the page itself, for the version the project installs.
Your own memory of a technology is older than its documentation and may describe another version.

1. **Find the installed version** in the lock file, not the manifest's range.
2. **Find the page.** The project's own docs site for that technology, its versioned docs where they
   exist, or the documentation shipped inside the installed package. For a word about the web
   itself (*cookie*, *status code*, *CORS*), MDN's glossary is a good plain-language source.
3. **Read the page** before explaining from it. Read past a docs site's component tags and
   placeholders rather than quoting them.
4. **Cite it** at the end of the answer, under **Read more**: the page's title and its address, and
   the saved file too when the project keeps saved copies.

**Saved copies.** Some projects save official pages into the repository or beside it, with an
index per source, so they can be read offline and searched. When B4 names such a copy, use it, and
check its save date: a copy more than about a month old, or any price, plan limit or recently
announced feature, is checked against the live page as well. Saved copies are usually kept out of
git, so they exist only where someone has fetched them; when they are missing, say so and use the
live page.

**When pages disagree.** The official page wins on how the technology works; the code wins on what
this project does; the library loses to both, and the learner is told.

## Live state (B5)

Only for questions about now — *did the last deploy work*, *which migrations have run*, *is the
background worker up* — and only through what B5 names. With B5 unbound, answer from the
repository and say that the live state was not read.

What read-only means here:

- Reading history and status: `git log`, `git status`, a forge's list of pull requests or checks,
  a hosting platform's deployment list and logs, a database's list of tables or applied migrations.
- Never a command that writes, applies, deploys, restarts, invites or retries, even when it would
  fix the thing being explained (H1, H7).
- Never a database query that changes anything, and never a secret or an environment variable's
  value printed, even partly (H2).
- A result that is a number of the moment (*12 runs failed today*) carries the time it was read.

## Citing in an answer

- Keep the general idea and the project apart: *In general, X. In this project, Y (`path`).*
- Name the source of each exact fact as you use it, briefly; collect the official pages at the end
  under **Read more**, one to three of them, each a page you actually read.
- A number that changes carries its source and date, or is checked before it is given.
- When you could not check something, say so and offer to find out (H6).
