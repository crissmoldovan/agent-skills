#!/usr/bin/env bash
# release-notes-gate — the mechanical half of the `release-notes` skill.
#
# A Claude Code `PreToolUse` hook on `Bash`. It refuses a RELEASE action when the version
# being released is not mentioned anywhere in the project's release notes. It enforces
# PRESENCE of a note; the skill enforces its CONTENT (what / why / impact).
#
# Gated actions: `npm|pnpm|yarn publish`, `changeset publish`, `gh|glab release create <tag>`,
# `git tag <pkg>@<ver>` / `git tag v<ver>`, and version-bump `git commit`s.
#
# OFF UNLESS ARMED. Like `report-progress-gate.mjs`, this file decides nothing — it does not
# even read its stdin — unless `AGENT_SKILLS_RELEASE_NOTES_GATE` is `block` or `observe` in
# its environment. An unarmed copy — wired by hand, copied out of a blog post, inherited from
# someone else's settings — exits 0 having done nothing. `install-release-notes-gate.mjs` is
# what arms it, by putting that assignment in the command it writes; that is the user's act,
# and `--remove` is how they take it back.
#
# FAIL-OPEN BY DESIGN. It refuses only when it can positively identify a release action AND a
# release-note file that never mentions the target version. Anything it cannot resolve
# confidently is ALLOWED. That bias is not politeness: a guard that blocks a release whose
# note WAS written teaches people to work around it, and a worked-around guard enforces
# nothing at all. The reverse mistake — a release slipping through — costs one thin note.
#
# IT CHECKS PRESENCE, NOT CONTENT. It can see that the string `1.4.0` appears in a file that
# records releases. It cannot see whether the paragraph under it says why the release happened
# or what it breaks. A heading with a git-message body satisfies this gate and fails the skill.
# Nothing this file prints may imply otherwise.
#
# PROTOCOL. Reads the `PreToolUse` payload on stdin and, in `block` mode, writes a permission
# decision as JSON on stdout. That decision shape — `hookSpecificOutput.permissionDecision`
# with `deny` and a `permissionDecisionReason` — is DOCUMENTED in
# `../HOOK-OUTPUT-NOTES.md` (the schema dump it captured), NOT OBSERVED: that file's probe was
# scoped to content delivery and explicitly did not exercise the decision channel. In
# `observe` mode the gate prints nothing to stdout and writes what it would have refused to
# stderr; whether Claude Code surfaces a `PreToolUse` hook's stderr at exit 0 is likewise NOT
# OBSERVED. Read a run of observe mode from the hook's own output before trusting either.
#
# Every path exits 0. A gate's own failure is never the session's.
set -uo pipefail

# ONE UNIT FOR THE WHOLE FILE: bytes.
#
# `run_dir_for` takes an offset from `grep -Eob`, which counts BYTES, and applies it with
# `${seg:0:$off}`, which bash counts in CHARACTERS whenever LC_CTYPE is multibyte. The two
# agree on ASCII and diverge on anything else, so the cut that stops the scan at the release
# verb landed PAST the verb once enough non-ASCII sat in front of it — measured at 18 CJK
# characters, 12 emoji or 14 em dashes — and the `cd` that runs AFTER the release came back
# into view. The fix for that silently reverted, and reverted only under a UTF-8 locale,
# which is the locale most interactive shells actually run: it worked for whoever tested it.
#
# Pinning the locale removes the CLASS rather than that instance. Every pattern in this file
# is ASCII, nothing here collates or case-folds anything but ASCII, and `grep`/`sed`/`awk`
# read the command as the byte string it is — so making bash measure in bytes too costs
# nothing and leaves no second unit to get wrong. It is also one fewer process than guarding
# the arithmetic at the one call site that has it today.
export LC_ALL=C

# --- arming ----------------------------------------------------------------
# `block` (or `1`) refuses; `observe` reports and refuses nothing. Anything else — unset,
# blank, `0`, `true`, `off` — is off, which is what an unarmed copy of this file always is.
MODE="$(printf '%s' "${AGENT_SKILLS_RELEASE_NOTES_GATE:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
case "$MODE" in
  block|1) MODE="block" ;;
  observe) MODE="observe" ;;
  *)       exit 0 ;;
esac

input="$(cat 2>/dev/null || true)"
command -v jq >/dev/null 2>&1 || exit 0   # no jq -> cannot parse -> allow
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Collapse continuations, and keep every other newline as the SEPARATOR it is.
#
# `tr '\n' ' '` was the bug that made this gate inert for the commonest shape a release
# command actually takes. A tool call carrying
#     npm run build
#     npm publish
# became `npm run build npm publish`, which puts `npm publish` in the middle of a line
# instead of at the start of a command — so every detector below, each of which anchors to
# start-of-line or a shell separator, missed it and the release was waved through. Newlines
# become `;` for the same reason bash treats them that way. A trailing `\` still joins.
norm="$(printf '%s' "$cmd" | tr '\t' ' ' \
        | awk '{ if (sub(/\\[[:space:]]*$/, "")) printf "%s ", $0; else printf "%s;", $0 }')"

