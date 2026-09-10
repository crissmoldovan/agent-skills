#!/usr/bin/env node
// GENERATED from packages/agent-journal/src by bundle:skill. Do not edit.
// source-sha256: ba2502bd736ff4c5fe1aeb8e14c1d9393e43c6c74eb027e1d7704d05caf472f2
// body-sha256: 56578d726b8039c8fe5f800fed9ddc9f9442c3f7ead534c75b4a4528396a5c2d

// src/cli.ts
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { readdir, readFile as readFile2, mkdir as mkdir2, writeFile, stat as stat2, rename, rm } from "node:fs/promises";
import { join as join4, dirname as dirname2, sep as sep2, relative } from "node:path";

// src/disclosure.ts
var DISCLOSURE_CLASSES = ["private", "team", "published"];
var RANK = { private: 0, team: 1, published: 2 };
function normalizeDisclosure(v) {
  return v === "team" || v === "published" ? v : "private";
}
function readableAt(entry, level) {
  return RANK[entry.disclosure] >= RANK[level];
}

// src/envelope.ts
var ANCHOR_CLASSES = [
  "commit",
  "file",
  "environment",
  "visual",
  "runtime",
  "tool_use",
  "message",
  "url",
  "external"
];
var AUTHORS = /* @__PURE__ */ new Set(["agent", "human"]);
var PROVENANCES = /* @__PURE__ */ new Set(["hook", "cli", "http", "mcp", "transcript"]);
var RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function text(v, field) {
  if (typeof v !== "string" || !v.trim()) throw new TypeError(`${field} is required`);
  return v.trim();
}
function timestamp(v, field) {
  const s = text(v, field);
  if (!RFC3339.test(s) || Number.isNaN(Date.parse(s))) {
    throw new TypeError(`${field} must be RFC3339 UTC`);
  }
  return s;
}
function normalizeCapabilities(v) {
  const given = isRecord(v) ? v : {};
  const out = {};
  for (const cls of ANCHOR_CLASSES) out[cls] = given[cls] === "known" ? "known" : "unknown";
  return out;
}
function normalizeEvent(value) {
  if (!isRecord(value)) throw new TypeError("event must be an object");
  if (value.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  const author = text(value.author, "author");
  if (!AUTHORS.has(author)) throw new TypeError(`author must be agent or human, got ${author}`);
  const provenance = text(value.provenance, "provenance");
  if (!PROVENANCES.has(provenance)) throw new TypeError(`provenance is not recognised: ${provenance}`);
  let sequence;
  if (value.sequence !== void 0) {
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
      throw new TypeError("sequence must be a non-negative integer");
    }
    sequence = value.sequence;
  }
  if (value.data !== void 0 && !isRecord(value.data)) throw new TypeError("data must be an object");
  return {
    schemaVersion: 1,
    id: text(value.id, "id"),
    source: text(value.source, "source"),
    sourceEpoch: text(value.sourceEpoch, "sourceEpoch"),
    ...sequence === void 0 ? {} : { sequence },
    time: timestamp(value.time, "time"),
    workspace: text(value.workspace, "workspace"),
    session: text(value.session, "session"),
    agent: text(value.agent, "agent"),
    author,
    provenance,
    harness: text(value.harness, "harness"),
    context: text(value.context, "context"),
    capabilities: normalizeCapabilities(value.capabilities),
    kind: text(value.kind, "kind"),
    ...value.subject === void 0 ? {} : { subject: text(value.subject, "subject") },
    data: isRecord(value.data) ? value.data : {},
    disclosure: normalizeDisclosure(value.disclosure)
  };
}
function capabilitiesWithAnchors(base, anchors) {
  const out = { ...base };
  for (const a of anchors) out[a.type] = "known";
  return out;
}

// src/entry.ts
var INFLUENCE_TYPES = [
  "url",
  "document",
  "journal",
  "ticket",
  "conversation",
  "tool_result",
  "codebase",
  "person",
  "model_knowledge"
];
var INFLUENCE_ROLES = ["decisive", "supporting", "considered", "contradicted"];
var ANCHOR_SET = new Set(ANCHOR_CLASSES);
var TYPE_SET = new Set(INFLUENCE_TYPES);
var ROLE_SET = new Set(INFLUENCE_ROLES);
function parseAnchor(spec) {
  const cut = spec.indexOf(":");
  if (cut <= 0) throw new TypeError(`an anchor needs <class>:<ref>, got ${JSON.stringify(spec)}`);
  const type = spec.slice(0, cut);
  const ref = spec.slice(cut + 1).trim();
  if (!ANCHOR_SET.has(type)) {
    throw new TypeError(`unknown anchor class ${JSON.stringify(type)}; one of ${ANCHOR_CLASSES.join(", ")}`);
  }
  if (!ref) throw new TypeError(`anchor ${type} has no ref`);
  return { type, ref };
}
function parseInfluence(spec) {
  const first = spec.indexOf(":");
  if (first <= 0) throw new TypeError(`an influence needs <type>:<role>[:<ref>], got ${JSON.stringify(spec)}`);
  const type = spec.slice(0, first);
  const rest = spec.slice(first + 1);
  const second = rest.indexOf(":");
  const role = second === -1 ? rest : rest.slice(0, second);
  const ref = second === -1 ? "" : rest.slice(second + 1).trim();
  if (!TYPE_SET.has(type)) {
    throw new TypeError(`unknown influence type ${JSON.stringify(type)}; one of ${INFLUENCE_TYPES.join(", ")}`);
  }
  if (!ROLE_SET.has(role)) {
    throw new TypeError(`unknown influence role ${JSON.stringify(role)}; one of ${INFLUENCE_ROLES.join(", ")}`);
  }
  if (type === "model_knowledge") {
    return ref ? { type, role, ref } : { type, role };
  }
  if (!ref) throw new TypeError(`influence ${type} has no ref; only model_knowledge may omit one`);
  return { type, role, ref };
}
var KIND_FIELDS = {
  decision: ["question", "chosen", "rejected", "rationale", "reversibility", "blastRadius", "confidence"],
  finding: ["claim", "evidence", "premise", "scope"],
  assumption: ["assumed", "ifWrong", "checked"],
  blocker: ["blocked", "on", "owner", "clearedBy"],
  progress: ["did", "next", "externalRef"],
  constraint: ["statement", "origin", "scope", "expiry", "enforcement"]
};
var LIST_FIELDS = /* @__PURE__ */ new Set(["rejected", "evidence", "premise"]);
var ENUM_FIELDS = {
  decision: { reversibility: ["trivial", "moderate", "hard", "one-way"] },
  assumption: { checked: ["yes", "no"] },
  constraint: { enforcement: ["advisory", "blocking"] },
  finding: { scope: ["machine", "workspace", "general"] }
};
function fieldsFor(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_FIELDS, kind) ? KIND_FIELDS[kind] : [];
}
function normalizeEntryData(kind, given) {
  const out = {};
  for (const field of fieldsFor(kind)) {
    const raw = given.get(field);
    if (!raw || raw.length === 0) continue;
    const values = raw.filter((v) => v.trim() !== "");
    if (values.length === 0) continue;
    const allowed = ENUM_FIELDS[kind]?.[field];
    if (allowed) {
      for (const v of values) {
        if (!allowed.includes(v)) {
          throw new TypeError(`--${field} must be one of ${allowed.join(", ")}, got ${JSON.stringify(v)}`);
        }
      }
    }
    out[field] = LIST_FIELDS.has(field) ? [...values] : values[values.length - 1];
  }
  return out;
}

// src/observe.ts
var OBSERVATION_KINDS = [
  "session_start",
  "session_end",
  "turn_end",
  "tool_call",
  "tool_result",
  "tool_failure",
  "permission",
  "subagent_start",
  "subagent_stop",
  "compact",
  "heartbeat",
  "environment",
  "path_claim",
  "void"
];
var OBSERVATION_FIELDS = {
  session_start: ["harness", "cwd", "branch"],
  session_end: ["reason"],
  turn_end: ["turn"],
  tool_call: ["tool", "input", "callId"],
  tool_result: ["tool", "callId", "summary"],
  tool_failure: ["tool", "callId", "error"],
  permission: ["tool", "decision"],
  subagent_start: ["agentId", "purpose"],
  subagent_stop: ["agentId", "status"],
  compact: ["reason"],
  heartbeat: [],
  environment: ["interpreter", "version", "platform", "packageManager", "flags"],
  path_claim: ["checkout", "worktree", "branch", "ttlSeconds"],
  void: []
};
function fieldsForObservation(kind) {
  return Object.prototype.hasOwnProperty.call(OBSERVATION_FIELDS, kind) ? OBSERVATION_FIELDS[kind] : [];
}
function normalizeObservationData(kind, given) {
  const out = {};
  for (const field of fieldsForObservation(kind)) {
    const values = given.get(field);
    if (!values || values.length === 0) continue;
    const last = values[values.length - 1];
    if (!last.trim()) continue;
    out[field] = last.trim();
  }
  return out;
}

// src/environment.ts
function captureEnvironment(proc = process) {
  const pm = proc.env?.npm_config_user_agent?.split(" ")[0]?.trim();
  const flags2 = proc.execArgv?.join(" ").trim();
  return {
    interpreter: proc.execPath,
    version: proc.version,
    platform: `${proc.platform}/${proc.arch}`,
    ...pm ? { packageManager: pm } : {},
    ...flags2 ? { flags: flags2 } : {}
  };
}

// src/journal.ts
import { appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

// src/redact.ts
var PATTERNS = [
  { name: "github-token", re: /gh[pousr]_[A-Za-z0-9]{16,}/g },
  { name: "openai-key", re: /sk-[A-Za-z0-9_-]{16,}/g },
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "bearer", re: /Bearer\s+[A-Za-z0-9._-]{16,}/gi },
  // Every pattern above matches a secret by its own SHAPE. These two match by
  // the NAME it is assigned to, because the observation plane changed what
  // reaches this function: previously only agent prose, now every Bash command
  // line and tool response, verbatim. A secret with no distinctive prefix --
  // `aws_secret_access_key=wJalrXUt...` -- has no shape to catch, and went to
  // disk byte-for-byte.
  //
  // Two patterns rather than one, because the separator decides how much
  // ambiguity is safe. With an explicit `=` or `:`, ANY secret-ish name is
  // enough. With only whitespace, it is not -- `token required-immediately` is
  // ordinary prose -- so that form additionally demands a leading `-`/`--`,
  // making it a command-line flag rather than a sentence.
  //
  // The value alternation carries quoted forms FIRST so that a quoted secret
  // containing spaces (`password="my secret pw"`) is taken whole; the bare form
  // would otherwise stop at the first space and leave most of it on disk.
  { name: "assigned-secret", re: /((?:secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|auth)[A-Za-z0-9_-]*["']?\s*[:=]\s*)(?:"[^"\n]{8,}"|'[^'\n]{8,}'|[^\s"';,]{8,})/gi, keepPrefix: true },
  // The third form: a bare keyword and whitespace, no `=` and no leading dash --
  // `aws configure set aws_secret_access_key wJalrXUt...`. Whitespace alone
  // cannot separate a secret from a sentence, so this one gates on the VALUE
  // instead: an unbroken 16+ character run containing at least one digit. That
  // is what a generated credential looks like and what prose does not --
  // `token required-immediately` has no digit and is left alone.
  //
  // Note NOT case: an earlier draft also demanded an upper-case letter, which
  // the /i flag silently made a no-op, so the comment described a gate that was
  // not running. Length-and-digit is what is actually enforced.
  { name: "adjacent-secret", re: /((?:secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_-]*\s+)(?=[^\s"';,]{16,}(?:\s|$))(?=[^\s"';,]*[0-9])[^\s"';,]+/gi, keepPrefix: true },
  { name: "flag-secret", re: /(--?[A-Za-z0-9-]*(?:secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|auth)[A-Za-z0-9_-]*\s+)(?:"[^"\n]{8,}"|'[^'\n]{8,}'|[^\s"';,-][^\s"';,]{7,})/gi, keepPrefix: true },
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: "home-path", re: /\/(?:Users|home)\/[^/\s"']+/g },
  { name: "home-path-win", re: /[A-Za-z]:\\Users\\[^\\\s"']+/g }
];
var DEFAULT_MAX_BYTES = 262144;
var DEFAULT_MAX_DEPTH = 32;
function scrub(input, hits, path) {
  let out = input;
  for (const { name, re, keepPrefix } of PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    hits.push(`${path}:${name}`);
    out = keepPrefix ? out.replace(re, "$1[REDACTED]") : name === "home-path" ? out.replace(re, "/[REDACTED]") : out.replace(re, "[REDACTED]");
  }
  return out;
}
function redact(value, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const hits = [];
  let serialized;
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch (error) {
    return {
      value: void 0,
      verdict: "failed",
      hits: [],
      reason: `unscannable value: ${error.message}`
    };
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    return {
      value: void 0,
      verdict: "failed",
      hits: [],
      reason: `value exceeds the ${maxBytes}-byte scan budget`
    };
  }
  function walk(node, depth, path) {
    if (depth > maxDepth) throw new RangeError(`depth exceeds ${maxDepth} at ${path}`);
    const here = path || "$";
    if (typeof node === "string") return scrub(node, hits, here);
    if (node === null || typeof node !== "object") return node;
    if (node instanceof String) return scrub(node.valueOf(), hits, here);
    if (node instanceof Number || node instanceof Boolean) return node.valueOf();
    if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) {
      const view = node instanceof ArrayBuffer ? new Uint8Array(node) : new Uint8Array(
        node.buffer,
        node.byteOffset,
        node.byteLength
      );
      return scrub(new TextDecoder().decode(view), hits, here);
    }
    const toJson = node.toJSON;
    if (typeof toJson === "function") {
      return walk(toJson.call(node), depth + 1, path);
    }
    if (Array.isArray(node)) return node.map((item, i) => walk(item, depth + 1, `${path}[${i}]`));
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = walk(v, depth + 1, path ? `${path}.${k}` : k);
    }
    return out;
  }
  try {
    const scrubbed = walk(value, 0, "");
    return { value: scrubbed, verdict: hits.length > 0 ? "redacted" : "clean", hits };
  } catch (error) {
    hits.length = 0;
    return { value: void 0, verdict: "failed", hits, reason: error.message };
  }
}

