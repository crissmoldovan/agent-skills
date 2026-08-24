# Routing profile controls

This reference defines user-facing intent. Harness adapters may vary in syntax, but must preserve these effects and report exact model identifiers without normalization.

## Commands and effects

| User intent | Required behavior |
|---|---|
| **setup** | Inventory addressable models, collect exact role selections, show the resulting profile, validate, then save/apply only after confirmation. |
| **show** | Read the active profile and live harness bindings; show profile scope, exact identifiers, provenance, and disagreements. It writes nothing. |
| **change** | Change named role(s) in the active profile after validating each exact identifier; show unchanged roles and request confirmation before writing. |
| **switch** | Load a named saved profile, validate all bindings against the live inventory, show the complete table, then apply after confirmation. Never remap missing models. |
| **clear intent** | Remove only the active session's routing intent. Preserve saved profiles and harness defaults. |
| **reset** | Ask whether the user means clear active intent or restore the host's pre-apply routing configuration from its recorded receipt and clear active intent. State the exact effect before mutation. Reset never deletes all saved profiles. |
| **delete** | Delete the explicitly named saved profile after confirmation. Do not delete a profile merely because it fails validation. |
| **use once** | Validate and apply bindings to the current request/session only. Do not save or alter auto-load behavior. |

## Scopes and auto-load

A saved profile must name a scope such as a user, workspace, repository, or harness-defined project. On later sessions in that scope, the adapter must locate the most-specific applicable saved profile, load it before delegation, validate every identifier against live inventory, show invalid/missing entries, and refuse silent substitution or dispatch through an invalid role.

The portable profile-store root defaults to `~/.agents`. For Hermes, resolve the
active profile home first, then use:

- `harness`: `hermes`
- `scope.kind`: `hermes-home`
- `scope.id`: the active Hermes profile name (`default` for the default home)
- `scope.home`: the resolved `$HERMES_HOME` as diagnostic metadata

Run `skills/model-routing/scripts/profile-store-cli.mjs show` with those exact
values before concluding that no profile exists. The resulting store is under
`~/.agents/model-routing/<derived-scope-key>/profile-v2.json`; do not search only
the legacy `~/.agents/model-routing-tiers.yaml` path.

If no scoped profile exists, ask for exact selections or offer a one-off run. Harness defaults may be shown as context but must not be converted into a profile without user confirmation.

## Profile-store scripts

The catalog ships scoped-intent helpers at these repository-relative paths:

- `skills/model-routing/scripts/profile-store.mjs`
- `skills/model-routing/scripts/profile-store-cli.mjs`

The store and CLI manage profile records and return mutation receipts. A harness adapter must capture
the host's prior routing values before applying a profile, retain that host receipt, and use it for
reset restoration. The helpers do not validate a live model inventory or replace a host's native
UI; do not claim either until actual adapter output has been read.

## Minimum profile record

```yaml
name: <profile-name>
scope: <harness-defined scope>
roles:
  driver: <exact model identifier>
  builders: [<exact model identifier>]
  sweeper: <exact model identifier or omitted>
```

An adapter may add provenance or timestamps, but it must not replace exact identifiers with display names. Omit the sweeper rather than inventing one when it cannot be separately addressed.

## Validation outcomes

Report one outcome per role: **selected** (user chose it), **configured** (adapter persisted/applied it), **dispatched** (a child started with it), **observed** (harness evidence confirms use), **invalid** (absent from live inventory), or **degraded** (role cannot be addressed independently). A dry run may establish validation only; it does not establish dispatched or observed model use.