# QUOTED TEXT IS DATA. This pass is the difference between reading shell STRUCTURE and
# reading CHARACTERS, and reading characters is what made this gate refuse ordinary work:
#     git commit -m "fixes the crash; npm publish now works"
#     git commit -m "see README (npm publish)"
#     gh issue comment -b "workaround: (pnpm publish)"
# Every one of those was DENIED, because the `;`, `(` or `|` inside the message satisfied
# START's character class and put the next word at what the gate read as a command
# position. A commit message that mentions a publish step is completely ordinary, so this
# fired on real work — and a false denial is the one outcome the header says this guard
# cannot afford. (`echo "build; npm publish"` escaped only because the CLOSING quote is not
# in END's class: the old behaviour was incidental, not designed.) The same reading is why a
# `cd` named inside a commit message could hijack the run directory, and why an unresolvable
# one switched the bump check off for that commit.
#
# So inside a quoted span, a shell metacharacter becomes a space: it is text, and text opens
# no command position. The quote CHARACTERS are then dropped, which is deliberate and is the
# line between this and the cheap repair. Blanking quoted spans wholesale would pass every
# case above and lose the releases that are merely quoted — bash runs `npm "publish"` exactly
# as it runs `npm publish`, and `git tag "v1.4.0"` is an ordinary way to write a tag. Quoting
# removes a character's power to act as structure; it does not turn a command into a comment.
# (`packages/agent-journal`'s consequence matcher learned the same thing from the other
# direction: stripping quoted spans there made `wrangler secret "put" API_KEY` invisible.)
#
# WHAT THIS GIVES UP, stated rather than discovered, and stated in FULL — the first version
# of this paragraph named one shape and there are four. A release that reaches the shell as a
# quoted ARGUMENT is under-blocked, because after this pass the verb sits mid-command rather
# than at a command position:
#
#   1. handed to another shell:  sh -c "build; npm publish"   bash -lc "..."   ssh host "..."
#   2. a command substitution inside double quotes: echo "$(npm publish)",
#      OUT="$(npm publish --tag next)", printf "%s" "$(git tag v1.4.0)"
#   3. backticks: echo `npm publish`
#   4. an UNBALANCED quote: echo it's fine; npm publish — an odd apostrophe opens a span that
#      never closes, so every detector is disarmed for the rest of that command.
#
# 2 and 3 are the ones worth saying out loud, because they are the shapes where bash really
# does run the publish: inside `"..."` a `$( )` re-enters command context. This pass does not
# follow it back in, and a gate that claimed only `sh -c` was lost would be understating what
# it costs. Measured against the shipped gate, most of 1 was under-blocked there too (the verb
# ends at the closing quote, which END does not accept); the shape genuinely lost is a
# separator AND text on both sides of the verb inside the string, as in
# `sh -c "build; npm publish --tag next"`, which the shipped gate refused — for the SAME
# reading that refused the commit messages, so one cannot be kept without the other, and the
# header decides which way that goes: a false denial costs more than a miss. All four join the
# under-block list the adapter README publishes (`sudo npm publish`, `time npm publish`,
# `NPM_CONFIG_TAG=next npm publish`, `git tag -f`, `gh release create --draft`).
#
# THE HEREDOC TRADE NOW RUNS BOTH WAYS, and both halves belong in the same paragraph. A
# heredoc BODY line still reads as a command, because the normalisation above turns its
# newlines into separators — that one OVER-blocks, and the header tolerates it less happily.
# What this pass added is the opposite failure on the same construct: a heredoc body carrying
# an odd number of apostrophes (`it's`, `don't` — ordinary prose) is case 4 above, so every
# detector goes quiet for the rest of that command. The two are not alternatives; which one a
# given heredoc gets depends on its punctuation, and neither is narrowed here.
#
# THE COST OF THIS PASS IS LINEAR IN THE COMMAND, and it has to be: this hook runs before
# EVERY Bash tool call. The first version walked the command one character at a time
# rebuilding `out = out c`, which under one-true-awk copies the whole accumulator per
# character — quadratic, measured at 128KB as 971ms for the pass and 1025ms through the gate,
# against 58ms for the gate that had no such pass at all. So the state machine runs over RUNS
# rather than characters: the only bytes that can change state are `'`, `"` and `\`, so those
# three are marked and split out, each run between them is emitted whole, and a run inside a
# quoted span has its metacharacters blanked by one `gsub` instead of one test per byte.
# Output goes straight to `printf` rather than into an accumulator, so nothing is recopied.
# Measured on the same inputs, the pass alone: 128KB of inert text 9ms, 128KB of
# metacharacters 9ms, 256KB 16ms, and 128KB made of seven thousand quoted spans 58ms — and
# byte-identical output to the character loop on all 4054 inputs of a fuzz corpus over
# exactly the alphabet that can change parsing state. Through the whole gate, against the
# 0.16.0 build that had no such pass: 128KB 70ms against 59ms, 2000 lines 71ms against 61ms,
# and the pathological quoted-span case 121ms against 63ms — the one shape still materially
# dearer than 0.16.0, stated rather than rounded away.
#
# The marker byte is 0x01, and an input already carrying one has it replaced by `_` first.
# Replaced, not deleted, and not replaced by a space: deleting it could JOIN two words into a
# verb (`np<0x01>m publish`), and a space could SPLIT one word into two. `_` can do neither.
norm="$(printf '%s' "$norm" | awk '
function safe(c) { return (c == ";" || c == "&" || c == "|" || c == "(" || c == ")") ? " " : c }
BEGIN { sq = sprintf("%c", 39); dq = sprintf("%c", 34); bs = sprintf("%c", 92)
        mk = sprintf("%c", 1); state = sq dq bs }
{
  gsub(mk, "_")                                        # the marker is ours; a stray one is not
  gsub(sq, mk "&" mk); gsub(dq, mk "&" mk); gsub(/\\/, mk "&" mk)
  n = split($0, f, mk); q = ""; esc = ""
  for (j = 1; j <= n; j++) {
    t = f[j]
    if (t == "") continue
    one = (length(t) == 1 && index(state, t) > 0)       # a marked quote or backslash
    if (esc != "") {                                    # a backslash is pending
      c = substr(t, 1, 1)
      if (esc == "u" || c == dq || c == bs || c == "$" || c == "`") {
        printf "%s", safe(c); esc = ""; t = substr(t, 2)   # it escapes: the char is TEXT
        if (t == "") continue
        one = 0
      } else { printf "%s", bs; esc = "" }               # bash: nothing else is escapable in "..."
    }
    if (one) {
      if (t == bs) { if (q == sq) printf "%s", bs; else esc = (q == "" ? "u" : "d"); continue }
      if (q == "") { q = t; continue }                   # open a span
      if (t == q) { q = ""; continue }                   # close it
      printf "%s", t; continue                           # the other quote, inside this one
    }
    if (q != "") gsub(/[;&|()]/, " ", t)                 # quoted: structure becomes text
    printf "%s", t
  }
  if (esc == "d") printf "%s", bs                        # a trailing backslash inside "..."
}')"