// src/journal.ts
var DEFAULT_ROTATE_BYTES = 524288;
var SegmentJournal = class {
  #options;
  #rotateBytes;
  #index = 0;
  #queue = Promise.resolve();
  constructor(options) {
    this.#options = options;
    this.#rotateBytes = options.rotateBytes ?? DEFAULT_ROTATE_BYTES;
  }
  get #dir() {
    const { root, workspace, machine, session } = this.#options;
    return join(root, "workspaces", workspace, "segments", machine, session);
  }
  segmentPath() {
    const { agent, epoch } = this.#options;
    return join(this.#dir, `${agent}.${epoch}.${this.#index}.jsonl`);
  }
  async #rotateIfNeeded() {
    try {
      const info = await stat(this.segmentPath());
      if (info.size >= this.#rotateBytes) this.#index += 1;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  /**
   * Redaction is the only fail-closed path (spec 12). A failed verdict refuses the
   * write rather than writing a possible secret.
   */
  async append(event) {
    const scrubbed = redact(event);
    if (scrubbed.verdict === "failed") {
      return {
        written: false,
        path: this.segmentPath(),
        verdict: "failed",
        ...scrubbed.reason === void 0 ? {} : { reason: scrubbed.reason }
      };
    }
    let path = this.segmentPath();
    const write = this.#queue.then(async () => {
      await mkdir(this.#dir, { recursive: true });
      await this.#rotateIfNeeded();
      path = this.segmentPath();
      await appendFile(path, `${JSON.stringify(scrubbed.value)}
`, "utf8");
    });
    this.#queue = write.catch(() => void 0);
    await write;
    return { written: true, path, verdict: scrubbed.verdict };
  }
};

// src/read.ts
var MAX_DIAGNOSTICS = 32;
function parseSegment(text4) {
  const events = [];
  const bad = [];
  const lines = text4.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      events.push(normalizeEvent(JSON.parse(raw)));
    } catch (error) {
      if (bad.length < MAX_DIAGNOSTICS) {
        bad.push({ line: i + 1, message: error.message });
      }
    }
  }
  return { events, bad };
}
function sourceKey(e) {
  return `${e.source}\0${e.sourceEpoch}`;
}
function mergeEvents(batches) {
  const byId = /* @__PURE__ */ new Map();
  for (const batch of batches) {
    for (const e of batch) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const groups = /* @__PURE__ */ new Map();
  for (const e of byId.values()) {
    const key = sourceKey(e);
    const list2 = groups.get(key);
    if (list2) list2.push(e);
    else groups.set(key, [e]);
  }
  for (const list2 of groups.values()) {
    list2.sort((a, b) => {
      const aUnsequenced = a.sequence === void 0 ? 1 : 0;
      const bUnsequenced = b.sequence === void 0 ? 1 : 0;
      if (aUnsequenced !== bUnsequenced) return aUnsequenced - bUnsequenced;
      if (aUnsequenced === 0) {
        const bySequence = a.sequence - b.sequence;
        return bySequence !== 0 ? bySequence : a.id.localeCompare(b.id);
      }
      const byTime = Date.parse(a.time) - Date.parse(b.time);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
  }
  const earliest = (list2) => list2.reduce((min, e) => Math.min(min, Date.parse(e.time)), Number.POSITIVE_INFINITY);
  return [...groups.entries()].sort(([kx, gx], [ky, gy]) => {
    const byTime = earliest(gx) - earliest(gy);
    return byTime !== 0 ? byTime : kx.localeCompare(ky);
  }).flatMap(([, list2]) => list2);
}

// src/retract.ts
function stringField(event, field) {
  const v = event.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function journalInfluences(event) {
  const raw = event.data.influences;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const rec = item;
      if (rec.type === "journal" && typeof rec.ref === "string") out.push(rec.ref);
    }
  }
  return out;
}
function project(events) {
  const superseded = /* @__PURE__ */ new Set();
  const invalidated = /* @__PURE__ */ new Set();
  const outcomes = /* @__PURE__ */ new Map();
  for (const e of events) outcomes.set(e.id, "unknown");
  for (const e of events) {
    const sup = stringField(e, "supersedes");
    if (sup) superseded.add(sup);
    const inv = stringField(e, "invalidates");
    if (inv) invalidated.add(inv);
  }
  for (const e of events) {
    const declared = e.data.outcome;
    if (declared === "held" || declared === "reverted") outcomes.set(e.id, declared);
  }
  for (const id of superseded) outcomes.set(id, "reverted");
  for (const id of invalidated) outcomes.set(id, "invalidated");
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of events) {
      if (invalidated.has(e.id)) continue;
      if (journalInfluences(e).some((ref) => invalidated.has(ref))) {
        invalidated.add(e.id);
        outcomes.set(e.id, "invalidated");
        changed = true;
      }
    }
  }
  const live = events.filter((e) => !superseded.has(e.id) && !invalidated.has(e.id));
  return { live, superseded, invalidated, outcomes };
}

// src/tombstone.ts
var TOMBSTONE_KIND = "tombstone";
function stringField2(event, field) {
  const v = event.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function purgedField(event) {
  const v = event.data.purged;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().length > 0;
  return false;
}
function tombstonesIn(events) {
  const out = [];
  for (const e of events) {
    if (e.kind !== TOMBSTONE_KIND) continue;
    const reason = stringField2(e, "reason");
    if (!reason) continue;
    const target = stringField2(e, "target");
    if (!target) continue;
    if (target === e.id) continue;
    out.push({ id: e.id, target, reason, time: e.time, purged: purgedField(e) });
  }
  out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return out;
}
function suppressedIds(events) {
  const out = /* @__PURE__ */ new Set();
  for (const t of tombstonesIn(events)) out.add(t.target);
  return out;
}
function tombstonesActuallyPurged(planned, removedIds, survivingIds = /* @__PURE__ */ new Set()) {
  return planned.filter((t) => removedIds.has(t.target) && !survivingIds.has(t.target));
}

// src/retention.ts
var ENTRY_KINDS = /* @__PURE__ */ new Set(["decision", "finding", "assumption", "blocker", "progress", "constraint"]);
var OBSERVATION_KIND_SET = new Set(OBSERVATION_KINDS);
function anchorRefs(event) {
  const raw = event.data.anchors;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const ref = item.ref;
      if (typeof ref === "string") out.push(ref);
    }
  }
  return out;
}
function isEntry(event) {
  return ENTRY_KINDS.has(event.kind);
}
function applyRetention(events, options) {
  const tombstoned = suppressedIds(events);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`options.now must be a parseable timestamp, got ${JSON.stringify(options.now)}`);
  }
  if (!Number.isFinite(options.observationTtlMs) || options.observationTtlMs < 0) {
    throw new TypeError("options.observationTtlMs must be a non-negative finite number");
  }
  if (!Number.isFinite(options.entryTtlMs) || options.entryTtlMs < 0) {
    throw new TypeError("options.entryTtlMs must be a non-negative finite number");
  }
  const observationCutoff = nowMs - options.observationTtlMs;
  const entryCutoff = nowMs - options.entryTtlMs;
  const { invalidated } = project(events);
  const pinnedIds = /* @__PURE__ */ new Set();
  for (const e of events) {
    if (!isEntry(e) || invalidated.has(e.id) || tombstoned.has(e.id)) continue;
    if (Date.parse(e.time) < entryCutoff) continue;
    for (const ref of anchorRefs(e)) pinnedIds.add(ref);
  }
  const expired = [];
  const pinned = [];
  const unclassified = [];
  const tombstonedOut = [];
  const keep = [];
  for (const e of events) {
    if (e.kind === TOMBSTONE_KIND) {
      keep.push(e);
      continue;
    }
    if (tombstoned.has(e.id)) {
      tombstonedOut.push(e.id);
      continue;
    }
    if (isEntry(e)) {
      if (Date.parse(e.time) >= entryCutoff) {
        keep.push(e);
        continue;
      }
      expired.push(e.id);
      continue;
    }
    if (!OBSERVATION_KIND_SET.has(e.kind)) {
      unclassified.push(e.id);
      keep.push(e);
      continue;
    }
    if (Date.parse(e.time) >= observationCutoff) {
      keep.push(e);
      continue;
    }
    if (pinnedIds.has(e.id)) {
      pinned.push(e.id);
      keep.push(e);
      continue;
    }
    expired.push(e.id);
  }
  const gone = /* @__PURE__ */ new Set([...expired, ...tombstoned]);
  const downgraded = keep.filter((e) => isEntry(e) && anchorRefs(e).some((ref) => gone.has(ref))).map((e) => e.id);
  return { keep, expired, pinned, downgraded, unclassified, tombstoned: tombstonedOut };
}

// src/coverage.ts
function voidEvent(input) {
  return normalizeEvent({
    schemaVersion: 1,
    id: input.id,
    source: input.source,
    sourceEpoch: input.sourceEpoch,
    time: input.time,
    workspace: input.workspace,
    session: input.session,
    agent: input.agent,
    author: input.author ?? "agent",
    provenance: input.provenance ?? "hook",
    harness: input.harness,
    context: input.context ?? "coding",
    kind: "void",
    data: { reason: input.reason, ...input.detail === void 0 ? {} : { detail: input.detail } }
  });
}
function coverage(events, options = {}) {
  const sessions = /* @__PURE__ */ new Set();
  const withEntries = /* @__PURE__ */ new Set();
  const bySource = /* @__PURE__ */ new Map();
  let voids = 0;
  for (const e of events) {
    sessions.add(e.session);
    if (isEntry(e)) withEntries.add(e.session);
    if (e.kind === "void") voids += 1;
    if (e.sequence !== void 0) {
      const key = `${e.source}\0${e.sourceEpoch}`;
      const list2 = bySource.get(key) ?? [];
      list2.push(e.sequence);
      bySource.set(key, list2);
    }
  }
  const sequenceGaps = [];
  for (const [key, seqs] of bySource) {
    const sorted = [...seqs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] - sorted[i - 1] > 1) {
        sequenceGaps.push(`${key.replace("\0", "@")}: ${sorted[i - 1]} to ${sorted[i]}`);
      }
    }
  }
  return {
    sessions: sessions.size,
    sessionsWithNoEntries: [...sessions].filter((s) => !withEntries.has(s)).sort(),
    sessionsWithNoEvents: options.knownSessions === void 0 ? null : [...options.knownSessions].filter((s) => !sessions.has(s)).sort(),
    voids,
    sequenceGaps,
    downgradedAnchors: options.downgradedAnchors === void 0 ? null : [...options.downgradedAnchors]
  };
}

