# Scoped v2 routing profiles

Routing intent is stored as a **v2 profile store scoped by harness and workspace**, not as one global model preference. This prevents a profile chosen for one repository or harness from silently controlling another.

## Scope and location

The profile-store implementation derives a stable key from the harness and the supplied scope, then stores:

```text
<root>/model-routing/<harness>--<scope-basename>-<digest>/profile-v2.json
```

The file is written atomically with restrictive permissions. The scope is an opaque caller-provided identity (normally a workspace or repository path); the digest avoids collisions between similarly named folders.

## v2 shape

```json
{
  "version": 2,
  "active": "coding",
  "profiles": {
    "coding": {
      "models": {
        "driver": "openai/gpt-5.6-sol",
        "builder": "openai/gpt-5.6-terra",
        "sweeper": "fold-builder"
      }
    }
  }
}
```

The model strings above are examples only. A valid v2 store has exactly `driver`, `builder`, and `sweeper` strings for every saved profile. On a harness that cannot independently bind SWEEPER, document the selected degraded mode explicitly in the user-facing routing table; do not represent it as a tested third child binding.

## Operations

- **Setup:** save a validated profile and make it active for this harness/scope.
- **Save:** add or update a named profile without changing the active profile.
- **Show:** compare active intent with the live harness bindings; label `MATCH`, `MISMATCH`, `UNBOUND`, or `NOT ADDRESSABLE`.
- **Switch/change:** validate exact identifiers against the current live inventory, show the complete before/after table, obtain confirmation, apply host settings, and read them back.
- **Clear intent:** set `active` to `null`; leave saved profiles intact.
- **Delete:** remove only the named profile. If it is active, make the resulting inactive state explicit.

A legacy candidate may be migrated only with a matching scope and explicit confirmation. Never auto-import a profile merely because a similarly named file exists.

## Safe reset

Ask which scope the user means before changing anything:

1. clear active routing intent only;
2. restore host routing inheritance and clear active intent; or
3. delete one named profile.

Show old and new values, apply only the confirmed change, and read back live host configuration. Do not delete profiles or alter lifecycle installation as a side effect of a routing reset.