# VERB POSITION. A gated verb counts when it starts the command or follows a shell separator.
# `^` alone missed an indented line (`  npm publish` inside a script block), which the
# newline-to-`;` normalisation above now produces for every indented multi-line call.
START='(^|[;&|(])[[:space:]]*'
# ...and it ends at whitespace, at a separator, or at the end. `([[:space:]]|$)` alone missed
# `npm publish; git push` and `(npm publish)` — and, after the fix above, would have missed
# EVERY multi-line command, since each line now ends in `;`.
END='([[:space:]]|[;&|)]|$)'

refuse() {
  # $1 = reason. In observe mode this is the whole effect: say it on stderr, refuse nothing.
  if [ "$MODE" = "observe" ]; then
    printf 'release-notes gate (observe): would have refused this release. %s\n' "$1" >&2
    exit 0
  fi
  jq -cn --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

BLURB="Come back to the release-notes skill and write the note: What (the surface), Why (the rationale a commit omits), and Impact (breaking-or-additive, migration, blast radius, dist-tag). The gate enforces presence; the skill enforces content."

# BASE — the directory the tool call will START in: the session's cwd, which the PreToolUse
# payload states and which is also this hook's own cwd. Every relative path in the command (a
# `cd` target, a `-C`, a package dir) is resolved against it explicitly, never left to whatever
# directory `git` happens to inherit from this process — see run_dir_for.
BASE="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
if [ -z "$BASE" ] || [ ! -d "$BASE" ]; then BASE="$PWD"; else BASE="$(cd "$BASE" 2>/dev/null && pwd -P)"; fi

# --- where a project records releases ---------------------------------------
#
# THE ASSUMPTION THAT MADE THIS GATE A LIE IN MOST REPOSITORIES: that every project keeps a
# `CHANGELOG.md`. It was written against one that does. A project that records releases in
# `docs/releases.md`, in dated files under `docs/releases/`, or in pending `.changeset/`
# entries has no `CHANGELOG.md` at all — so the file lookup missed, the check reported
# "unknown", and the gate allowed every release while reporting itself installed and working.
# A gate that is inert everywhere except the repository it was written in is worse than no
# gate: it is a guard somebody is counting on.
#
# So: a whole SET of candidates, and the three-way answer below. `docs/releases.md` is listed
# because this pack itself uses one.
NOTE_FILES="CHANGELOG.md CHANGELOG.markdown CHANGELOG.txt CHANGELOG CHANGES.md HISTORY.md NEWS.md RELEASES.md docs/CHANGELOG.md docs/changelog.md docs/releases.md docs/RELEASES.md"
# Directories of per-release files: one note per version, or per wave.
NOTE_DIRS="docs/releases docs/release-notes changelog.d"

# --- helpers ---------------------------------------------------------------

# notes_status <dir> <version> -> 0 mentioned / 1 missing / 2 unknown (no note source at all)
#
# THREE answers, not two, and the third is why this is survivable. A project with no note
# source anywhere is a project that does not keep release notes in the tree; that is not a
# violation, it is a different convention, and callers ALLOW it.
#
# "Mentioned" is deliberately weaker than "has a `## <version>` heading". The old heading
# match rejected `## [1.2.3] - 2026-01-01`, the most widespread convention there is, and
# blocked releases whose notes were in fact written. Every heading dialect a changelog
# generator emits — bracketed, `v`-prefixed, `@scope/pkg@1.2.3`, setext, a bullet list — is
# a spelling this gate must not have to know. The version string appearing in a file whose
# job is recording releases is the floor, and the floor is all a hook can honestly enforce.
notes_status() {
  local dir="$1" ver="$2" esc found=1 f d
  esc="${ver//./\\.}"
  # A whole token: `1.2.3` must not be satisfied by `1.2.30` or by `1.2.3-rc.1`.
  local pattern="(^|[^0-9A-Za-z.-])v?${esc}([^0-9A-Za-z.-]|\$)"

  for f in $NOTE_FILES; do
    [ -f "$dir/$f" ] || continue
    found=0
    grep -Eq "$pattern" "$dir/$f" 2>/dev/null && return 0
  done

  for d in $NOTE_DIRS; do
    [ -d "$dir/$d" ] || continue
    found=0
    grep -REq "$pattern" "$dir/$d" 2>/dev/null && return 0
  done

  # Changesets: a PENDING changeset carries a bump type, never a version — the version does
  # not exist until `changeset version` runs. So the note for this release is the staged file
  # itself, and its presence is the only thing that can be checked here.
  if [ -d "$dir/.changeset" ]; then
    found=0
    if find "$dir/.changeset" -maxdepth 1 -name '*.md' ! -name 'README.md' -print 2>/dev/null | grep -q .; then
      return 0
    fi
  fi

  [ "$found" = 0 ] || return 2
  return 1
}

# note_staged <prefix> -> 0 when the staged paths on stdin include a note source for the
# package at <prefix> ("" for the repository root, "packages/cli/" for one inside it).
#
# This is the same-commit escape hatch: the note that is being written RIGHT NOW, in the very
# commit that bumps the version, is the correct answer to "where is the note", and a gate that
# cannot see it refuses the one commit that does the right thing. It was doubly broken before:
# it built "./CHANGELOG.md" for a root package and never matched the "CHANGELOG.md" git
# actually prints, and it only ever looked for that one filename — so a project recording its
# release in `docs/releases.md` was refused a commit that staged exactly the right note.
# Matching is exact per path segment, so a bump at the root is not excused by a changelog
# staged inside some unrelated package.
note_staged() {
  local prefix="$1" p rel f d
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    case "$p" in "$prefix"*) ;; *) continue ;; esac
    rel="${p#"$prefix"}"
    for f in $NOTE_FILES; do [ "$rel" = "$f" ] && return 0; done
    for d in $NOTE_DIRS; do case "$rel" in "$d"/*) return 0 ;; esac; done
    case "$rel" in .changeset/*) return 0 ;; esac
  done
  return 1
}

# notes_label <dir> -> the note source to NAME in a refusal, so the message points at a file
# the reader can open. Never guesses a file that is not there.
notes_label() {
  local dir="$1" f d
  for f in $NOTE_FILES; do [ -f "$dir/$f" ] && { printf '%s' "$dir/$f"; return 0; }; done
  for d in $NOTE_DIRS; do [ -d "$dir/$d" ] && { printf '%s' "$dir/$d"; return 0; }; done
  [ -d "$dir/.changeset" ] && { printf '%s' "$dir/.changeset"; return 0; }
  printf '%s' "$dir"
}

# resolve_dir <dir> [base] -> prints an existing directory as an absolute path, or FAILS.
#
# It fails rather than guessing when the path does not exist: a directory this hook cannot
# resolve is exactly the "cannot resolve confidently" case the header promises to ALLOW, and
# silently falling back to `.` is what made the gate judge one project by another's notes.
resolve_dir() {
  local d="$1" b="${2:-$BASE}"
  [ -z "$d" ] && return 1
  # The tilde here is DATA, not a path this script wrote: it arrives unexpanded inside the
  # command text (`cd ~/work/foo && …`), so these patterns match a literal `~` on purpose.
  # shellcheck disable=SC2088
  case "$d" in
    '~')   d="$HOME" ;;
    '~/'*) d="$HOME/${d#\~/}" ;;
    /*)    ;;
    *)     d="$b/$d" ;;
  esac
  [ -d "$d" ] || return 1
  ( cd "$d" 2>/dev/null && pwd -P ) || return 1
}

# run_dir_for <normalized-cmd> [verb-pattern] -> prints the directory the command actually
# runs in (BASE when it has no `cd`), or FAILS when a `cd` target cannot be resolved.
#
# `cd <dir> && <release action>` is the normal way to act on another package or another
# checkout, and this hook does NOT run in that directory — it runs in the session's cwd. Reading
# the session's index and package.json for a command that will execute elsewhere is how
# `cd <repoA> && git commit -m unrelated` came to be DENIED by an unnoted version bump staged in
# the session's own repoC — a commit with nothing to do with any release — and how
# `cd packages/cli && npm publish` was judged against the ROOT package and the ROOT notes,
# naming the wrong package and the wrong file in the refusal.
#
# The LAST top-level `cd` BEFORE THE VERB wins, because that is the one in effect when the
# verb runs — and the second half of that sentence is what the code used to leave out. Taking
# the last `cd` on the whole line read a `cd` that runs AFTERWARDS as the release's directory:
# `npm publish && cd <other-repo>` — publish here, then go somewhere else — was judged against
# <other-repo>'s notes and REFUSED, naming a repository that has nothing to do with the
# release, from a repository whose note was in fact written. So callers pass the pattern of
# the verb they matched, and everything from that verb onwards is cut away before the scan.
# `grep -Eob` gives the byte offset of the LAST match, which is the same "last invocation
# wins" rule the tag and publish extractors already use; a verb at offset 0 leaves nothing to
# scan, which is correct — nothing ran before it.
#
# A `cd` that only applies inside a subshell — `(cd a && build) && npm publish` — is still
# over-attributed here; it stays harmless because callers fail open whenever the resulting
# directory has no package.json or no note source, and for git commits both directories
# usually share one repo root.
run_dir_for() {
  local t seg="$1" off
  if [ -n "${2:-}" ]; then
    off="$(printf '%s' "$seg" | grep -Eob "$2" 2>/dev/null | tail -1 | cut -d: -f1)"
    # A grep without `-b` prints nothing here, and anything that is not a plain offset is not
    # one: either way the scan falls back to the whole line rather than erroring. Fail open.
    case "$off" in ''|*[!0-9]*) off="" ;; esac
    [ -n "$off" ] && seg="${seg:0:$off}"
  fi
  t="$(printf '%s' "$seg" \
        | grep -Eo "${START}cd[[:space:]]+[^;&|)]+" \
        | tail -1 | sed -E 's/.*cd[[:space:]]+//; s/[[:space:]]+$//' | tr -d "\"'")"
  [ -z "$t" ] && { printf '%s' "$BASE"; return 0; }
  resolve_dir "$t" || return 1
}

# repo_dir_for <cmd-fragment> -> prints an explicitly named target directory, or nothing.
#
# A release command can name a repository other than the shell's cwd: `git -C <dir> tag …`, or
# `gh release create … --repo <owner>/<name>`. Defaulting those to `.` checks the WRONG project's
# notes and refuses a release whose note is in fact written — the same false positive the
# heading-dialect bug caused, and the one outcome the header says this guard cannot afford.
# `git -C` names a real path, so honour it.
#
# Callers pass a FRAGMENT holding a single invocation, not the whole line: see branches 2 and 3
# on why `head -1` over a compound command pairs one invocation's flag with another's version.
repo_dir_for() {
  printf '%s' "$1" | grep -Eo -- '-C +[^ ]+' | head -1 | awk '{print $2}'
}

# GIT_OPTS — git's global options, which sit BETWEEN `git` and the subcommand.
#
# `git -C <dir> tag v1.2.3` contains no `git tag` substring, so the plain `git +tag +` matcher below
# missed it entirely and the branch never ran: a cross-repo release with NO note was waved
# straight through, and that is how one release got tagged with no note at all. Both the
# detector and the tag extractor must step over these options, or the guard is silently inert
# for every tag cut against another checkout. The same applies to `git -C <dir> commit` in
# branch 4, which otherwise reads the SHELL's index for a commit that lands in a different
# repository.
GIT_OPTS='( +(-C +[^ ]+|-c +[^ ]+|--git-dir[= ][^ ]+|--work-tree[= ][^ ]+|--no-pager|-P))*'

# PKG_OPTS — the options a package manager accepts BETWEEN the binary and the subcommand.
#
# The previous matcher allowed only glued options (`--silent`, `--filter=x`), so it could not step
# over an option whose VALUE is a separate argument: `pnpm -C packages/broken publish` and
# `pnpm --filter @acme/broken publish` both failed to match, the branch never ran, and a publish
# with no note was waved through — while the post-verb forms (`pnpm publish --filter …`) denied
# correctly, so the gate looked like it worked. The value-taking options are listed FIRST so the
# alternation consumes `-C <dir>` as a pair instead of stopping at the flag and choking on its value.
PKG_OPTS='( +(-C +[^ ]+|--dir +[^ ]+|--cwd +[^ ]+|--prefix +[^ ]+|--filter +[^ ]+|-F +[^ ]+|--workspace +[^ ]+|--?[a-zA-Z0-9=@/._-]+))*'

# RUNNER — the optional package-runner prefix in front of a verb that is a BINARY name.
#
# Every other gated verb starts with the binary a user types, so START/END alone put it at a
# command boundary. `changeset publish` is the exception: `changeset` is a dependency's bin,
# so it is almost always reached through a runner — `npx`, `pnpm`, `pnpm exec`, `yarn dlx`,
# `bunx`. That is why it was matched with a bare, UNANCHORED `changeset +publish`, and an
# unanchored verb is not a verb: `echo 'to ship, run changeset publish'` — a sentence naming
# the command — was refused. A false denial is the one outcome the header says this gate
# cannot afford, because it is the one that teaches people to route around the guard.
#
# Anchoring with START alone is the mirror-image mistake, and the more expensive one: it
# would match only a bare `changeset publish` and go silently inert for `npx changeset
# publish`, trading a visible false denial for an invisible fail-open. So the boundary is
# kept AND the runner is allowed to sit inside it. PKG_OPTS is reused rather than a second
# option dialect invented, so `pnpm -w changeset publish` reads the same way here as
# `pnpm -C dir publish` does above.
RUNNER="((npx|pnpm|yarn|bun|bunx|npm)${PKG_OPTS}( +(exec|dlx|run|x))?${PKG_OPTS} +)?"

# THE GATED VERBS, named once. Each branch below matches on its own, and each also hands its
# pattern to run_dir_for, which needs to know where the verb SITS in order to ignore a `cd`
# that only runs after it. Written inline in two places they drifted; named here they cannot.
PUBLISH_PM="(npm|pnpm|yarn)${PKG_OPTS} +publish"
PUBLISH_CS="${RUNNER}changeset +publish"
RELEASE_CREATE="(gh|glab) +release +create"
TAG_VERB="git${GIT_OPTS} +tag +"
COMMIT_VERB="git${GIT_OPTS} +commit"

# foreign_repo_flag <cmd-fragment> [dir] -> 0 when --repo names a repo that is not the origin
# of the repository at <dir> (the directory the command RUNS in; BASE when the caller has none).
# Such a tag cannot be mapped to a local note file at all, so the caller fails open by design
# rather than guessing at `.`.
#
# WHICH origin? The one belonging to the repository being released. Reading it with a bare
# `git config` read THIS HOOK's own cwd instead — the same mistake branches 3 and 4 fix for
# the index and the tag — so `cd <repo> && gh release create … --repo owner/name` compared
# the named repo against an unrelated checkout's origin, found no match, called its own
# release foreign and allowed it. That direction is only ever an under-block, never a false
# denial, which is exactly what made it silent: the gate reported nothing and gated nothing.
foreign_repo_flag() {
  local want origin dir="${2:-$BASE}"
  # Trailing separators are not part of a repository name, exactly as they are not part of a
  # tag name in branch 3. The normalisation ends every line with `;`, so `--repo owner/name`
  # at the end of a command yielded `owner/name;` — a string no origin URL can contain, which
  # made this check answer "foreign" for every local release written in that shape.
  want="$(printf '%s' "$1" | grep -Eo -- '--repo[= ]+[^ ]+' | head -1 | sed -E 's/--repo[= ]+//' \
          | tr -d "\"'" | sed -E 's/[;&|)].*$//')"
  [ -z "$want" ] && return 1
  origin="$(git -C "$dir" config --get remote.origin.url 2>/dev/null || true)"
  printf '%s' "$origin" | grep -qF "$want" && return 1
  return 0
}

# pkgdir_for_name <name> [root-hint] -> the package dir whose package.json "name" == $1
# (monorepo resolution for scoped tags).
#
# The root-hint matters when the command named another checkout with `-C`, or ran under a `cd`:
# searching the SESSION's repo for that package name either finds nothing, or — worse — finds a
# same-named package here and checks its notes instead of the one being released. Both end in
# a refusal the released repo can never satisfy.
pkgdir_for_name() {
  local name="$1" hint="${2:-}" root
  if [ -n "$hint" ]; then
    root="$(git -C "$hint" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$hint")"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  fi
  # search common package roots, then fall back to a bounded find
  while IFS= read -r pj; do
    if [ "$(jq -r '.name // empty' "$pj" 2>/dev/null)" = "$name" ]; then
      dirname "$pj"; return 0
    fi
  done < <(find "$root/packages" "$root/apps" "$root" -maxdepth 3 -name package.json -not -path '*/node_modules/*' 2>/dev/null)
  return 1
}

# --- 1. publish (npm/pnpm/yarn/changeset) ----------------------------------
if printf '%s' "$norm" | grep -Eq "${START}${PUBLISH_PM}${END}" \
   || printf '%s' "$norm" | grep -Eq "${START}${PUBLISH_CS}${END}"; then
  # The publish runs in the directory the command `cd`s into, not in the session's cwd, and any
  # `-C`/`--dir` it names is relative to THAT. Resolve in that order; an unresolvable `cd` is
  # unknown ground, so allow. A `cd` AFTER the publish is not the publish's directory, so the
  # verb pattern goes along to say where the scan has to stop.
  rdir="$(run_dir_for "$norm" "${START}(${PUBLISH_PM}|${PUBLISH_CS})${END}")" || exit 0
  # WHICH invocation's flags? Only the publishing one's.
  #
  # `--filter` and `-C/--dir/--cwd/--prefix` were read from the WHOLE line with `head -1`,
  # which is precisely the pairing bug branches 2 and 3 already fix for themselves — and the
  # comment on repo_dir_for already warns about ("callers pass a FRAGMENT holding a single
  # invocation, not the whole line"). Branch 1 was the one that never got the fix. So
  # `pnpm --filter @acme/a build && pnpm publish` handed the BUILD step's package to the
  # publish: the gate read `@acme/a`'s version, checked `@acme/a`'s changelog, and REFUSED a
  # root release whose note was in fact written — a false denial, on the commonest monorepo
  # release line there is, in the shape (`--filter <pkg> build && publish`) that npm, pnpm and
  # yarn all encourage. `pnpm -C packages/a build && pnpm publish` and
  # `npm --prefix packages/a run build && npm publish` did the same thing.
  #
  # So cut the invocation that OWNS the last `publish`: its pre-verb options sit inside the
  # match (PKG_OPTS), its post-verb options run to the next shell separator, and nothing
  # earlier in the line can contribute either. An extraction that finds no flag leaves pdir at
  # the run directory — where the publish actually happens — which is the right default anyway.
  pseg="$(printf '%s' "$norm" \
          | grep -Eo "${START}${RUNNER}((npm|pnpm|yarn)${PKG_OPTS}|changeset) +publish${END}[^;&|)]*" \
          | tail -1)"
  # resolve the package dir: --filter <name>, else -C/--dir <dir>, else the run dir
  pdir=""
  fname="$(printf '%s' "$pseg" | grep -Eo -- '--filter[= ]+@?[a-zA-Z0-9@/._-]+' | head -1 | sed -E 's/--filter[= ]+//')"
  if [ -n "$fname" ]; then pdir="$(pkgdir_for_name "$fname" "$rdir" || true)"; fi
  if [ -z "$pdir" ]; then
    cdir="$(printf '%s' "$pseg" | grep -Eo -- '(-C|--dir|--cwd|--prefix)[= ]+[^ ]+' | head -1 | sed -E 's/^(-C|--dir|--cwd|--prefix)[= ]+//')"
    if [ -n "$cdir" ]; then
      pdir="$(resolve_dir "$cdir" "$rdir")" || exit 0
    else
      pdir="$rdir"
    fi
  fi
  ver="$(jq -r '.version // empty' "$pdir/package.json" 2>/dev/null || true)"
  if [ -n "$ver" ]; then
    notes_status "$pdir" "$ver"; rc=$?
    [ "$rc" = 1 ] && refuse "Publishing $(jq -r .name "$pdir/package.json" 2>/dev/null)@$ver, but $(notes_label "$pdir") never mentions $ver. $BLURB"
  fi
  exit 0   # unresolved -> allow
fi

# --- 2. gh/glab release create <tag> ---------------------------------------
#
# ANCHORED, like branches 1, 3 and 4. It was not, and the omission is the same one
# `changeset publish` shipped with three rounds earlier: an unanchored verb is not a verb,
# it is four words, and this branch refused them wherever they appeared —
# `echo "then run gh release create v9.9.9 to ship"` denied, naming a version nobody is
# releasing and no note can ever satisfy. That is the outcome the header says costs most.
#
# The second direction is worse and was invisible. This branch runs BEFORE the version-bump
# check and `exit 0`s whether or not it refuses, so a commit message containing those four
# words handed branch 2 a version its notes DO mention, and the bump check never ran:
# `git commit -m "chore: bump; then gh release create v1.0.0"` cut an unnoted 1.1.0 while
# the byte-identical commit without those four words was correctly refused. Anchoring closes
# both, because a verb inside a message is no longer at a command position at all.
if printf '%s' "$norm" | grep -Eq "${START}${RELEASE_CREATE}${END}"; then
  # Everything this branch reads must come from the SAME invocation, and from an invocation
  # that is actually being RUN. The strip here was `sed -E "s/.*${RELEASE_CREATE} +//"` —
  # greedy and unanchored, so it read past every earlier occurrence to the last one anywhere
  # on the line, quoted text included. The detectors learned that quoted text is data; this
  # extractor had not, and it failed in both directions on one line of code:
  # `gh release create v1.0.0 --notes "supersedes gh release create v9.9.9"` refused v9.9.9,
  # and `gh release create v9.9.9 --notes "replaces gh release create v1.0.0"` read v1.0.0,
  # found its note, and cut an unnoted release.
  #
  # So the fragment is CUT OUT by the anchored detector pattern — the last invocation that
  # sits at a real command position, bounded at the next shell separator — and the strip is
  # `^`-anchored inside it, where a second copy of the verb is argument text and stays there.
  # `tail -1` keeps the "last invocation wins" rule the tag extractor also uses.
  #
  # Bounding at the separator is a change from the rule this branch inherited ("deliberately
  # NOT truncated ... a real `--repo` could sit behind a quoted `--notes \"a && b\"`"). That
  # reason is gone: the quote pass above already blanked that `&&` into a space, so a
  # separator surviving here is a real one, and reading a LATER command's `--repo` as this
  # release's is the pairing bug this same branch fixed for `--repo` two rounds ago.
  seg="$(printf '%s' "$norm" | grep -Eo "${START}${RELEASE_CREATE}${END}[^;&|)]*" | tail -1 \
          | sed -E "s/^[;&|(]?[[:space:]]*${RELEASE_CREATE}[[:space:]]*//")"
  # Trailing separators are not part of a tag name here either — branch 3 already trims them,
  # and the normalisation ends every line with `;`, so a bare `gh release create v1.4.0` named
  # the tag `v1.4.0;` in the refusal it printed.
  tag="$(printf '%s' "$seg" | awk '{print $1}' | tr -d '"'"'"'' | sed -E 's/[;&|)].*$//')"
  ver="$(printf '%s' "$tag" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?' | tail -1)"
  if [ -n "$ver" ]; then
    # The run directory is needed BEFORE the foreign check, because "foreign" means "not the
    # origin of the repository this command runs in" — see foreign_repo_flag. An unresolvable
    # `cd` is unknown ground either way, so hoisting it changes nothing but the order.
    rdir="$(run_dir_for "$norm" "${START}${RELEASE_CREATE}${END}")" || exit 0
    # A --repo naming a different repository has no local note file to check: fail open.
    # This still runs FIRST of the two lookups: when the package lookup ran first, a package of
    # the same name living in THIS monorepo claimed the release and the foreign check never got
    # to fire, so a release of someone else's repo was judged against our notes.
    if foreign_repo_flag "$seg" "$rdir"; then exit 0; fi
    # scoped tag like @scope/name@1.2.3 -> resolve the package dir by name
    name="$(printf '%s' "$tag" | sed -E 's/@[0-9]+\.[0-9]+\.[0-9].*$//')"
    pdir=""; [ -n "$name" ] && pdir="$(pkgdir_for_name "$name" "$rdir" || true)"
    [ -z "$pdir" ] && pdir="$(repo_dir_for "$seg")"
    [ -z "$pdir" ] && pdir="$rdir"
    notes_status "$pdir" "$ver"; rc=$?
    [ "$rc" = 1 ] && refuse "Creating release $tag, but $(notes_label "$pdir") never mentions $ver. $BLURB"
  fi
  exit 0
