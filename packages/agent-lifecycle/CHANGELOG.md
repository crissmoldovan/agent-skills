# Changelog

## 0.2.1

- Added end-user, host-integration, and display-fallback usage examples to the
  installable `agent-lifecycle` skill.

All notable changes to this private package are documented here.

## 0.2.0 — 2026-08-24

### Added

- Schema-v1 lifecycle events with `eventId`, `sourceEpoch`, lineage, and explicit capabilities.
- Canonical lifecycle projection with transition validation, identity/sequence handling, and immutable terminal states.
- Activity and heartbeat freshness, stale marking, and reconciliation-gated `lost` synthesis.
- Authoritative complete snapshots that correct non-terminal projections and emit reconciliation audit records.
- Incremental bounded JSONL parsing with redacted diagnostics, plus an append-only single-writer JSONL journal.
- Hermes delegation event normalization and session-open, reconnect, and periodic complete-snapshot reconciliation foundation.
- API and adapter documentation for the implemented contract.

### Limits

- The package remains private and has not been publicly released.
- Hermes Desktop core integration is not shipped; the Hermes module is an adapter foundation for a host integration.