// src/constraints.ts
function text2(event, field) {
  const v = event.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
var BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
function liveConstraints(events, now) {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`now must be a parseable timestamp, got ${JSON.stringify(now)}`);
  }
  const { superseded, invalidated } = project(events);
  const out = [];
  for (const e of events) {
    if (e.kind !== "constraint") continue;
    if (superseded.has(e.id) || invalidated.has(e.id)) continue;
    const statement = text2(e, "statement");
    if (!statement) continue;
    const rawExpiry = e.data.expiry;
    const expiryPresent = rawExpiry !== void 0;
    const expiry = text2(e, "expiry");
    let malformedExpiry = false;
    if (expiryPresent && typeof rawExpiry !== "string") {
      malformedExpiry = true;
    } else if (expiry) {
      const end = BARE_DATE.test(expiry) ? Date.parse(`${expiry}T23:59:59.999Z`) : Date.parse(expiry);
      if (Number.isNaN(end)) {
        malformedExpiry = true;
      } else if (nowMs > end) {
        continue;
      }
    }
    const origin = text2(e, "origin");
    const scope = text2(e, "scope");
    const enforcement = e.data.enforcement === "blocking" ? "blocking" : "advisory";
    out.push({
      id: e.id,
      statement,
      enforcement,
      ...origin === void 0 ? {} : { origin },
      ...scope === void 0 ? {} : { scope },
      ...expiry === void 0 ? {} : { expiry },
      ...malformedExpiry ? { malformedExpiry: true } : {}
    });
  }
  return out;
}
function constraintsMatching(strings, live) {
  const haystack = strings.join(" ").toLowerCase();
  return live.filter((c) => {
    if (!c.scope) return false;
    const word = c.scope.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(haystack);
  });
}
function constraintsBearingOn(entry, live) {
  if (entry.kind === "constraint") return [];
  const strings = Object.values(entry.data).flatMap((v) => Array.isArray(v) ? v : [v]).filter((v) => typeof v === "string");
  return constraintsMatching(strings, live);
}

// src/claims.ts
var DEFAULT_TTL_SECONDS = 3600;
function text3(e, field) {
  const v = e.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function liveClaims(events, now) {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new TypeError(`now must be a parseable timestamp, got ${JSON.stringify(now)}`);
  }
  const ended = /* @__PURE__ */ new Set();
  for (const e of events) if (e.kind === "session_end") ended.add(e.session);
  const latest = /* @__PURE__ */ new Map();
  for (const e of events) {
    if (e.kind !== "path_claim" || ended.has(e.session)) continue;
    const prev = latest.get(e.session);
    if (!prev || Date.parse(e.time) >= Date.parse(prev.time)) latest.set(e.session, e);
  }
  const out = [];
  for (const e of latest.values()) {
    const checkout = text3(e, "checkout");
    if (!checkout) continue;
    const rawTtl = e.data.ttlSeconds;
    const ttlText = text3(e, "ttlSeconds");
    let ttl;
    if (rawTtl === void 0 || typeof rawTtl === "string" && !rawTtl.trim()) {
      ttl = DEFAULT_TTL_SECONDS;
    } else if (ttlText !== void 0 && /^\d+$/.test(ttlText)) {
      ttl = Number(ttlText);
    } else {
      ttl = null;
    }
    const worktree = text3(e, "worktree");
    const branch = text3(e, "branch");
    if (ttl === null) {
      out.push({
        id: e.id,
        session: e.session,
        checkout,
        claimedAt: e.time,
        malformedTtl: true,
        ...worktree === void 0 ? {} : { worktree },
        ...branch === void 0 ? {} : { branch }
      });
      continue;
    }
    const expiresMs = Date.parse(e.time) + ttl * 1e3;
    if (nowMs > expiresMs) continue;
    out.push({
      id: e.id,
      session: e.session,
      checkout,
      claimedAt: e.time,
      expiresAt: new Date(expiresMs).toISOString(),
      ...worktree === void 0 ? {} : { worktree },
      ...branch === void 0 ? {} : { branch }
    });
  }
  return out;
}

// src/digest.ts
var OBSERVATION_KIND_SET2 = new Set(OBSERVATION_KINDS);
var REVERSIBILITY_RANK = {
  "one-way": 0,
  hard: 1,
  moderate: 2,
  trivial: 3
};
function str(e, field) {
  const v = e.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function list(e, field) {
  const v = e.data[field];
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim().length > 0) : [];
}
function sanitizeLine(raw) {
  return raw.replace(/\s+/g, " ").trim().replace(/^[#>*`-]+\s*/, "");
}
function restsOnPriorsAlone(e) {
  const raw = e.data.influences;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.every((i) => i !== null && typeof i === "object" && i.type === "model_knowledge");
}
function rank(e, outcome) {
  return [
    outcome === "invalidated" ? 0 : 1,
    REVERSIBILITY_RANK[str(e, "reversibility") ?? ""] ?? 4,
    str(e, "blastRadius") ? 0 : 1,
    e.id
  ];
}
function renderDigest(events, options) {
  const level = options.level ?? "published";
  const { outcomes } = project(events);
  const entries = events.filter((e) => isEntry(e) && readableAt(e, level)).map((e) => ({ e, outcome: outcomes.get(e.id) ?? "unknown" })).sort((x, y) => {
    const a = rank(x.e, x.outcome), b = rank(y.e, y.outcome);
    for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
    return a[3].localeCompare(b[3]);
  });
  const out = [
    `# Decision digest`,
    "",
    `As of ${options.now}. Rendered at disclosure level \`${level}\`.`,
    "This is a rendered artifact, never the source of truth.",
    ""
  ];
  if (entries.length === 0) {
    out.push("_No entries at this disclosure level._", "");
  }
  for (const { e, outcome } of entries) {
    const invalidatesTarget = str(e, "invalidates");
    const supersedesTarget = str(e, "supersedes");
    const retractionTitle = invalidatesTarget ? `Retraction of ${invalidatesTarget}` : supersedesTarget ? `Supersession of ${supersedesTarget}` : void 0;
    const title = sanitizeLine(str(e, "question") ?? str(e, "statement") ?? str(e, "claim") ?? retractionTitle ?? e.id);
    out.push(`## ${title}`, "");
    out.push(`- **id** \`${e.id}\` \xB7 **kind** ${e.kind} \xB7 **outcome** ${outcome}`);
    if (invalidatesTarget) out.push(`- **invalidates** \`${invalidatesTarget}\``);
    if (supersedesTarget) out.push(`- **supersedes** \`${supersedesTarget}\``);
    const chosen = str(e, "chosen");
    if (chosen) out.push(`- **chosen** ${sanitizeLine(chosen)}`);
    const rev = str(e, "reversibility");
    if (rev) out.push(`- **reversibility** ${sanitizeLine(rev)}`);
    const blast = str(e, "blastRadius");
    if (blast) out.push(`- **blast radius** ${sanitizeLine(blast)}`);
    const rationale = str(e, "rationale");
    if (rationale) out.push(`- **why** ${sanitizeLine(rationale)}`);
    const rejected = list(e, "rejected");
    if (rejected.length > 0) {
      out.push("", "**Rejected:**");
      for (const r of rejected) out.push(`- ${sanitizeLine(r)}`);
    }
    if (restsOnPriorsAlone(e)) {
      out.push("", "> **No source consulted** \u2014 this rested on `model_knowledge` alone.");
    }
    out.push("");
  }
  const unclassified = events.filter(
    (e) => !isEntry(e) && !OBSERVATION_KIND_SET2.has(e.kind)
  ).length;
  const c = options.coverage;
  out.push(
    "---",
    "",
    "## Coverage",
    "",
    `- sessions observed: ${c.sessions}`,
    `- sessions that recorded nothing: ${c.sessionsWithNoEntries.length}`,
    `- sessions with no events at all: ${c.sessionsWithNoEvents === null ? "not assessed" : c.sessionsWithNoEvents.length}`,
    `- refused writes (voids): ${c.voids}`,
    `- sequence gaps: ${c.sequenceGaps.length}`,
    `- downgraded anchors: ${c.downgradedAnchors === null ? "not assessed" : c.downgradedAnchors.length}`,
    `- entries of an unrecognised kind, kept but not displayed: ${unclassified}`,
    "",
    "`not assessed` is not `none` \u2014 it means nothing computed the figure.",
    ""
  );
  return out.join("\n");
}

// src/trace.ts
function refs(e, field) {
  const raw = e.data[field];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const ref = item.ref;
      if (typeof ref === "string" && ref.trim()) out.push(ref.trim());
    }
  }
  return out;
}
function journalRefs(e) {
  const raw = e.data.influences;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const rec = item;
      if (rec.type === "journal" && typeof rec.ref === "string" && rec.ref.trim()) {
        out.push(rec.ref.trim());
      }
    }
  }
  return out;
}
function edge(e, field) {
  const v = e.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function indexEntries(events) {
  const ix = /* @__PURE__ */ new Map();
  const add = (key, id) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    const seen = ix.get(k);
    if (seen) {
      if (!seen.includes(id)) seen.push(id);
    } else ix.set(k, [id]);
  };
  for (const e of events) {
    if (e.kind === "void") continue;
    add(e.id, e.id);
    if (e.subject) add(e.subject, e.id);
    for (const r of refs(e, "anchors")) add(r, e.id);
    for (const r of refs(e, "influences")) add(r, e.id);
  }
  return ix;
}
function matchSource(e, key) {
  if (e.id.trim().toLowerCase() === key) return "id";
  if (e.subject && e.subject.trim().toLowerCase() === key) return "subject";
  if (refs(e, "anchors").some((r) => r.toLowerCase() === key)) return "anchor";
  if (refs(e, "influences").some((r) => r.toLowerCase() === key)) return "influence";
  return null;
}
function traceFrom(events, key) {
  const ix = indexEntries(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const k = key.trim().toLowerCase();
  const matched = [];
  for (const id of ix.get(k) ?? []) {
    const e = byId.get(id);
    if (!e) continue;
    const via = matchSource(e, k);
    if (via) matched.push({ id, via });
  }
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  const queue = matched.map((m) => ({ id: m.id, via: null }));
  while (queue.length > 0) {
    const step = queue.shift();
    if (seen.has(step.id)) continue;
    const e = byId.get(step.id);
    if (!e) continue;
    seen.add(step.id);
    chain.push(step);
    for (const ref of journalRefs(e)) queue.push({ id: ref, via: "influences" });
    const sup = edge(e, "supersedes");
    if (sup) queue.push({ id: sup, via: "supersedes" });
    const inv = edge(e, "invalidates");
    if (inv) queue.push({ id: inv, via: "invalidates" });
  }
  return { matched, chain };
}

// src/paths.ts
import { basename, dirname, isAbsolute, join as join2, resolve } from "node:path";
import { lstat, readlink, realpath } from "node:fs/promises";
async function realParentDir(dirPath) {
  let current = resolve(dirPath);
  const tail = [];
  for (; ; ) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join2(real, ...tail);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) return join2(current, ...tail);
      tail.unshift(basename(current));
      current = parent;
    }
  }
}
async function canonicalize(p, depth = 0) {
  if (depth > 40) {
    throw Object.assign(new Error(`too many levels of symbolic links: ${p}`), { code: "ELOOP" });
  }
  const abs = resolve(p);
  const parentReal = await realParentDir(dirname(abs));
  const candidate = join2(parentReal, basename(abs));
  let stat3;
  try {
    stat3 = await lstat(candidate);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return candidate;
  }
  if (!stat3.isSymbolicLink()) return candidate;
  const target = await readlink(candidate);
  const resolvedTarget = isAbsolute(target) ? target : join2(dirname(candidate), target);
  return canonicalize(resolvedTarget, depth + 1);
}