fi

# --- 3. git tag <release-tag> ----------------------------------------------
if printf '%s' "$norm" | grep -Eq "${START}${TAG_VERB}"; then
  # Read the tag out of the invocation that is being RUN — the last one sitting at a real
  # command position — not out of the whole line. The strip was `sed -E "s/.*${TAG_VERB}..."`,
  # greedy and unanchored, so the LAST version-looking token anywhere on the line won
  # whatever it was doing there. Quoted prose therefore decided the verdict, both ways:
  # `git tag v1.4.0 -m "supersedes the old git tag v9.9.9 line"` refused v9.9.9 — a version
  # nobody is releasing and no note can ever satisfy — and `git tag v9.9.9 -m "replaces
  # git tag v1.0.0"` read v1.0.0, found its note, and cut an unnoted release. The second is
  # the one nobody would have noticed.
  #
  # `grep -Eo` with the branch's own anchored pattern cuts out one invocation, bounded at the
  # next shell separator; `tail -1` keeps "the last invocation wins", which is what the greedy
  # strip got RIGHT and this has to preserve. The strip inside the fragment is `^`-anchored,
  # so a second `git tag` in the message is argument text and stays argument text. Trailing
  # separators are excluded by the bound, which is also what used to need trimming off the
  # tag name (`git tag v1.4.0; git push` once printed `v1.4.0;` in its refusal).
  tseg="$(printf '%s' "$norm" | grep -Eo "${START}${TAG_VERB}(-a +)?[^;&|)]*" | tail -1)"
  tag="$(printf '%s' "$tseg" | sed -E "s/^[;&|(]?[[:space:]]*${TAG_VERB}(-a +)?//" \
         | awk '{print $1}' | tr -d '"'"'"'')"
  ver="$(printf '%s' "$tag" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?' | tail -1)"
  # only gate tags that look like a release (v1.2.3 or scope/name@1.2.3)
  if [ -n "$ver" ] && printf '%s' "$tag" | grep -Eq '@[0-9]|^v?[0-9]'; then
    # `git -C <dir> tag` releases ANOTHER checkout, so it is judged against THAT repo's notes.
    # Defaulting to `.` refused a release cut from a session rooted in an unrelated project,
    # because that project's notes had no such version and never would.
    # The named dir is also the search root for a scoped monorepo tag: without it pkgdir_for_name
    # walks the session's repo and re-creates the same unsatisfiable refusal.
    #
    # The directory has to come from the SAME invocation the tag came from, so it is read out
    # of the SAME fragment: `git -C a tag v1 && git -C b tag v2` must read v2 with b, and
    # scanning the whole line for `-C` returned `a`, the FIRST one. That pairing checked a's
    # notes for b's version and refused a release whose note WAS written — the cross-repo
    # false block this branch exists to remove, re-created in compound form.
    #
    # The `^`-anchored strip matters as much as the fragment does: `git${GIT_OPTS}` read with
    # a leading `.*` walked forward to the LAST `git … tag` on the line, so a `-C` written
    # inside a commit message — `git tag v9.9.9 -m "see git -C <other> tag v1.0.0"` — chose
    # the repository the release was judged against, and pointed it at a checkout whose notes
    # can say anything at all. Anchored, the options can only be the ones between THIS `git`
    # and THIS ` tag `.
    #
    # A relative `-C`, and a tag cut with no `-C` at all, are relative to the directory the
    # command RUNS in — `cd <repo> && git tag v1.2.3` is another checkout's release, not this one's.
    # A `cd` that runs after the tag is cut is not the tag's directory either, hence the pattern.
    rdir="$(run_dir_for "$norm" "${START}${TAG_VERB}")" || exit 0
    cdir="$(repo_dir_for "$(printf '%s' "$tseg" | sed -nE "s/^[;&|(]?[[:space:]]*(git${GIT_OPTS}) +tag +.*/\1/p")")"
    if [ -n "$cdir" ]; then cdir="$(resolve_dir "$cdir" "$rdir")" || exit 0; else cdir="$rdir"; fi
    name="$(printf '%s' "$tag" | sed -E 's/@[0-9]+\.[0-9]+\.[0-9].*$//')"
    pdir=""; printf '%s' "$name" | grep -q '/' && pdir="$(pkgdir_for_name "$name" "$cdir" || true)"
    [ -z "$pdir" ] && pdir="$cdir"
    notes_status "$pdir" "$ver"; rc=$?
    [ "$rc" = 1 ] && refuse "Tagging $tag, but $(notes_label "$pdir") never mentions $ver. $BLURB"
  fi
  exit 0
