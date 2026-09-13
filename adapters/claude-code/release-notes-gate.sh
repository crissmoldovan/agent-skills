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

# run_dir_for <normalized-cmd> -> prints the directory the command actually runs in
# (BASE when it has no `cd`), or FAILS when a `cd` target cannot be resolved.
#
# `cd <dir> && <release action>` is the normal way to act on another package or another
# checkout, and this hook does NOT run in that directory — it runs in the session's cwd. Reading
# the session's index and package.json for a command that will execute elsewhere is how
# `cd <repoA> && git commit -m unrelated` came to be DENIED by an unnoted version bump staged in
# the session's own repoC — a commit with nothing to do with any release — and how
# `cd packages/cli && npm publish` was judged against the ROOT package and the ROOT notes,
# naming the wrong package and the wrong file in the refusal.
#
# The LAST top-level `cd` wins, because that is the one in effect when the verb runs. A `cd`
# that only applies inside a subshell — `(cd a && build) && npm publish` — is over-attributed
# here; it stays harmless because callers fail open whenever the resulting directory has no
# package.json or no note source, and for git commits both directories usually share one repo root.
run_dir_for() {
  local t
  t="$(printf '%s' "$1" \
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

# foreign_repo_flag <cmd-fragment> -> 0 when --repo names a repo that is not this checkout's origin.
# Such a tag cannot be mapped to a local note file at all, so the caller fails open by design
# rather than guessing at `.`.
foreign_repo_flag() {
  local want origin
  want="$(printf '%s' "$1" | grep -Eo -- '--repo[= ]+[^ ]+' | head -1 | sed -E 's/--repo[= ]+//')"
  [ -z "$want" ] && return 1
  origin="$(git config --get remote.origin.url 2>/dev/null || true)"
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
if printf '%s' "$norm" | grep -Eq "${START}(npm|pnpm|yarn)${PKG_OPTS} +publish${END}" \
   || printf '%s' "$norm" | grep -Eq 'changeset +publish'; then
  # The publish runs in the directory the command `cd`s into, not in the session's cwd, and any
  # `-C`/`--dir` it names is relative to THAT. Resolve in that order; an unresolvable `cd` is
  # unknown ground, so allow.
  rdir="$(run_dir_for "$norm")" || exit 0
  # resolve the package dir: --filter <name>, else -C/--dir <dir>, else the run dir
  pdir=""
  fname="$(printf '%s' "$norm" | grep -Eo -- '--filter[= ]+@?[a-zA-Z0-9@/._-]+' | head -1 | sed -E 's/--filter[= ]+//')"
  if [ -n "$fname" ]; then pdir="$(pkgdir_for_name "$fname" "$rdir" || true)"; fi
  if [ -z "$pdir" ]; then
    cdir="$(printf '%s' "$norm" | grep -Eo -- '(-C|--dir|--cwd|--prefix)[= ]+[^ ]+' | head -1 | sed -E 's/^(-C|--dir|--cwd|--prefix)[= ]+//')"
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
if printf '%s' "$norm" | grep -Eq '(gh|glab) +release +create'; then
  # Everything this branch reads must come from the SAME invocation. The tag extractor is greedy,
  # so `gh release create v1 --repo them/other && gh release create @acme/cli@0.1.0` takes the tag
  # from the LAST invocation — while `head -1` over the whole line read `--repo` from the FIRST.
  # That pairing declared the local tag "foreign" and exited: the branch went inert for exactly the
  # release it exists to gate. (Branch 3 had the mirror-image bug; this is the same fix.) So cut the
  # line at the last `release create` and read the tag AND its flags from that tail alone.
  #
  # The tail is deliberately NOT truncated at the next `;`/`&&`: a later command contributing a
  # stray `--repo` only makes this branch fail OPEN, whereas truncating could drop a real `--repo`
  # that sits behind a quoted `--notes "a && b"` and turn a foreign release into a local refusal.
  seg="$(printf '%s' "$norm" | sed -E 's/.*(gh|glab) +release +create +//')"
  tag="$(printf '%s' "$seg" | awk '{print $1}' | tr -d '"'"'"'')"
  ver="$(printf '%s' "$tag" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?' | tail -1)"
  if [ -n "$ver" ]; then
    # A --repo naming a different repository has no local note file to check: fail open.
    # This runs FIRST: when the lookup ran first, a package of the same name living in THIS
    # monorepo claimed the release and the foreign check never got to fire, so a release of
    # someone else's repo was judged against our notes.
    if foreign_repo_flag "$seg"; then exit 0; fi
    # scoped tag like @scope/name@1.2.3 -> resolve the package dir by name
    rdir="$(run_dir_for "$norm")" || exit 0
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
if printf '%s' "$norm" | grep -Eq "${START}git${GIT_OPTS} +tag +"; then
  # Trailing separators are not part of a tag name: `git tag v1.4.0; git push` otherwise
  # named the tag `v1.4.0;` in the refusal it printed.
  tag="$(printf '%s' "$norm" | sed -E "s/.*git${GIT_OPTS} +tag +(-a +)?//" | awk '{print $1}' | tr -d '"'"'"'' | sed -E 's/[;&|)].*$//')"
  ver="$(printf '%s' "$tag" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?' | tail -1)"
  # only gate tags that look like a release (v1.2.3 or scope/name@1.2.3)
  if [ -n "$ver" ] && printf '%s' "$tag" | grep -Eq '@[0-9]|^v?[0-9]'; then
    # `git -C <dir> tag` releases ANOTHER checkout, so it is judged against THAT repo's notes.
    # Defaulting to `.` refused a release cut from a session rooted in an unrelated project,
    # because that project's notes had no such version and never would.
    # The named dir is also the search root for a scoped monorepo tag: without it pkgdir_for_name
    # walks the session's repo and re-creates the same unsatisfiable refusal.
    #
    # The directory has to come from the SAME invocation the tag came from. The extractor
    # above is greedy, so `git -C a tag v1 && git -C b tag v2` reads v2 — while scanning the
    # whole line for `-C` returns `a`, the FIRST one. That pairing checked a's notes for
    # b's version and refused a release whose note WAS written: the cross-repo false block this
    # branch exists to remove, re-created in compound form. So re-match the line and keep the
    # `git <global-opts>` run that owns the last ` tag `, then read `-C` from that alone.
    #
    # A relative `-C`, and a tag cut with no `-C` at all, are relative to the directory the
    # command RUNS in — `cd <repo> && git tag v1.2.3` is another checkout's release, not this one's.
    rdir="$(run_dir_for "$norm")" || exit 0
    cdir="$(repo_dir_for "$(printf '%s' "$norm" | sed -nE "s/.*(git${GIT_OPTS}) +tag +.*/\1/p")")"
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
if printf '%s' "$norm" | grep -Eq "${START}git${GIT_OPTS} +commit${END}"; then
  # WHICH index? Not this hook's — the one the commit will actually write. `cd <repoA> && git
  # commit` and `git -C <repoA> commit` both land in repoA, while a bare `git diff --cached` here
  # reports the SESSION's staged files; an unnoted bump staged in repoC therefore refused an
  # unrelated commit in repoA. `-C` beats `cd` because git ignores the process cwd once given one.
  rdir="$(run_dir_for "$norm")" || exit 0
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
  # staged package.json files whose "version" line changed
  while IFS= read -r pj; do
    [ -z "$pj" ] && continue
    # did the staged diff change the version line?
    if git -C "$root" diff --cached -- "$pj" 2>/dev/null | grep -Eq '^\+[[:space:]]*"version":'; then
      pdir="$(dirname "$pj")"
      ver="$(git -C "$root" show ":$pj" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)"
      [ -z "$ver" ] && continue
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