// src/decay.ts
var OBSERVATION_KIND_SET3 = new Set(OBSERVATION_KINDS);
function stringField3(event, field) {
  const v = event.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function extractInfluences(event) {
  const raw = event.data.influences;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item;
    if (typeof rec.type !== "string" || !INFLUENCE_TYPES.includes(rec.type)) continue;
    const ref = typeof rec.ref === "string" && rec.ref !== "" ? rec.ref : null;
    out.push({ type: rec.type, ref });
  }
  return out;
}
function extractEnvironmentAnchors(event) {
  const raw = event.data.anchors;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item;
    if (rec.type !== "environment") continue;
    const ref = typeof rec.ref === "string" && rec.ref !== "" ? rec.ref : null;
    out.push({ ref });
  }
  return out;
}
function directlyInvalidatedIds(events) {
  const out = /* @__PURE__ */ new Set();
  for (const e of events) {
    const inv = stringField3(e, "invalidates");
    if (inv) out.add(inv);
  }
  return out;
}
function checkJournal(ref, ctx) {
  if (ref === null) return { status: "failing", detail: "journal influence has no ref to check" };
  const target = ctx.byId.get(ref);
  if (!target) {
    return { status: "failing", detail: `cited entry "${ref}" is not present in this journal` };
  }
  if (target.kind === "void") {
    return { status: "failing", detail: `"${ref}" is a void \u2014 the record of a refused write, not a source` };
  }
  if (!isEntry(target)) {
    return {
      status: "failing",
      detail: `"${ref}" is a ${target.kind} observation, not an entry \u2014 cite it as tool_result`
    };
  }
  if (ctx.invalidated.has(ref)) {
    return { status: "failing", detail: `cited entry "${ref}" was invalidated` };
  }
  if (ctx.superseded.has(ref)) {
    return { status: "failing", detail: `cited entry "${ref}" was superseded` };
  }
  return { status: "passing", detail: `cited entry "${ref}" is live` };
}
function checkToolResult(ref, ctx) {
  if (ref === null) return { status: "failing", detail: "tool_result influence has no ref to check" };
  const target = ctx.byId.get(ref);
  if (!target) {
    return { status: "failing", detail: `cited observation "${ref}" is not present in this journal` };
  }
  if (target.kind === "void") {
    return { status: "failing", detail: `"${ref}" is a void \u2014 the record of a refused write, not a result` };
  }
  if (!OBSERVATION_KIND_SET3.has(target.kind)) {
    return {
      status: "failing",
      detail: `"${ref}" is a ${target.kind} entry, not an observation \u2014 cite it as journal`
    };
  }
  return { status: "passing", detail: `cited observation "${ref}" is present` };
}
function checkCodebase(ref, ctx) {
  if (!ctx.codebase) {
    return { status: "not-checkable", detail: "no codebase index was provided for this run" };
  }
  if (ref === null) return { status: "failing", detail: "codebase influence has no ref to check" };
  const present = ctx.codebase.get(ref);
  if (present === void 0) {
    return { status: "not-checkable", detail: `"${ref}" was not covered by the codebase index provided` };
  }
  return present ? { status: "passing", detail: `"${ref}" is present in the codebase` } : { status: "failing", detail: `"${ref}" is no longer present in the codebase` };
}
function checkEnvironmentAnchor(ref, ctx) {
  if (ref === null) return { status: "failing", detail: "environment anchor has no ref to check" };
  const obs = ctx.environmentObservations.get(ref);
  if (!obs) {
    return { status: "failing", detail: `referenced environment observation "${ref}" is not present in this journal` };
  }
  if (!ctx.now) {
    return { status: "not-checkable", detail: "no current environment was supplied for this run" };
  }
  const recordedInterpreter = stringField3(obs, "interpreter");
  const recordedVersion = stringField3(obs, "version");
  if (!recordedInterpreter || !recordedVersion) {
    return {
      status: "not-checkable",
      detail: `environment observation "${ref}" has no recorded interpreter/version to compare`
    };
  }
  if (recordedInterpreter === ctx.now.interpreter && recordedVersion === ctx.now.version) {
    return { status: "passing", detail: `environment matches: ${recordedInterpreter}@${recordedVersion}` };
  }
  return {
    status: "drifted",
    detail: `environment drifted: recorded ${recordedInterpreter}@${recordedVersion}, now ${ctx.now.interpreter}@${ctx.now.version}`
  };
}
function assertNever(x) {
  throw new TypeError(`decay: unhandled influence type ${JSON.stringify(x)}`);
}
function classify(inf, ctx) {
  const { type, ref } = inf;
  switch (type) {
    case "person":
      return { status: "not-checkable", detail: "a person cannot be re-verified by this tool" };
    case "model_knowledge":
      return { status: "not-checkable", detail: "a model's own knowledge cannot be re-verified by this tool" };
    case "conversation":
      return { status: "not-checkable", detail: "a conversation transcript cannot be re-verified by this tool" };
    case "url":
      return { status: "not-implemented", detail: "url decay checking is not implemented in this release" };
    case "ticket":
      return { status: "not-implemented", detail: "ticket decay checking is not implemented in this release" };
    case "document":
      return { status: "not-implemented", detail: "document decay checking is not implemented in this release" };
    case "journal":
      return checkJournal(ref, ctx);
    case "tool_result":
      return checkToolResult(ref, ctx);
    case "codebase":
      return checkCodebase(ref, ctx);
    default:
      return assertNever(type);
  }
}
function computeDecay(events, options = {}) {
  const proj = project(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const directInvalidated = directlyInvalidatedIds(events);
  const environmentObservations = /* @__PURE__ */ new Map();
  for (const e of events) {
    if (e.kind === "environment") environmentObservations.set(e.id, e);
  }
  const ctx = {
    byId,
    invalidated: proj.invalidated,
    superseded: proj.superseded,
    codebase: options.codebase,
    environmentObservations,
    now: options.now
  };
  const findings = [];
  for (const event of events) {
    if (proj.superseded.has(event.id) || directInvalidated.has(event.id)) continue;
    for (const inf of extractInfluences(event)) {
      const { status, detail } = classify(inf, ctx);
      findings.push({ entryId: event.id, type: inf.type, ref: inf.ref, status, detail });
    }
    for (const anchor of extractEnvironmentAnchors(event)) {
      const { status, detail } = checkEnvironmentAnchor(anchor.ref, ctx);
      findings.push({ entryId: event.id, type: "environment", ref: anchor.ref, status, detail });
    }
  }
  let checked = 0;
  let notCheckable = 0;
  let notImplemented = 0;
  let drifted = 0;
  for (const f of findings) {
    switch (f.status) {
      case "passing":
      case "failing":
        checked++;
        break;
      case "not-checkable":
        notCheckable++;
        break;
      case "not-implemented":
        notImplemented++;
        break;
      case "drifted":
        drifted++;
        break;
      default:
        assertNever(f.status);
    }
  }
  return { findings, checked, notCheckable, notImplemented, drifted };
}
function codebaseRefs(events) {
  const refs2 = /* @__PURE__ */ new Set();
  for (const event of events) {
    for (const inf of extractInfluences(event)) {
      if (inf.type === "codebase" && inf.ref !== null) refs2.add(inf.ref);
    }
  }
  return [...refs2];
}

// src/codebase.ts
import { readFile, lstat as lstat2 } from "node:fs/promises";
import { isAbsolute as isAbsolute2, join as join3, sep } from "node:path";
async function readVettedFile(path) {
  try {
    const stat3 = await lstat2(path);
    if (!stat3.isFile()) return void 0;
    return await readFile(path, "utf8");
  } catch {
    return void 0;
  }
}
function splitRef(ref) {
  const idx = ref.indexOf(":");
  return idx === -1 ? { path: ref, symbol: void 0 } : { path: ref.slice(0, idx), symbol: ref.slice(idx + 1) };
}
async function resolveCodebaseRefs(refs2, repoRoot) {
  const result2 = /* @__PURE__ */ new Map();
  const repoRootReal = await canonicalize(repoRoot);
  const fileCache = /* @__PURE__ */ new Map();
  for (const ref of refs2) {
    const { path, symbol } = splitRef(ref);
    const joined = isAbsolute2(path) ? path : join3(repoRoot, path);
    let candidateReal;
    try {
      candidateReal = await canonicalize(joined);
    } catch {
      continue;
    }
    const inside = candidateReal === repoRootReal || candidateReal.startsWith(repoRootReal + sep);
    if (!inside) continue;
    let text4;
    if (fileCache.has(candidateReal)) {
      text4 = fileCache.get(candidateReal);
    } else {
      text4 = await readVettedFile(candidateReal);
      fileCache.set(candidateReal, text4);
    }
    result2.set(
      ref,
      symbol === void 0 ? text4 !== void 0 : text4 !== void 0 && text4.includes(symbol)
    );
  }
  return result2;
}

// src/consequence.ts
function stringField4(event, field) {
  const v = event.data[field];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
var MUTATION_PATTERNS = [
  // Cloudflare Workers/Pages secrets.
  {
    pattern: /\bwrangler\s+(?:pages\s+)?secret\s+(?:put|delete|bulk)\b/i,
    detail: "wrangler secret put/delete/bulk changes a deployed Worker or Pages secret"
  },
  // Cloudflare KV — a live namespace's key/value data, put or delete only.
  {
    pattern: /\bwrangler\s+kv[:\s]+key\s+(?:put|delete)\b/i,
    detail: "wrangler kv key put/delete changes a live KV namespace"
  },
  // GitHub Actions variables and secrets.
  {
    pattern: /\bgh\s+variable\s+(?:set|delete)\b/i,
    detail: "gh variable set/delete changes a repository or environment variable"
  },
  {
    pattern: /\bgh\s+secret\s+(?:set|delete)\b/i,
    detail: "gh secret set/delete changes a repository or environment secret"
  },
  // Kubernetes — the object-mutating `set` subcommands, and explicit
  // secret/configmap deletion. Bare `kubectl apply`/`delete`/`create` are
  // deliberately absent: they operate on arbitrary manifests, many of them
  // local test resources, and would fire on ordinary development work.
  {
    pattern: /\bkubectl\s+set\s+(?:env|image|resources|serviceaccount|selector)\b/i,
    detail: "kubectl set changes a live object\u2019s env, image, or resources"
  },
  {
    pattern: /\bkubectl\s+delete\s+(?:secret|configmap)\b/i,
    detail: "kubectl delete secret/configmap removes a live cluster secret or config"
  },
  // AWS SSM Parameter Store and Secrets Manager.
  {
    pattern: /\baws\s+ssm\s+(?:put-parameter|delete-parameter)\b/i,
    detail: "aws ssm put-parameter/delete-parameter changes a stored parameter"
  },
  {
    pattern: /\baws\s+secretsmanager\s+(?:put-secret-value|update-secret|create-secret|delete-secret)\b/i,
    detail: "aws secretsmanager changes or removes a stored secret"
  },
  // Azure Key Vault, Google Secret Manager.
  {
    pattern: /\baz\s+keyvault\s+secret\s+(?:set|delete|purge)\b/i,
    detail: "az keyvault secret set/delete/purge changes a stored secret"
  },
  {
    pattern: /\bgcloud\s+secrets\s+(?:create|delete)\b/i,
    detail: "gcloud secrets create/delete changes a stored secret"
  },
  {
    pattern: /\bgcloud\s+secrets\s+versions\s+(?:add|destroy|disable)\b/i,
    detail: "gcloud secrets versions add/destroy/disable changes a secret version"
  },
  // Platform config/env stores.
  {
    pattern: /\bheroku\s+config:(?:set|unset)\b/i,
    detail: "heroku config:set/unset changes a deployed app\u2019s environment"
  },
  {
    pattern: /\bvercel\s+env\s+(?:add|rm|remove)\b/i,
    detail: "vercel env add/rm changes a deployed project\u2019s environment"
  },
  {
    pattern: /\bfly(?:ctl)?\s+secrets\s+(?:set|unset|import)\b/i,
    detail: "fly secrets set/unset/import changes a deployed app\u2019s secrets"
  },
  {
    pattern: /\bdoppler\s+secrets\s+(?:set|delete)\b/i,
    detail: "doppler secrets set/delete changes a stored secret"
  },
  // Registry auth tokens, and Docker Swarm secrets.
  {
    pattern: /\b(?:npm|pnpm)\s+config\s+set\b/i,
    detail: "npm/pnpm config set changes registry configuration, including auth tokens"
  },
  {
    pattern: /\bdocker\s+secret\s+(?:create|rm|remove)\b/i,
    detail: "docker secret create/rm changes a live swarm secret"
  },
  // Infrastructure changes. `terraform apply`/`destroy` are distinct verbs
  // from the read-only `terraform plan`, unlike the flag-gated tools above.
  {
    pattern: /\bterraform\s+(?:apply|destroy)\b/i,
    detail: "terraform apply/destroy changes provisioned infrastructure"
  }
];
var PREVIEW_FLAGS = /(?:^|\s)(?:--dry-run(?:[=\s]\S+)?|--diff|--plan|--what-if|--no-execute)(?=\s|$)/i;
var TEXT_HEADED = /* @__PURE__ */ new Set([
  "grep",
  "rg",
  "ag",
  "ack",
  "echo",
  "printf",
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "man",
  "history",
  "sed",
  "awk",
  "diff",
  "comm",
  "sort",
  "uniq",
  "wc"
]);
var TEXT_HEADED_PAIRS = /* @__PURE__ */ new Set(["git commit", "git log", "git tag", "git stash"]);
function splitCommands(input) {
  const out = [];
  let current = "";
  let quote;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = void 0;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "|" || ch === "&" && input[i + 1] === "&") {
      if (ch === "&") i += 1;
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim()).filter(Boolean);
}
function withoutComment(command) {
  let quote;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = void 0;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(command[i - 1]))) return command.slice(0, i);
  }
  return command;
}
function withoutHeredocBodies(input) {
  return input.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, " ").replace(/<<-?\s*(['"]?)[A-Za-z_][A-Za-z0-9_]*\1[\s\S]*/, " ");
}
function commandHead(command) {
  const words = command.split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const first = (words[0] === "sudo" ? words[1] : words[0]) ?? "";
  const second = (words[0] === "sudo" ? words[2] : words[1]) ?? "";
  const head = first.replace(/^.*\//, "").toLowerCase();
  return { head, pair: `${head} ${second.toLowerCase()}`.trim() };
}
function unquote(command) {
  return command.replace(/['"]/g, "");
}
function matchMutation(input) {
  for (const raw of splitCommands(withoutHeredocBodies(input))) {
    const command = withoutComment(raw);
    if (!command.trim()) continue;
    if (PREVIEW_FLAGS.test(command)) continue;
    const { head, pair } = commandHead(command);
    if (TEXT_HEADED.has(head) || TEXT_HEADED_PAIRS.has(pair)) continue;
    const runnable = unquote(command);
    for (const { pattern, detail } of MUTATION_PATTERNS) {
      if (pattern.test(runnable)) return detail;
    }
  }
  return void 0;
}
var URL_LITERAL = /https?:\/\/[^\s'"<>]+/;
function hostNamedIn(input) {
  const found = URL_LITERAL.exec(input);
  if (!found) return void 0;
  try {
    return new URL(found[0]).hostname.toLowerCase();
  } catch {
    return void 0;
  }
}
var OBSERVATION_KIND_SET4 = new Set(OBSERVATION_KINDS);
function tryPermission(event) {
  if (event.kind !== "permission") return void 0;
  const decision = stringField4(event, "decision");
  if (decision === void 0) return void 0;
  const tool = stringField4(event, "tool");
  return {
    observationId: event.id,
    rule: "permission",
    detail: tool ? `permission ${decision} for ${tool}` : `permission ${decision}`
  };
}
var SHELL_TOOLS = /* @__PURE__ */ new Set(["bash", "sh", "shell", "zsh", "run_command", "terminal"]);
function commandLineOf(event) {
  const tool = stringField4(event, "tool");
  if (tool === void 0 || !SHELL_TOOLS.has(tool.toLowerCase())) return void 0;
  const input = stringField4(event, "input");
  if (input === void 0) return void 0;
  if (input.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      return input;
    }
    const command = parsed?.command;
    if (typeof command === "string") return command.trim() || void 0;
    if (Array.isArray(command)) {
      const joined = command.filter((w) => typeof w === "string").join(" ").trim();
      return joined || void 0;
    }
    return void 0;
  }
  return input;
}
function tryMutation(event) {
  if (event.kind !== "tool_call") return void 0;
  const input = commandLineOf(event);
  if (input === void 0) return void 0;
  const detail = matchMutation(input);
  if (detail === void 0) return void 0;
  return { observationId: event.id, rule: "mutation", detail };
}
function tryUnfamiliarApi(event, seen) {
  if (event.kind !== "tool_call") return void 0;
  const input = commandLineOf(event);
  if (input === void 0) return void 0;
  const host = hostNamedIn(input);
  if (host === void 0) return void 0;
  const isUnfamiliar = !seen.has(host);
  seen.add(host);
  if (!isUnfamiliar) return void 0;
  return {
    observationId: event.id,
    rule: "unfamiliar-api",
    detail: `first appearance of host ${host} in this journal`
  };
}
function firstDefined(candidates) {
  for (const c of candidates) {
    if (c !== void 0) return c;
  }
  return void 0;
}
function consequencesIn(events, options = {}) {
  let sinceMs;
  if (options.since !== void 0) {
    sinceMs = Date.parse(options.since);
    if (Number.isNaN(sinceMs)) {
      throw new TypeError(`since must be a parseable timestamp, got ${JSON.stringify(options.since)}`);
    }
  }
  const chronological = [...events].sort((a, b) => {
    const byTime = Date.parse(a.time) - Date.parse(b.time);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  const seenHosts = /* @__PURE__ */ new Set();
  const out = [];
  for (const event of chronological) {
    if (!OBSERVATION_KIND_SET4.has(event.kind)) continue;
    const candidates = [tryPermission(event), tryMutation(event), tryUnfamiliarApi(event, seenHosts)];
    const chosen = firstDefined(candidates);
    if (chosen === void 0) continue;
    if (sinceMs !== void 0 && !(Date.parse(event.time) > sinceMs)) continue;
    out.push(chosen);
  }
  return out;
}

// src/floors.ts
function sinceFilter(events, since) {
  if (since === void 0) return events;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) {
    throw new TypeError(`since must be a parseable timestamp, got ${JSON.stringify(since)}`);
  }
  return events.filter((e) => Date.parse(e.time) > sinceMs);
}
function renderCompactionFloor(events, options = {}) {
  const relevant = sinceFilter(events, options.since);
  if (relevant.length === 0) return null;
  return [
    "Context is about to be compacted. Whatever is not written down before that happens does not",
    "survive it.",
    "",
    "Flush: is there a decision, a finding, a blocker, or a piece of progress from this session",
    "that you have not recorded yet? If so, write it now \u2014 in your own words, from what actually",
    "happened, not a summary of this message.",
    "",
    "Assumption sweep: separately from the above, what did you take on trust this session without",
    "ever checking it \u2014 about idempotency, about ordering, about the environment? Name each one",
    "you can think of and write it as an `assumption` entry with `checked: no`. This is not a",
    "confession of a mistake; it is a record of what stayed unverified, for whoever reads this",
    "journal next."
  ].join("\n");
}
var ANCHOR_FOR = {
  mutation: "runtime",
  permission: "tool_use",
  "unfamiliar-api": "tool_use",
  "constraint-match": "tool_use"
};
function renderConsequenceFloor(events, options) {
  const consequences = consequencesIn(
    events,
    options.since === void 0 ? {} : { since: options.since }
  );
  const subject = options.subject?.trim();
  const matchedConstraints = subject ? constraintsMatching([subject], liveConstraints(events, options.now)) : [];
  if (consequences.length === 0 && matchedConstraints.length === 0) return null;
  const lines = [
    "Plane A saw something here that nobody necessarily decided on purpose. That does not mean it",
    "needs an entry \u2014 most tool calls do not \u2014 but it's worth a moment's thought before moving on:",
    ""
  ];
  for (const c of consequences) {
    lines.push(`- ${c.rule}: ${c.detail} (observation ${c.observationId} \u2014 cite it as \`--anchor ${ANCHOR_FOR[c.rule]}:${c.observationId}\`)`);
  }
  for (const c of matchedConstraints) {
    lines.push(
      `- constraint-match: constraint ${c.id} (${c.enforcement}) says "${c.statement}" \u2014 its scope "${c.scope}" matches what you named ("${subject}")`
    );
  }
  lines.push(
    "",
    "If this genuinely has a consequence, write down what happened, why, and what you assumed was",
    "true when you did it. If on reflection it does not, that is a legitimate answer too \u2014 just",
    "make sure it was a real judgement, not a pass."
  );
  return lines.join("\n");
}

// src/cli.ts
function kindUsageLine(kind) {
  const flags2 = fieldsFor(kind).map((field) => {
    const allowed = ENUM_FIELDS[kind]?.[field];
    const flag = LIST_FIELDS.has(field) ? `[--${field}]\u2026` : `--${field}`;
    return allowed ? `${flag} ${allowed.join("|")}` : flag;
  });
  return `    ${kind}: ${flags2.join(" ")}`;
}
function observationUsageLine(kind) {
  const flags2 = fieldsForObservation(kind).map((field) => `--${field}`);
  return `    ${kind}: ${flags2.join(" ") || "(no fields)"}`;
}
var OBSERVABLE_KINDS = Object.keys(OBSERVATION_FIELDS).filter((k) => k !== "void");
var USAGE = [
  "usage:",
  "  agent-journal record --kind <kind> --workspace <id> [--id id] [--author agent|human]",
  "                       [--context c] [--supersedes id] [--invalidates id]",
  "                       [--anchor <class>:<ref>]\u2026 [--influence <type>:<role>[:<ref>]]\u2026",
  "                       [--disclosure private|team|published] [--subject s]",
  "                       ...plus the fields for <kind>:",
  ...Object.keys(KIND_FIELDS).map(kindUsageLine),
  "  agent-journal observe --kind <kind> --workspace <id> [--id id] [--context c] [--seq n]",
  "                        [--subject s]",
  "                        ...plus the fields for <kind>:",
  ...OBSERVABLE_KINDS.map(observationUsageLine),
  "    (environment self-populates from the running process; an explicit flag wins)",
  "  agent-journal invalidate <entry-id> --reason <why> --workspace <id> [--disclosure private|team|published]",
  "  agent-journal tombstone <target-id> --reason <why> --workspace <id>",
  "    (records that the target must not exist; purges nothing \u2014 see `compact`)",
  "  agent-journal compact --workspace <id> [--entry-ttl-days <n>] [--observation-ttl-days <n>] [--apply]",
  "    (the only command that destroys data; a dry run unless --apply is given;",
  "     refuses outright on a damaged journal; never removes a tombstone event itself)",
  "  agent-journal coverage --workspace <id>",
  "  agent-journal show --workspace <id> [--id <entry-id>]",
  "  agent-journal claims --workspace <id>  (advisory only \u2014 reports, never blocks)",
  "  agent-journal digest --workspace <id> [--level private|team|published] [--out <path>]",
  "  agent-journal trace <key> --workspace <id>",
  "  agent-journal decay --workspace <id> [--repo <path>]",
  "    (--repo is required before any codebase influence is resolved; omitted, those",
  "     findings are not-checkable rather than guessed at)",
  "  agent-journal floor --kind compaction|consequence --workspace <id> [--since <ts>] [--subject <s>]",
  "    (prints a prompt asking the agent to write an entry, or nothing if there is nothing to say;",
  "     never a pre-written entry. --subject is only read by --kind consequence, to check it",
  "     against live constraints)",
  "  agent-journal help",
  ""
].join("\n");
function flags(argv) {
  const opts = /* @__PURE__ */ new Map();
  const all = /* @__PURE__ */ new Map();
  const valueless = [];
  const explicitEmpty = [];
  const take = (name, value) => {
    opts.set(name, value);
    all.set(name, [...all.get(name) ?? [], value]);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      const name2 = body.slice(0, eq);
      const value = body.slice(eq + 1);
      if (value === "") explicitEmpty.push(name2);
      else take(name2, value);
      continue;
    }
    const name = body;
    const next = argv[i + 1];
    if (next !== void 0 && !next.startsWith("--")) {
      take(name, next);
      i += 1;
    } else {
      valueless.push(name);
    }
  }
  return { opts, all, valueless, explicitEmpty };
}
var RECORD_GLOBAL = [
  "workspace",
  "kind",
  "id",
  "author",
  "context",
  "supersedes",
  "invalidates",
  "anchor",
  "influence",
  "disclosure",
  "subject"
];
var RECORD_GLOBAL_SET = new Set(RECORD_GLOBAL);
var OBSERVATION_GLOBAL = ["workspace", "kind", "id", "context", "seq", "subject"];
var ENTRY_KINDS_SET = new Set(Object.keys(KIND_FIELDS));
var ALLOWED_FLAGS = {
  record: [...RECORD_GLOBAL, ...Object.values(KIND_FIELDS).flat()],
  observe: [...OBSERVATION_GLOBAL, ...Object.values(OBSERVATION_FIELDS).flat()],
  invalidate: ["workspace", "reason", "disclosure"],
  coverage: ["workspace"],
  show: ["workspace", "id"],
  claims: ["workspace"],
  digest: ["workspace", "level", "out"],
  trace: ["workspace"],
  // `unknownFlags()` returns `[]` for any command with no entry here at all --
  // this registration is what makes flag checking exist for `decay` in the
  // first place, not merely what shapes it.
  decay: ["workspace", "repo"],
  tombstone: ["workspace", "reason"],
  compact: ["workspace", "apply", "entry-ttl-days", "observation-ttl-days"],
  floor: ["workspace", "kind", "since", "subject"]
};
function unknownFlags(command, opts) {
  const allowed = ALLOWED_FLAGS[command];
  if (!allowed) return [];
  const known = new Set(allowed);
  return [...opts.keys()].filter((k) => !known.has(k)).sort();
}
var BOOLEAN_FLAGS = {
  compact: ["apply"]
};
function nowStamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function journalFor(root, workspace, session, agent) {
  return new SegmentJournal({ root, workspace, machine: hostname(), session, agent, epoch: "e1" });
}
async function readAll(root, workspace) {
  const base = join4(root, "workspaces", workspace, "segments");
  const batches = [];
  const unreadable = [];
  const malformed = [];
  const benign = (error) => error.code === "ENOENT";
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (!benign(error)) unreadable.push(`${dir} (${error.code})`);
      return;
    }
    for (const e of entries) {
      const full = join4(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!e.name.endsWith(".jsonl")) continue;
      let text4;
      try {
        text4 = await readFile2(full, "utf8");
      } catch (error) {
        unreadable.push(`${full} (${error.code})`);
        continue;
      }
      const { events, bad } = parseSegment(text4);
      for (const d of bad) malformed.push(`${full}:${d.line} ${d.message}`);
      batches.push(events);
    }
  }
  await walk(base);
  return { events: mergeEvents(batches), unreadable, malformed };
}
var MAX_PURGE_ATTEMPTS = 3;
async function purgeOneSegment(full, purgeIds, flipTombstoneIds, forceSkip) {
  let lastSeen = [];
  for (let attempt = 0; attempt < MAX_PURGE_ATTEMPTS; attempt += 1) {
    if (forceSkip && full.includes(forceSkip)) {
      const { events: held } = parseSegment(await readFile2(full, "utf8"));
      return {
        outcome: "skipped",
        removed: [],
        unapplied: held.filter((e) => purgeIds.has(e.id) || flipTombstoneIds.has(e.id)).map((e) => e.id)
      };
    }
    const before = await stat2(full);
    const text4 = await readFile2(full, "utf8");
    let changed = false;
    const removed = [];
    const seen = [];
    lastSeen = seen;
    const lines = [];
    for (const raw of text4.split("\n")) {
      if (!raw.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        lines.push(raw);
        continue;
      }
      const id = typeof parsed.id === "string" ? parsed.id : void 0;
      if (id !== void 0 && purgeIds.has(id)) {
        changed = true;
        removed.push(id);
        seen.push(id);
        continue;
      }
      if (id !== void 0 && parsed.kind === TOMBSTONE_KIND && flipTombstoneIds.has(id)) {
        const data = parsed.data ?? {};
        lines.push(JSON.stringify({ ...parsed, data: { ...data, purged: true } }));
        changed = true;
        seen.push(id);
        continue;
      }
      lines.push(raw);
    }
    if (!changed) return { outcome: "unchanged", removed: [], unapplied: [] };
    const after = await stat2(full);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) continue;
    const tmp = `${full}.compact-${process.pid}-${Date.now()}.tmp`;
    let renamed = false;
    try {
      await writeFile(tmp, lines.length > 0 ? `${lines.join("\n")}
` : "", "utf8");
      const finalCheck = await stat2(full);
      if (finalCheck.size !== before.size || finalCheck.mtimeMs !== before.mtimeMs) continue;
      await rename(tmp, full);
      renamed = true;
    } finally {
      if (!renamed) await rm(tmp, { force: true });
    }
    return { outcome: "rewritten", removed, unapplied: [] };
  }
  return { outcome: "skipped", removed: [], unapplied: lastSeen };
}
async function purgeSegments(root, workspace, purgeIds, flipTombstoneIds, forceSkip) {
  const skipped = [];
  const removed = /* @__PURE__ */ new Set();
  const unapplied = /* @__PURE__ */ new Set();
  const base = join4(root, "workspaces", workspace, "segments");
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }
    for (const e of entries) {
      const full = join4(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!e.name.endsWith(".jsonl")) continue;
      const r = await purgeOneSegment(full, purgeIds, flipTombstoneIds, forceSkip);
      if (r.outcome === "skipped") skipped.push(full);
      for (const id of r.removed) removed.add(id);
      for (const id of r.unapplied) unapplied.add(id);
    }
  }
  await walk(base);
  return { skipped, removed, unapplied };
}
async function runCli(argv, env) {
  try {
    return await dispatch(argv, env);
  } catch (error) {
    const e = error;
    const message = String(e.message ?? error);
    const detail = e.code && !message.startsWith(`${e.code}:`) ? `${e.code}: ${message}` : message;
    return { code: 1, stdout: "", stderr: `could not complete: ${detail}
` };
  }
}
async function dispatch(argv, env) {
  const [command, ...rest] = argv;
  if (!command) return { code: 2, stdout: "", stderr: USAGE };
  if (command === "help" || command === "--help" || command === "-h") {
    return { code: 0, stdout: USAGE, stderr: "" };
  }
  const { opts, all, valueless, explicitEmpty } = flags(rest);
  const root = env.AGENT_JOURNAL_ROOT ?? join4(env.HOME ?? ".", ".agents", "journal");
  const declaredBoolean = new Set(BOOLEAN_FLAGS[command] ?? []);
  const genuinelyValueless = [
    ...valueless.filter((f) => !declaredBoolean.has(f)),
    ...explicitEmpty
  ];
  if (genuinelyValueless.length > 0) {
    const which = genuinelyValueless.map((f) => `--${f}`).join(", ");
    return {
      code: 2,
      stdout: "",
      stderr: `flag${genuinelyValueless.length > 1 ? "s" : ""} given no value: ${which}
${USAGE}`
    };
  }
  const unknown = unknownFlags(command, opts);
  if (unknown.length > 0) {
    return {
      code: 2,
      stdout: "",
      stderr: `unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.map((f) => `--${f}`).join(", ")}
${USAGE}`
    };
  }
  const workspace = opts.get("workspace");
  if (!workspace) return { code: 2, stdout: "", stderr: `--workspace is required
${USAGE}` };
  if (command === "record") {
    const kind = opts.get("kind");
    if (!kind) return { code: 2, stdout: "", stderr: `--kind is required
${USAGE}` };
    const kindKnown = Object.prototype.hasOwnProperty.call(KIND_FIELDS, kind);
    let kindWarning = "";
    if (kindKnown) {
      const allowedForKind = /* @__PURE__ */ new Set([...RECORD_GLOBAL, ...fieldsFor(kind)]);
      const wrongKind = [...opts.keys()].filter((k) => !allowedForKind.has(k)).sort();
      if (wrongKind.length > 0) {
        return {
          code: 2,
          stdout: "",
          stderr: `${wrongKind.map((f) => `--${f}`).join(", ")} ${wrongKind.length > 1 ? "are" : "is"} not a field of kind '${kind}'; it takes ${fieldsFor(kind).map((f) => `--${f}`).join(", ") || "no fields"}
`
        };
      }
    } else {
      const contentFlags = [...opts.keys()].filter((k) => !RECORD_GLOBAL_SET.has(k)).sort();
      if (contentFlags.length > 0) {
        return {
          code: 2,
          stdout: "",
          stderr: `kind ${JSON.stringify(kind)} is not one of the known kinds (${Object.keys(KIND_FIELDS).join(", ")}); refusing to write and silently discard ${contentFlags.map((f) => `--${f}`).join(", ")}
`
        };
      }
      kindWarning = `WARNING: kind ${JSON.stringify(kind)} is not one of the known kinds (${Object.keys(KIND_FIELDS).join(", ")}); no kind-specific fields will be stored
`;
    }
    const session = env.AGENT_JOURNAL_SESSION ?? "unknown";
    const agent = env.AGENT_JOURNAL_AGENT ?? "primary";
    const explicitId = opts.get("id");
    const id = explicitId ?? randomUUID();
    if (explicitId !== void 0) {
      const { events } = await readAll(root, workspace);
      if (events.some((e) => e.id === explicitId)) {
        return {
          code: 2,
          stdout: "",
          stderr: `an entry with id ${explicitId} already exists in this workspace; ids are unique and the existing entry was not modified
`
        };
      }
    }
    const declaredAuthor = opts.get("author");
    if (declaredAuthor !== void 0 && declaredAuthor !== "human" && declaredAuthor !== "agent") {
      return {
        code: 2,
        stdout: "",
        stderr: `--author must be 'agent' or 'human', got ${JSON.stringify(declaredAuthor)}
${USAGE}`
      };
    }
    const author = declaredAuthor === "human" ? "human" : "agent";
    const declaredDisclosure = opts.get("disclosure");
    if (declaredDisclosure !== void 0 && !DISCLOSURE_CLASSES.includes(declaredDisclosure)) {
      return {
        code: 2,
        stdout: "",
        stderr: `--disclosure must be one of ${DISCLOSURE_CLASSES.join(", ")}, got ${JSON.stringify(declaredDisclosure)}
`
      };
    }
    const rawSubject = opts.get("subject");
    const subject = rawSubject !== void 0 && rawSubject.trim() ? rawSubject.trim() : void 0;
    let anchors;
    let influences;
    try {
      anchors = (all.get("anchor") ?? []).map(parseAnchor);
      influences = (all.get("influence") ?? []).map(parseInfluence);
    } catch (error) {
      return { code: 2, stdout: "", stderr: `${error.message}
${USAGE}` };
    }
    let data;
    try {
      data = normalizeEntryData(kind, all);
    } catch (error) {
      return { code: 2, stdout: "", stderr: `${error.message}
` };
    }
    if (kind === "constraint" && !("statement" in data)) {
      return {
        code: 2,
        stdout: "",
        stderr: `--statement is required for --kind constraint; a constraint that states no obligation cannot be one
`
      };
    }
    const edges = [];
    for (const field of ["supersedes", "invalidates"]) {
      const raw = opts.get(field);
      const value = raw?.trim();
      if (value) {
        edges.push({ field, value });
        data[field] = value;
      }
    }
    const selfEdge = edges.find((e) => e.value === id);
    if (selfEdge) {
      return {
        code: 2,
        stdout: "",
        stderr: `--${selfEdge.field} names this entry's own id (${JSON.stringify(id)}); an entry cannot retract itself
`
      };
    }
    if (anchors.length > 0) data.anchors = anchors;
    if (influences.length > 0) data.influences = influences;
    const journalRefs2 = influences.filter((inf) => inf.type === "journal" && !!inf.ref).map((inf) => inf.ref);
    const referencedIds = [.../* @__PURE__ */ new Set([...edges.map((e) => e.value), ...journalRefs2])];
    let targetWarning = "";
    if (referencedIds.length > 0) {
      const { events: knownEvents } = await readAll(root, workspace);
      const knownIds = new Set(knownEvents.map((e) => e.id));
      targetWarning = referencedIds.filter((refId) => !knownIds.has(refId)).sort().map((refId) => `WARNING: no entry with id ${refId} is present in this workspace
`).join("");
    }
    const event = normalizeEvent({
      schemaVersion: 1,
      id,
      source: `cli/${hostname()}/${session}/${agent}`,
      sourceEpoch: "e1",
      time: nowStamp(),
      workspace,
      session,
      agent,
      author,
      provenance: "cli",
      harness: env.AGENT_JOURNAL_HARNESS ?? "other",
      context: opts.get("context") ?? "coding",
      capabilities: capabilitiesWithAnchors(normalizeCapabilities({}), anchors),
      kind,
      data,
      disclosure: declaredDisclosure ?? "team",
      ...subject === void 0 ? {} : { subject }
    });
    const journal = journalFor(root, workspace, session, agent);
    const result2 = await journal.append(event);
    if (!result2.written) {
      const trace = await journal.append(voidEvent({
        id: randomUUID(),
        source: event.source,
        sourceEpoch: event.sourceEpoch,
        time: nowStamp(),
        workspace,
        session,
        agent,
        harness: env.AGENT_JOURNAL_HARNESS ?? "other",
        reason: `redaction ${result2.verdict}`,
        provenance: "cli",
        author,
        ...result2.reason === void 0 ? {} : { detail: result2.reason }
      }));
      return {
        code: 1,
        stdout: "",
        stderr: `refused: redaction ${result2.verdict} \u2014 ${result2.reason ?? "no detail"}
` + (trace.written ? "" : "WARNING: the refusal itself could not be recorded\n")
      };
    }
    return { code: 0, stdout: `recorded ${id}
`, stderr: kindWarning + targetWarning };
  }
  if (command === "observe") {
    const kind = opts.get("kind");
    if (!kind) return { code: 2, stdout: "", stderr: `--kind is required
${USAGE}` };
    if (kind === "void") {
      return {
        code: 2,
        stdout: "",
        stderr: "void observations are written by the refusal path itself, never by a caller\n"
      };
    }
    if (ENTRY_KINDS_SET.has(kind)) {
      return {
        code: 2,
        stdout: "",
        stderr: `${kind} is an entry kind \u2014 use \`agent-journal record\`
`
      };
    }
    if (!OBSERVATION_KINDS.includes(kind)) {
      return {
        code: 2,
        stdout: "",
        // OBSERVABLE_KINDS, not OBSERVATION_KINDS: `void` is refused ten lines
        // above, so offering it here sends the caller straight back into that
        // refusal. USAGE already got this right.
        stderr: `${JSON.stringify(kind)} is not an observation kind; one of ${OBSERVABLE_KINDS.join(", ")}
`
      };
    }
    const allowedForKind = /* @__PURE__ */ new Set([...OBSERVATION_GLOBAL, ...fieldsForObservation(kind)]);
    const wrong = [...opts.keys()].filter((k) => !allowedForKind.has(k)).sort();
    if (wrong.length > 0) {
      return {
        code: 2,
        stdout: "",
        stderr: `${wrong.map((f) => `--${f}`).join(", ")} ${wrong.length > 1 ? "are" : "is"} not a field of observation '${kind}'
`
      };
    }
    let sequence;
    const rawSeq = opts.get("seq");
    if (rawSeq !== void 0) {
      if (!/^\d+$/.test(rawSeq)) {
        return {
          code: 2,
          stdout: "",
          stderr: `--seq must be a non-negative whole number, got ${JSON.stringify(rawSeq)}
`
        };
      }
      sequence = Number(rawSeq);
    }
    const rawSubject = opts.get("subject");
    const subject = rawSubject !== void 0 && rawSubject.trim() ? rawSubject.trim() : void 0;
    const session = env.AGENT_JOURNAL_SESSION ?? "unknown";
    const agent = env.AGENT_JOURNAL_AGENT ?? "primary";
    const event = normalizeEvent({
      schemaVersion: 1,
      id: opts.get("id") ?? randomUUID(),
      source: `hook/${hostname()}/${session}/${agent}`,
      sourceEpoch: "e1",
      ...sequence === void 0 ? {} : { sequence },
      time: nowStamp(),
      workspace,
      session,
      agent,
      // An observation is never authored by a human — that is what makes it
      // Plane A — and it takes the envelope's disclosure default rather than
      // a caller's stated intent: observations are machinery, not candour.
      author: "agent",
      provenance: "hook",
      harness: env.AGENT_JOURNAL_HARNESS ?? "other",
      context: opts.get("context") ?? "coding",
      kind,
      // `environment` self-populates from the process that is actually running
      // this CLI invocation. Explicit flags still win — spread order — so a
      // hook that knows better than the current process (a remote runner, a
      // container) can override what was captured here.
      data: kind === "environment" ? { ...captureEnvironment(), ...normalizeObservationData(kind, all) } : normalizeObservationData(kind, all),
      // What this observation is ABOUT — a tool name, an agent id — which is
      // what makes it findable by `trace` rather than only by a uuid nobody
      // has. Absent stays absent: an observation with nothing worth naming
      // carries no subject rather than a placeholder.
      ...subject === void 0 ? {} : { subject }
    });
    const journal = journalFor(root, workspace, session, agent);
    const result2 = await journal.append(event);
    if (!result2.written) {
      const trace = await journal.append(voidEvent({
        id: randomUUID(),
        source: event.source,
        sourceEpoch: event.sourceEpoch,
        time: nowStamp(),
        workspace,
        session,
        agent,
        harness: env.AGENT_JOURNAL_HARNESS ?? "other",
        reason: `redaction ${result2.verdict}`,
        provenance: "hook",
        author: "agent",
        ...result2.reason === void 0 ? {} : { detail: result2.reason }
      }));
      return {
        code: 1,
        stdout: "",
        stderr: `refused: redaction ${result2.verdict} \u2014 ${result2.reason ?? "no detail"}
` + (trace.written ? "" : "WARNING: the refusal itself could not be recorded\n")
      };
    }
    return { code: 0, stdout: `observed ${event.id}
`, stderr: "" };
  }
  if (command === "invalidate") {
    const target = rest[0];
    const reason = opts.get("reason");
    if (!target || target.startsWith("--")) {
      return { code: 2, stdout: "", stderr: `an entry id is required
${USAGE}` };
    }
    if (!reason) return { code: 2, stdout: "", stderr: `--reason is required
${USAGE}` };
    const declaredDisclosure = opts.get("disclosure");
    if (declaredDisclosure !== void 0 && !DISCLOSURE_CLASSES.includes(declaredDisclosure)) {
      return {
        code: 2,
        stdout: "",
        stderr: `--disclosure must be one of ${DISCLOSURE_CLASSES.join(", ")}, got ${JSON.stringify(declaredDisclosure)}
`
      };
    }
    const event = normalizeEvent({
      schemaVersion: 1,
      id: randomUUID(),
      source: `cli/${hostname()}/-/-`,
      sourceEpoch: "e1",
      time: nowStamp(),
      workspace,
      session: "-",
      agent: "-",
      author: "human",
      provenance: "cli",
      harness: "other",
      context: "coding",
      kind: "decision",
      data: { invalidates: target, rationale: reason },
      // The write-path default is `team`, per spec 13.3 — same distinction
      // record draws: an entry THIS CLI wrote is known to have meant the
      // default; only a foreign, unreadable record contains to `private`.
      disclosure: declaredDisclosure ?? "team"
    });
    const journal = journalFor(root, workspace, "-", "-");
    const result2 = await journal.append(event);
    if (!result2.written) {
      const trace = await journal.append(voidEvent({
        id: randomUUID(),
        source: event.source,
        sourceEpoch: event.sourceEpoch,
        time: nowStamp(),
        workspace,
        session: "-",
        agent: "-",
        harness: "other",
        reason: `redaction ${result2.verdict}`,
        provenance: "cli",
        author: "human",
        ...result2.reason === void 0 ? {} : { detail: result2.reason }
      }));
      return {
        code: 1,
        stdout: "",
        stderr: `refused: redaction ${result2.verdict}
` + (trace.written ? "" : "WARNING: the refusal itself could not be recorded\n")
      };
    }
    const known = (await readAll(root, workspace)).events.some((e) => e.id === target);
    return {
      code: 0,
      stdout: known ? `invalidated ${target}
` : `retraction recorded for ${target}; no matching entry in this workspace
`,
      stderr: known ? "" : `WARNING: no entry with id ${target} is present in this workspace
`
    };
  }
  if (command === "tombstone") {
    const target = rest[0];
    if (!target || target.startsWith("--")) {
      return { code: 2, stdout: "", stderr: `a target id is required
${USAGE}` };
    }
    const reason = opts.get("reason")?.trim();
    if (!reason) {
      return { code: 2, stdout: "", stderr: `--reason is required, and must be non-blank
${USAGE}` };
    }
    const event = normalizeEvent({
      schemaVersion: 1,
      id: randomUUID(),
      source: `cli/${hostname()}/-/-`,
      sourceEpoch: "e1",
      time: nowStamp(),
      workspace,
      session: "-",
      agent: "-",
      author: "human",
      provenance: "cli",
      harness: "other",
      context: "coding",
      kind: TOMBSTONE_KIND,
      data: { target, reason, purged: false }
    });
    const journal = journalFor(root, workspace, "-", "-");
    const result2 = await journal.append(event);
    if (!result2.written) {
      const trace = await journal.append(voidEvent({
        id: randomUUID(),
        source: event.source,
        sourceEpoch: event.sourceEpoch,
        time: nowStamp(),
        workspace,
        session: "-",
        agent: "-",
        harness: "other",
        reason: `redaction ${result2.verdict}`,
        provenance: "cli",
        author: "human",
        ...result2.reason === void 0 ? {} : { detail: result2.reason }
      }));
      return {
        code: 1,
        stdout: "",
        stderr: `refused: redaction ${result2.verdict}
` + (trace.written ? "" : "WARNING: the refusal itself could not be recorded\n")
      };
    }
    const known = (await readAll(root, workspace)).events.some((e) => e.id === target);
    return {
      code: 0,
      stdout: `tombstoned ${target}
`,
      stderr: known ? "" : `WARNING: no entry with id ${target} is present in this workspace
`
    };
  }
  if (command === "coverage") {
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const report = coverage(events);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    const out = { ...report, unreadable, malformed };
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify(out, null, 2)}
`,
      stderr: damaged ? `WARNING: this journal could not be fully read \u2014 ${unreadable.length} unreadable path(s), ${malformed.length} malformed line(s). The counts above are a floor, not a total.
` : ""
    };
  }
  if (command === "show") {
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const proj = project(events);
    const live = liveConstraints(events, nowStamp());
    const hidden = suppressedIds(events);
    const liveIds = new Set(proj.live.map((e) => e.id));
    const liveConstraintIds = new Set(live.map((c) => c.id));
    const wanted = opts.get("id");
    const retractionTarget = (raw) => typeof raw === "string" && raw.trim() ? raw.trim() : void 0;
    const entries = events.filter((e) => e.kind !== "void" && !hidden.has(e.id) && (wanted === void 0 || e.id === wanted)).map((e) => {
      const anchors = Array.isArray(e.data.anchors) ? e.data.anchors : null;
      const influences = Array.isArray(e.data.influences) ? e.data.influences : null;
      const invalidatesTarget = retractionTarget(e.data.invalidates);
      const supersedesTarget = retractionTarget(e.data.supersedes);
      const retracts = invalidatesTarget === void 0 && supersedesTarget === void 0 ? null : [
        ...invalidatesTarget === void 0 ? [] : [{ type: "invalidates", target: invalidatesTarget }],
        ...supersedesTarget === void 0 ? [] : [{ type: "supersedes", target: supersedesTarget }]
      ];
      return {
        id: e.id,
        kind: e.kind,
        time: e.time,
        author: e.author,
        // Which PLANE this came from, and the only field that says so. `author`
        // does not: `observe` writes `author: 'agent'` too, so a hook-captured
        // observation and an agent-authored entry are indistinguishable without
        // this. Verifying "did a hook actually fire" is exactly the question
        // adapters.md sends a reader to `show` to answer, and it could not be
        // answered from this payload.
        provenance: e.provenance,
        // What the event is about, and what it carries. Both were missing,
        // and their absence broke the citing loop the observation plane
        // exists for: id/kind/time/outcome/live renders two `tool_call`
        // observations identically, so `show` could not tell a reader WHICH
        // id to put in an `--anchor`. Only reading raw JSONL could, which
        // is not a documented command. `subject` is null — never '' — when
        // the event names none; `data` renders whatever the event actually
        // carries, which for an observation is its whole content.
        subject: e.subject ?? null,
        data: e.data,
        outcome: proj.outcomes.get(e.id) ?? "unknown",
        live: e.kind === "constraint" ? liveConstraintIds.has(e.id) : liveIds.has(e.id),
        // null, never []: an entry with no anchors has none recorded, which is
        // not the same claim as "assessed and found none".
        anchors,
        influences,
        retracts,
        constraintsBearingOn: constraintsBearingOn(e, live).map((c) => c.id)
      };
    });
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ entries, liveConstraints: live, unreadable, malformed }, null, 2)}
`,
      stderr: damaged ? "WARNING: this journal could not be fully read \u2014 the entries above are a floor, not a total.\n" : ""
    };
  }
  if (command === "claims") {
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const claims = liveClaims(events, nowStamp());
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ claims, advisory: true, unreadable, malformed }, null, 2)}
`,
      stderr: damaged ? "WARNING: this journal could not be fully read \u2014 the claims above are a floor.\n" : ""
    };
  }
  if (command === "digest") {
    const level = opts.get("level");
    if (level !== void 0 && !DISCLOSURE_CLASSES.includes(level)) {
      return {
        code: 2,
        stdout: "",
        stderr: `--level must be one of ${DISCLOSURE_CLASSES.join(", ")}, got ${JSON.stringify(level)}