fi

# --- 4. version-bump commit ------------------------------------------------
# A commit that stages a package.json "version" bump must also carry the note.
if printf '%s' "$norm" | grep -Eq "${START}${COMMIT_VERB}${END}"; then
  # WHICH index? Not this hook's — the one the commit will actually write. `cd <repoA> && git
  # commit` and `git -C <repoA> commit` both land in repoA, while a bare `git diff --cached` here
  # reports the SESSION's staged files; an unnoted bump staged in repoC therefore refused an
  # unrelated commit in repoA. `-C` beats `cd` because git ignores the process cwd once given one.
  rdir="$(run_dir_for "$norm" "${START}${COMMIT_VERB}${END}")" || exit 0
  cdir="$(repo_dir_for "$(printf '%s' "$norm" | sed -nE "s/.*(git${GIT_OPTS}) +commit.*/\1/p")")"
  if [ -n "$cdir" ]; then cdir="$(resolve_dir "$cdir" "$rdir")" || exit 0; else cdir="$rdir"; fi
  # Then ask that repo from its ROOT. `git diff --cached --name-only` prints paths relative to the
  # root, but a pathspec and a `:path` blob ref are read relative to the CWD — so from a
  # subdirectory the branch fed `packages/cli/package.json` back to git while standing in
  # `packages/cli`, matched nothing, and went silently inert. Cutting a release from inside the
  # package being released is the normal workflow, i.e. the gate was off most of the time it
  # mattered. Everything below therefore runs with `-C "$root"`.
  root="$(git -C "$cdir" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -z "$root" ] && exit 0    # not a readable checkout -> allow
  # staged package.json files whose version actually changed
  while IFS= read -r pj; do
    [ -z "$pj" ] && continue
    # DID THE VERSION CHANGE? Ask the two blobs, not the diff TEXT.
    #
    # `^\+[[:space:]]*"version":` asked whether a line beginning with the version key was
    # added, which is a question only a PRETTY-PRINTED package.json can answer. A manifest
    # written on one line — `{"name":"m","version":"2.0.0"}` — puts the key mid-line, matched
    # nothing, and bumped its version with no note at all, silently allowed. (npm, pnpm and
    # yarn all rewrite the file pretty-printed, so this was a narrow layout; it was still an
    # allow nobody could see.)
    #
    # Loosening the pattern to "a `+` line mentioning version" would have been worse than the
    # bug: EVERY edit to a one-line manifest rewrites the whole line, so adding a dependency
    # would have been read as a version bump and refused — a false denial, on exactly the
    # layout the loosening was meant to rescue. Comparing HEAD's version to the staged one
    # asks the real question and is blind to formatting. A file with no HEAD version (new, or
    # an unreadable old blob) differs from any staged version and is gated, which is what the
    # diff match did with an all-`+` new file too.
    new_ver="$(git -C "$root" show ":$pj" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)"
    old_ver="$(git -C "$root" show "HEAD:$pj" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)"
    if [ -n "$new_ver" ] && [ "$new_ver" != "$old_ver" ]; then
      pdir="$(dirname "$pj")"
      ver="$new_ver"
      # The same-commit escape hatch: a note staged in THIS commit counts, whichever of the
      # candidate files it lives in. Paths are root-relative, so they compare exactly against
      # `--name-only` output. The old substring match built "./CHANGELOG.md" for a root package
      # and never matched the "CHANGELOG.md" git actually prints, losing the escape hatch at the
      # root — and it only ever looked for one filename, so a project noting its release in
      # `docs/releases.md` was refused a commit that staged exactly the right note.
      prefix=""; noteroot="$root"
      if [ "$pdir" != "." ]; then prefix="$pdir/"; noteroot="$root/$pdir"; fi
      if git -C "$root" diff --cached --name-only 2>/dev/null | note_staged "$prefix"; then continue; fi
      notes_status "$noteroot" "$ver"; rc=$?
      [ "$rc" = 1 ] && refuse "This commit bumps $(jq -r .name "$root/$pj" 2>/dev/null)@$ver but stages no release note, and $(notes_label "$noteroot") never mentions $ver. $BLURB"
    fi
  done < <(git -C "$root" diff --cached --name-only 2>/dev/null | grep -E '(^|/)package\.json$' || true)
  exit 0
fi

exit 0
