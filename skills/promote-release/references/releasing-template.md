# The RELEASING.md template

`promote-release` takes every command from the project's own `RELEASING.md` and stops where a
command is missing. Copy the template below to the root of the project's repository as
`RELEASING.md`, fill every `<…>`, and write "none" where a step does not apply, with why. Never
write a key, a token or a password in it: name where it is kept instead.

Who gives each go, and what each step waits for, is not in this file: it is in the team's profile
(the Releases section of the shape `track-in-linear` describes) and the team's Standing rules
page. This file holds the commands, because they change with the code.

````markdown
# Releasing <project>

How a build of `<project>` moves from a developer's machine to production: the commands for each
step, and the way back from each. Who gives each go is in the team's profile, not here.

## Environments

| Step | Branch | Address | Release name | Shares data with |
|---|---|---|---|---|
| Local | the work's own branch | `<http://localhost:…>` | none | `<a local database, or none>` |
| A piece of work's own preview | `<its own branch>` | `<https://<slug>.preview.example.com>` | `X.Y.Z-preview.<slug>.N` | `<…>` |
| The shared preview | `<one branch>` | `<https://preview.example.com>` | `X.Y.Z-preview.N` | `<…>` |
| Staging | `<the staging branch>` | `<https://staging.example.com>` | `X.Y.Z-staging.N` | `<…>` |
| Production | `<the production branch>` | `<https://example.com>` | `X.Y.Z` | `<…>` |

Remove the rows this project does not have. A preview's address says "preview", never "staging".

**The stamp.** The next step's release name is stamped as its own commit, in its own pull request
into the current step's branch (for production: a stamp pull request into staging). The current
branch is then promoted as it is, so the next step's tree is identical to the current step's at
promotion. The trade-off: between the stamp's merge and the promotion, the current environment
briefly carries the next step's name. Each step below has a **Stamp** line for this project's
command, the files it writes, and the branch its pull request goes into.

## Before any step

- **Tests and checks:** `<command>` (what it covers; how long it takes).
- **Browser checks:** `<command, and the step it runs at; or none>`.
- **What else must be up first:** `<database changes, other services, in which order; or none>`.

## Local

- **Stamp:** none; a local build carries no release name.
- **Build:** `<command>`
- **Run it:** `<command>`, then open `<address>`.

## The shared preview

- **Stamp** (`X.Y.Z-preview.N`): `<command, and the files it writes>`.
- **Ship:** a pull request from `<the work's branch>` into `<the shared preview's branch>`; it
  deploys by `<how: on merge, or a command>`.
- **Point the address at the build:** `<command, or "automatic">`
- **Check the address serves the commit shipped:** `<command, and what it prints>`
- **The way back:** `<command that points the address at the build it replaced>`

## Staging

- **Stamp** (`X.Y.Z-staging.N`): `<command>`; its own pull request into `<the shared preview's
  branch>`, before this step's promotion.
- **Ship:** a pull request from `<the shared preview's branch>` into `<the staging branch>`: the
  shared preview's tree as it is, with the stamp in it. It deploys by `<how>`.
- **Point the address at the build:** `<command, or "automatic">`
- **Check the address serves the commit shipped:** `<command>`
- **Browser checks:** `<command, or none>`; their results go in the staging notes.
- **The way back:** `<revert the pull request, or point at the previous deployment: the command>`

## Production

- **Stamp** (the plain `X.Y.Z`): `<command>`; its own pull request into `<the staging branch>`,
  before this step's promotion. Until the promotion, staging carries this stamp.
- **Ship:** a pull request from `<the staging branch>` into `<the production branch>`: staging's
  tree as it is, with the stamp in it. It deploys by `<how>`.
- **Point the address at the build:** `<command, or "automatic">`
- **Check the address serves the commit shipped:** `<command>`
- **Live checks:** `<what to open or run, and what it must show>`
- **Write down the deployment to go back to:** `<command that lists deployments, and which one>`
- **The way back:** `<command that puts the noted deployment back>`

## Where the record goes

- **Release notes:** `<path or place, e.g. releases/<version>.md>`
- **The record of each step** (step, deployment, commit served, UTC time, who shipped it on whose
  word, the way back): `<path or place>`

## Who to ask

- **When a command fails, or a step is not covered here:** `<name>`
````