`
      };
    }
    const out = opts.get("out");
    if (out && level === "private") {
      return {
        code: 2,
        stdout: "",
        stderr: "--out is refused with --level private; private entries are not written to a file (spec 13.3) \u2014 omit --out and read the digest from stdout for local inspection\n"
      };
    }
    let resolvedOut;
    if (out) {
      const workspacesRoot = await canonicalize(join4(root, "workspaces"));
      resolvedOut = await canonicalize(out);
      const rel = relative(workspacesRoot, resolvedOut);
      const insideWorkspaces = rel !== "" && rel !== ".." && !rel.startsWith(`..${sep2}`);
      const candidateWorkspaceId = insideWorkspaces ? rel.split(sep2)[0] : void 0;
      const hitSegmentsDir = candidateWorkspaceId === void 0 ? void 0 : join4(workspacesRoot, candidateWorkspaceId, "segments");
      if (hitSegmentsDir !== void 0 && (resolvedOut === hitSegmentsDir || resolvedOut.startsWith(hitSegmentsDir + sep2))) {
        return {
          code: 2,
          stdout: "",
          stderr: `--out must not write inside a workspace's own segment tree (${hitSegmentsDir}); a digest written there becomes journal input on the next read
`
        };
      }
    }
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    if (damaged) {
      return {
        code: 1,
        stdout: "",
        stderr: `refusing to render: ${unreadable.length} unreadable path(s), ${malformed.length} malformed line(s)
