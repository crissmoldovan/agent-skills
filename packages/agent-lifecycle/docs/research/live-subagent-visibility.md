# Live subagent visibility across coding-agent harnesses

**Status:** research synthesis plus v0.2.0 implementation context; verified harness behavior and this repository’s shipped scope are explicitly distinguished.

**Research date:** 2026-08-24.

**Scope:** in-session child identity, activity, liveness, terminal evidence, reconciliation, and adapter surfaces. This is not a Kanban or todo-list design.

## Problem

A parent interaction can look idle or end while delegated work continues. If lifecycle events are missed and no repair path exists, useful work becomes visually silent. A durable child view needs stable identity, current activity, freshness, terminal state, inspectable evidence, and reconnect reconciliation.

## Findings

1. Major coding-agent harnesses have native child-agent concepts, but no reviewed harness provides a cross-harness standard for registering an arbitrary external child in its stock native UI.
2. Reliable visibility requires low-latency events **and** an authoritative state-repair path. Event silence is not completion.
3. Child sessions, task records, transcripts, journals, and server snapshots are useful recovery evidence, but availability and stability vary by harness.
4. A portable implementation should use a small vendor-neutral lifecycle record and one adapter per harness.
5. ACP, AG-UI, A2A, MCP, and OpenTelemetry contribute useful concepts, but none is an adopted live-child registration standard.

## v0.2.0 repository scope

This repository now implements the schema-v1 normalizer, canonical lifecycle projector, JSONL parser/journal, complete-snapshot correction audit, stale-then-lost policy primitives, and a Hermes delegation reconciliation adapter foundation. It does not ship a hosted service, an adapter integration in a product UI, or Hermes Desktop core integration.

## Native capability matrix

| Harness | Native in-session children | Typical live source | Inspectability | Recovery signal | Arbitrary foreign-process registration |
|---|---|---|---|---|---|
| Hermes | Yes | delegation lifecycle events | child session/watch view | delegation registry, session evidence | No public general mechanism reviewed |
| Claude Code | Yes | hooks, stream JSON, forwarded child output | task views and child transcripts | child JSONL transcript | No |
| Codex | Yes | app-server thread, turn, item, and collaboration events | child threads and subagent views | persisted thread/rollout state | No generic foreign insertion |
| Cursor | Yes | task UI, hooks, stream JSON, cloud events | native local/cloud views | local state and cloud APIs | No |
| Kimi Code | Yes | child events, hooks, background-task events | TUI/web activity | task records and child files | No |
| GitHub Copilot CLI | Yes | SDK lifecycle stream | `/tasks`, timeline, steering | event journal and local index | No |
| Gemini CLI | Experimental | interactive events and telemetry | foreground group display | child recordings | No arbitrary live-process adoption |
| OpenCode | Yes | server events and SSE | child sessions across UI surfaces | REST session/child reads | No arbitrary process adoption |
| Qwen Code | Yes | daemon events and hooks | TUI/web/daemon tree | replayable daemon and sidecars | No public arbitrary attach API |
| Goose | Yes | task APIs and child tool activity | child session view | persisted session store | Lifecycle remains Goose-owned |
| Warp/Oz | Yes | proprietary run API/timeline | local/cloud/web runs | durable run records | Can link runs created through its API, not retrospectively adopt arbitrary processes |

These are comparative observations, not compatibility commitments. Verify each adapter against the vendor’s current documentation and supported release.

## Evidence-backed integration classes

### 1. Structured native adapters

Use a documented server, SDK, or control-plane interface to create and observe harness-owned children. Codex app-server, GitHub Copilot SDK, OpenCode/Kilo HTTP plus SSE, Warp API, and the Qwen daemon are candidates. These can often provide stable identifiers and explicit reconciliation.

### 2. Hook and transcript adapters

Use hooks, CLI streams, task records, and durable transcripts where no rich child event API is available. Claude Code, Kimi Code, Cursor, Factory Droid, and Kiro fit this class. Treat hook delivery as observation, not sole authority; reconcile against durable records whenever possible.

### 3. Extension-owned wrappers

An extension can launch and represent a child itself, preserving a portable lifecycle even where the host has no general registry. These wrappers cannot truthfully claim native adoption unless the host creates and owns the child record.

## Recommended architecture

1. Normalize events into the [portable child-lifecycle contract](child-lifecycle-contract.md).
2. Retain native identifiers and transcript references without exporting sensitive contents.
3. Persist an append-only local journal where replay and diagnosis are needed.
4. Reconcile against an authoritative complete snapshot after reconnect, UI restart, or stale heartbeats.
5. Mark a child stale before declaring it lost, and only after reconciliation failure.
6. Render unknown capability or state explicitly; never infer success from missing activity.
7. Keep each adapter honest about whether it creates a native child, observes one, or wraps a process it owns.

## Standards assessment

| Standard | Useful contribution | Missing for this use case |
|---|---|---|
| ACP | session, tool, and plan transport | normative parent/child agent tree |
| AG-UI | frontend run, activity, and snapshot vocabulary | first-class child-agent instance primitive |
| A2A | remote agent and task lifecycle | local helper-instance ergonomics |
| MCP progress/tasks | request and tool progress | durable child identity |
| OpenTelemetry GenAI | tracing and diagnostics | interactive session control |

## Source index

Verify current behavior against the vendor documentation before relying on it in an adapter.

- [Hermes delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)
- [Hermes subagent lifecycle API](https://hermes-agent.nousresearch.com/docs/developer-guide/subagent-lifecycle-api)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Codex subagents](https://developers.openai.com/codex/subagents)
- [Codex app-server](https://developers.openai.com/codex/app-server)
- [Cursor subagents](https://cursor.com/docs/subagents)
- [Kimi Code agents](https://moonshotai.github.io/kimi-code/en/customization/agents.html)
- [GitHub Copilot SDK streaming events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)
- [Gemini CLI subagents](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md)
- [OpenCode SDK](https://opencode.ai/docs/sdk)
- [Qwen Code](https://github.com/QwenLM/qwen-code)
- [Goose subagents](https://block.github.io/goose/docs/guides/context-engineering/subagents/)
- [Warp orchestration](https://docs.warp.dev/platform/orchestration/)
- [ACP prompt lifecycle](https://agentclientprotocol.com/protocol/prompt-turn)
- [AG-UI events](https://docs.ag-ui.com/concepts/events)
- [A2A streaming and async tasks](https://a2a-protocol.org/latest/topics/streaming-and-async)
- [MCP progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress)

## Research boundaries

This document is a sanitized durable synthesis. It omits private source-tree locations, local cache paths, internal revision references, local session artifacts, and unsupported implementation claims. It does not endorse a vendor or promise adapter support.
