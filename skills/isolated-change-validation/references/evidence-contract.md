# The evidence contract

Reusable shapes for the artifacts an isolated run produces. They exist so that a reader who saw
none of the run can check each claim, and so that an aggregation script can assert against a
schema rather than infer one. Field names are a starting point — keep whatever names the project
already uses, and keep the distinctions.

Every shape here obeys one rule: **a claim and the evidence for it live in the same record.**
A number with no invocation beside it cannot be checked, and a pass with no hash beside it is
about an unknown tree.

## The baseline manifest

Written before the first edit, over every source and config file the change could affect.

```text
<sha256>  <path relative to the lane root>
```

Beside it, a small record of what the manifest deliberately does not cover, so a later reader
can tell an omission from a miss:

```json
{
  "lane": "candidate",
  "root_kind": "copied-no-git",
  "files": 2985,
  "omitted": [
    { "glob": "**/node_modules/**", "why": "dependency tree, attached read-only after the copy" },
    { "glob": "**/dist/**", "why": "generated; compared separately by hash in the build gate" },
    { "glob": "**/.tsbuildinfo", "why": "compiler cache" }
  ]
}
```

`root_kind` matters: in a copied lane with no git metadata, these hashes *are* the revision
identity, and every later comparison resolves against them.

## The path budget

Two sets, not one. Acceptance asserts exact equality with both.

```json
{
  "allowed_existing": ["packages/<pkg>/src/<file>.ts", "packages/<pkg>/package.json"],
  "allowed_new": ["packages/<pkg>/src/<file>.test.ts"],
  "permitted_generated": ["packages/<pkg>/dist/**"],
  "forbidden_acts": [
    "writing outside the lane",
    "process-wide signals",
    "transfer, commit, push or publication",
    "account, billing or visibility changes",
    "live-provider calls"
  ],
  "on_breach": "stop the child, report the extra path, re-enter the budget before continuing"
}
```

A path that was allowed and never touched is a finding, not a rounding error: either the change
was smaller than the map said, or something was not done.

## A frozen-install record

The evidence that separates a real clean install from a reused tree. Half of it is written
*before* the command runs.

```json
{
  "pre": {
    "argv": ["<package-manager>", "install", "--frozen-lockfile"],
    "cwd": "<lane root>",
    "env_paths": { "HOME": "<scratch home>", "STORE_DIR": "<scratch store>" },
    "node_modules_present": false,
    "store_entries": 0,
    "inputs": { "<lock file>": "<sha256>", "<workspace file>": "<sha256>" }
  },
  "post": {
    "exit": 0,
    "projects": 7,
    "packages_added": 1184,
    "lock_unchanged": true,
    "all_inputs_unchanged": true
  }
}
```

`env_paths` carries paths, never values of credentials. A record naming a secret's *variable* is
fine; a record carrying its value is a leak with a schema.

## A gate result

One per gate, each labelled with what it proves.

```json
{
  "gate": "focused-tests",
  "proves": "current source against the attached dependency tree",
  "does_not_prove": "a clean install, or an external consumer",
  "argv": ["node", "node_modules/<runner>/<entry>", "run", "<path>"],
  "tests": 325, "passed": 325, "failed": 0, "pending": 0,
  "live_provider_calls": false,
  "parsed_from": "runner json output"
}
```

Totals are parsed from the runner's own machine-readable output. A total read out of a child's
prose is a quotation, and quotations survive runs that failed.

## A reviewer report

One per axis. The reviewer fails closed when the hashes it was given no longer match.

```json
{
  "axis": "contract-and-data",
  "source_pins": { "<path>": "<sha256>" },
  "pins_match_at_review_time": true,
  "wrote_only_in": "<reviewer scratch dir>",
  "findings": [
    { "severity": "blocking|non-blocking", "path": "<path>", "claim": "...", "evidence": "..." }
  ],
  "executed_compiled_output": false
}
```

`executed_compiled_output` is load-bearing: a reviewer that ran a build directory it did not
rebuild or hash-verify produced a harness result, not a product verdict.

## The static-scan classification

Raw hits are not findings. Every hit gets a classification, and the run does not finish while any
hit is unclassified.

```json
{
  "files_scanned": 2985,
  "raw_hits": 74,
  "classified_hits": [
    {
      "file": "<path>",
      "pattern": "<detector name>",
      "offset": 7692,
      "classification": "credential-shaped fixture in a redaction test; not a live credential"
    }
  ],
  "unclassified_hits": 0
}
```

Three classifications cover nearly everything: a credential-shaped fixture, a documentation
example, and a real credential — the last of which stops the run rather than being recorded in
it. Keep the offsets: they let the next reader re-derive the classification instead of trusting
this one.

## The final verdict

The artifact the run is judged by. Its fields stay separate on purpose — collapsing them is how a
scoped acceptance turns into an unscoped one.

```json
{
  "status": "technically-accepted-in-isolated-sandbox",
  "scope": "<what was validated, in one sentence>",
  "candidate": {
    "lane": "<lane root>",
    "git_metadata": false,
    "changed_paths": ["..."],
    "added_paths": ["..."],
    "removed_paths": [],
    "source_pins": { "<path>": "<sha256>" }
  },
  "authorization": {
    "frozen_install": true,
    "live_provider_call": false,
    "transfer": false,
    "publication": false,
    "account_change": false,
    "billing_change": false
  },
  "gates": { "typecheck": {}, "build": {}, "focused": {}, "full": {}, "downstream": {} },
  "reviews": [{ "axis": "...", "blocking_findings": 0 }],
  "process_failures": ["a reviewer exhausted its turns; its report was recovered by resuming the same session for synthesis only"],
  "residual_risks": [{ "risk": "...", "settled_by": "<the gate that would settle it>" }],
  "skipped_gates": [{ "gate": "live-provider acceptance", "why": "no authorization", "needs": "explicit approval and a funded account" }],
  "not_authorized_by_this_verdict": ["transfer", "commit", "push", "publication", "signing"]
}
```

`process_failures` and `residual_risks` are the two fields most often quietly dropped, and the
two a later reader most needs. A turn-limit failure does not make good code bad; leaving it out
makes a run look cleaner than it was.