`
      };
    }
    const hidden = suppressedIds(events);
    const visible = events.filter((e) => !hidden.has(e.id));
    const rendered = renderDigest(visible, {
      coverage: coverage(events),
      now: nowStamp(),
      ...level === void 0 ? {} : { level }
    });
    if (out) {
      if (resolvedOut === void 0) {
        return { code: 1, stdout: "", stderr: "internal: --out was not vetted before write\n" };
      }
      await mkdir2(dirname2(resolvedOut), { recursive: true });
      await writeFile(resolvedOut, rendered, "utf8");
      return { code: 0, stdout: `wrote ${out}
`, stderr: "" };
    }
    return { code: 0, stdout: rendered, stderr: "" };
  }
  if (command === "trace") {
    const key = rest[0];
    if (!key || key.startsWith("--")) {
      return { code: 2, stdout: "", stderr: `a key is required: trace <key> --workspace <id>
` };
    }
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const hidden = suppressedIds(events);
    const visible = events.filter((e) => !hidden.has(e.id));
    const result2 = traceFrom(visible, key);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ ...result2, unreadable, malformed }, null, 2)}
`,
      stderr: damaged ? "WARNING: this journal could not be fully read \u2014 the result is a floor, not a total.\n" : result2.matched.length === 0 ? `no entry is indexed under ${JSON.stringify(key)} in this workspace
` : ""
    };
  }
  if (command === "decay") {
    const repo = opts.get("repo");
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const codebase = repo ? await resolveCodebaseRefs(codebaseRefs(events), repo) : void 0;
    const redactedNow = redact(captureEnvironment());
    const report = computeDecay(events, {
      ...codebase === void 0 ? {} : { codebase },
      ...redactedNow.verdict === "failed" ? {} : { now: redactedNow.value }
    });
    const damaged = unreadable.length > 0 || malformed.length > 0;
    return {
      code: damaged ? 1 : 0,
      stdout: `${JSON.stringify({ ...report, unreadable, malformed }, null, 2)}
`,
      stderr: damaged ? "WARNING: this journal could not be fully read \u2014 the findings above are a floor, not a total.\n" : ""
    };
  }
  if (command === "compact") {
    if (opts.has("apply")) {
      return {
        code: 2,
        stdout: "",
        stderr: `--apply takes no value; pass it as a bare flag
${USAGE}`
      };
    }
    const apply = valueless.includes("apply");
    const parseTtlDays = (flag) => {
      const raw = opts.get(flag);
      if (raw === void 0) return void 0;
      if (!/^\d+$/.test(raw)) {
        return { error: `--${flag} must be a non-negative whole number, got ${JSON.stringify(raw)}` };
      }
      return Number(raw);
    };
    const entryTtlDaysRaw = parseTtlDays("entry-ttl-days");
    if (entryTtlDaysRaw !== void 0 && typeof entryTtlDaysRaw === "object") {
      return { code: 2, stdout: "", stderr: `${entryTtlDaysRaw.error}
` };
    }
    const observationTtlDaysRaw = parseTtlDays("observation-ttl-days");
    if (observationTtlDaysRaw !== void 0 && typeof observationTtlDaysRaw === "object") {
      return { code: 2, stdout: "", stderr: `${observationTtlDaysRaw.error}
` };
    }
    const entryTtlDays = entryTtlDaysRaw;
    const observationTtlDays = observationTtlDaysRaw;
    const DAY_MS = 864e5;
    const NEVER_MS = Number.MAX_SAFE_INTEGER;
    const entryTtlMs = entryTtlDays === void 0 ? NEVER_MS : entryTtlDays * DAY_MS;
    const observationTtlMs = observationTtlDays === void 0 ? NEVER_MS : observationTtlDays * DAY_MS;
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    if (damaged) {
      return {
        code: 1,
        stdout: "",
        stderr: `refusing to compact: ${unreadable.length} unreadable path(s), ${malformed.length} malformed line(s) -- compacting a partial view could destroy content whose tombstone status was never seen
`
      };
    }
    const result2 = applyRetention(events, { now: nowStamp(), entryTtlMs, observationTtlMs });
    const byId = new Map(events.map((e) => [e.id, e]));
    const purgeIds = new Set(
      [...result2.expired, ...result2.tombstoned].filter((id) => byId.get(id)?.kind !== TOMBSTONE_KIND)
    );
    const tombstonesToFlip = tombstonesIn(events).filter((t) => purgeIds.has(t.target));
    const report = {
      apply,
      entryTtlDays: entryTtlDays ?? null,
      observationTtlDays: observationTtlDays ?? null,
      expired: result2.expired,
      tombstoned: result2.tombstoned,
      pinned: result2.pinned,
      downgraded: result2.downgraded,
      unclassified: result2.unclassified,
      // The ids of the TOMBSTONE EVENTS whose `purged` flag is (--apply) or
      // would be (dry run) flipped true -- not the ids of their targets.
      // Dry run: what WOULD be flipped. --apply: replaced below with what
      // actually was, since a skipped segment can leave a planned flip undone.
      tombstonesMarkedPurged: tombstonesToFlip.map((t) => t.id)
    };
    if (apply) {
      const forceSkip = env.AGENT_JOURNAL_FORCE_SKIP;
      const purgePass = await purgeSegments(root, workspace, purgeIds, /* @__PURE__ */ new Set(), forceSkip);
      const skippedPaths = purgePass.skipped;
      const actuallyFlipped = tombstonesActuallyPurged(
        tombstonesToFlip,
        purgePass.removed,
        purgePass.unapplied
      );
      let flipped = actuallyFlipped;
      if (actuallyFlipped.length > 0) {
        const flipPass = await purgeSegments(
          root,
          workspace,
          /* @__PURE__ */ new Set(),
          new Set(actuallyFlipped.map((t) => t.id)),
          forceSkip
        );
        for (const path of flipPass.skipped) {
          if (!skippedPaths.includes(path)) skippedPaths.push(path);
        }
        if (flipPass.unapplied.size > 0) {
          flipped = actuallyFlipped.filter((t) => !flipPass.unapplied.has(t.id));
        }
      }
      const truthfulReport = { ...report, tombstonesMarkedPurged: flipped.map((t) => t.id) };
      if (skippedPaths.length > 0) {
        return {
          code: 1,
          stdout: `${JSON.stringify({ ...truthfulReport, skipped: skippedPaths }, null, 2)}
`,
          stderr: `${skippedPaths.length} segment(s) were being written during compaction and were left untouched; re-run when writers are idle
`
        };
      }
      return { code: 0, stdout: `${JSON.stringify(truthfulReport, null, 2)}
`, stderr: "" };
    }
    return { code: 0, stdout: `${JSON.stringify(report, null, 2)}
`, stderr: "" };
  }
  if (command === "floor") {
    const kind = opts.get("kind");
    if (!kind) return { code: 2, stdout: "", stderr: `--kind is required
${USAGE}` };
    if (kind !== "compaction" && kind !== "consequence") {
      return {
        code: 2,
        stdout: "",
        stderr: `--kind must be 'compaction' or 'consequence', got ${JSON.stringify(kind)}
${USAGE}`
      };
    }
    const since = opts.get("since");
    if (since !== void 0 && Number.isNaN(Date.parse(since))) {
      return {
        code: 2,
        stdout: "",
        stderr: `--since must be a parseable timestamp, got ${JSON.stringify(since)}
${USAGE}`
      };
    }
    const rawSubject = opts.get("subject");
    const subject = rawSubject !== void 0 && rawSubject.trim() ? rawSubject.trim() : void 0;
    const { events, unreadable, malformed } = await readAll(root, workspace);
    const damaged = unreadable.length > 0 || malformed.length > 0;
    const rendered = kind === "compaction" ? renderCompactionFloor(events, since === void 0 ? {} : { since }) : renderConsequenceFloor(events, {
      now: nowStamp(),
      ...since === void 0 ? {} : { since },
      ...subject === void 0 ? {} : { subject }
    });
    return {
      code: damaged ? 1 : 0,
      stdout: rendered === null ? "" : `${rendered}
`,
      stderr: damaged ? "WARNING: this journal could not be fully read -- any prompt above is based on a partial read.\n" : ""
    };
  }
  return { code: 2, stdout: "", stderr: `unknown command: ${command}
${USAGE}` };
}

// src/bin.ts
var result = await runCli(process.argv.slice(2), process.env);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code;
