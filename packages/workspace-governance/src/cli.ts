#!/usr/bin/env node
import {
  GovernanceError,
  requireThat,
  resolvePolicy,
  visibleNodes,
} from "./core.ts";
import { FileSnapshotStore, loadSnapshot, readJsonFile } from "./stores.ts";
import { discoverLocal, discoverGithub } from "./discovery.ts";
import { createPlan, verifyPlan } from "./planner.ts";
import { createReport } from "./report.ts";
import { renderReportHtml } from "./report-html.ts";
import { diagnose, doctorExitCode, renderDoctorText } from "./doctor.ts";
import { runV2Cli } from "./v2-cli.ts";
const help = `workspacectl 0.2.0 — Workspaces M2/A05–A06 + M3/A07–A08 + M4/A09 + M5/A11–A12 + M6/A13–A15 + M7/A16 + M3/A17

Usage:
  workspacectl [help|--help]
  workspacectl [version|--version]
  workspacectl doctor [--standalone] [--config FILE] [--skill FILE] [--json]
  workspacectl init [--config FILE] --catalog FILE --state FILE --plans-dir DIR --trusted-root DIR --plan FILE [--json]
  workspacectl import-v1 [--config FILE] --manifest FILE --unclassified FILE --plan FILE [--json]
  workspacectl apply [--config FILE] --plan FILE --approve PLAN_ID [--json]
  workspacectl discover --config FILE [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
  workspacectl list [--config FILE] [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
  workspacectl report [--config FILE] [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
  workspacectl audit [--config FILE] [--source ID]... [--root PATH]... [--depth N] [--max-pages N] [--json]
  workspacectl where REPOSITORY [--config FILE] [--json]
  workspacectl context REPOSITORY [--workspace ID] [--project ID] [--workflow ID] [--load knowledge:ID|skill:ID]... [--approve-content TARGET=sha256:DIGEST]... [--budget-bytes N] [--source FILE] [--config FILE] [--json]
  workspacectl explain REPOSITORY [FIELD] [--workspace ID] [--project ID] [--workflow ID] [--load knowledge:ID|skill:ID]... [--approve-content TARGET=sha256:DIGEST]... [--budget-bytes N] [--source FILE] [--config FILE] [--json]
  workspacectl open TARGET [--host hermes|terminal|codex] [--activate] [--config FILE] [--json]
  workspacectl host acknowledge --action FILE --readback FILE [--json]
  workspacectl coordination create --group ID --path PATH --plan FILE [--config FILE] [--json]
  workspacectl coordination open --id ID [--config FILE] [--json]
  workspacectl workspace select-primary --repo ID --workspace ID [--config FILE] --plan FILE [--json]
  workspacectl adopt --repo ID --path PATH --plan FILE [--config FILE] [--json]
  workspacectl checkout --repo ID --path PATH [--ref branch:NAME|tag:NAME|commit:SHA] --plan FILE [--config FILE] [--json]
  workspacectl move WORKSPACE --to PATH --confirm-inactive --plan FILE [--config FILE] [--json]
  workspacectl worktree list --repo ID [--config FILE] [--json]
  workspacectl worktree create --repo ID --base COMMIT --branch NEW_BRANCH --path PATH --plan FILE [--config FILE] [--json]
  workspacectl worktree remove --workspace ID --confirm-inactive --plan FILE [--config FILE] [--json]
  workspacectl operation show ID [--config FILE] [--json]
  workspacectl operation reconcile ID --plan FILE [--config FILE] [--json]
  workspacectl workflow list --repo ID --workspace ID [--config FILE] [--json]
  workspacectl workflow show --repo ID --workspace ID --workflow ID [--config FILE] [--json]
  workspacectl workflow run --repo ID --workspace ID --workflow ID [--input KEY=VALUE]... [--config FILE] [--json]
  workspacectl workflow show --coordination ID --workflow ID [--config FILE] [--json]
  workspacectl workflow run --coordination ID --workflow ID [--input KEY=VALUE]... [--config FILE] [--json]
  workspacectl workflow status --run ID [--config FILE] [--json]
  workspacectl workflow submit --run ID --step ID --attempt ID --digest DIGEST --outcome completed|not-completed|unknown --evidence FILE [--evidence FILE]... [--config FILE] [--json]
  workspacectl workflow approve --run ID --step ID --attempt ID --digest DIGEST [--config FILE] [--json]
  workspacectl workflow interrupt --run ID --step ID --attempt ID --digest DIGEST [--config FILE] [--json]
  workspacectl workflow resume --run ID [--config FILE] [--json]
  workspacectl config export --target catalog [--config FILE] [--json]
  workspacectl config validate FILE [--config FILE] [--json]
  workspacectl config plan FILE --config FILE --plan FILE [--json]
  workspacectl group list [--config FILE] [--json]
  workspacectl group show --id ID [--config FILE] [--json]
  workspacectl group create --kind KIND --id ID --name NAME --slug SLUG [--parent ID] [--config FILE] --plan FILE [--json]
  workspacectl group update --id ID [--name NAME] [--slug SLUG] [--config FILE] --plan FILE [--json]
  workspacectl group reparent --id ID --parent ID [--config FILE] --plan FILE [--json]
  workspacectl repo list [--config FILE] [--json]
  workspacectl repo show --id ID [--config FILE] [--json]
  workspacectl repo membership --id ID --project ID --action add|remove [--config FILE] --plan FILE [--json]
  workspacectl repo classify --id ID --decision accept|reject [--group ID] [--config FILE] --plan FILE [--json]

M2/A06 checkout lookup/registration, catalog editing, and preserved read-only discovery:
  init    Save an inert preview for a new isolated config, catalog, and local-state store.
  import-v1  Preview a lossless v1 catalog plus unclassified sidecar import.
  apply   Re-derive, CAS-write, and read back the exact explicitly approved registry plan.
  discover  Observe explicit configured source IDs and trusted local roots without persisting selections.
  list    With selectors, show the shared overview; without them, preserve A03 catalog readback.
  report  Show the same selected coverage, repository facts, and findings as discover/list.
  audit   Show the same overview and exit 3 for incomplete coverage or decision findings.
  config export  Emit an editable catalog draft without changing the active document.
  config validate/plan  Validate or preview an explicit complete catalog draft.
  group/repo  Read or preview A05 business grouping, membership, and classification edits.
  where   Resolve a repository ID, canonical remote, or unique alias and show registered bindings.
  workspace select-primary  Preview an explicit persisted primary binding selection.
  adopt   Preview registry-only adoption of one verified existing checkout, including a dirty checkout.
  checkout  Preview then create one ordinary verified checkout through exclusive sibling staging.
  move    Preview then rename one clean inactive standalone checkout on the same filesystem.
  worktree  List registered Git worktrees or preview exact create/remove effects; removal never forces, prunes, or deletes branches.
  operation show/reconcile  Inspect preserved operation effects or preview a narrow binding repair.
  workflow  Execute a bounded inherited workflow through bound handoffs, approvals, commands, and readback.
  context/explain  Resolve bounded relevant v2 rules and references with provenance; selected trusted files load only with exact content approval and nothing executes.
  storage  Configured stores are selected only by installed registry name; test-async-file is a local test adapter, not a remote backend.
  open    Resolve a selected repository/group and A08 context read-only; explicit activation emits only an inert typed host action.
  host acknowledge  Verify an exact native Hermes Project plus effective tool cwd readback for the exact action ID/digest.
  coordination  Preview/create a non-Git coordination directory by approved plan or reopen its binding with member drift checks.
  doctor  Validate the integrated setup, or explicit standalone CLI readiness, without changing it.

Legacy read-only engine:
  validate --manifest FILE
  catalog --manifest FILE --principal SUBJECT
  explain --manifest FILE --node ID --principal SUBJECT [--workflow ID]
  workflow --manifest FILE --node ID --principal SUBJECT --workflow ID
  discover --root DIR [--depth N]
  discover-github --owner OWNER
  report --manifest FILE --node ID --principal SUBJECT --root DIR [--depth N] [--workflow ID] [--format json|html]
  plan|audit --manifest FILE --node ID --principal SUBJECT --root DIR [--depth N] [--workflow ID]
  verify-plan --manifest FILE --node ID --principal SUBJECT --root DIR --plan FILE [--depth N] [--workflow ID]

Legacy --principal is advisory, not authentication. Legacy workflow definitions are
inert and are never executed. Selected discovery remains read-only. A05 catalog edits
never adopt, move, create, or modify a checkout; those operation surfaces remain later milestones.
`;
class CliError extends Error {
  code: string;
  exitCode: number;
  constructor(code: string, message: string, exitCode: number) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
let publicErrorJson = false;
function renderLegacyText(command: string, value: unknown): string {
  const lines = [`Legacy read-only result: ${command}`];
  const scalar = (entry: unknown) =>
    typeof entry === "string" ? entry : JSON.stringify(entry);
  const append = (entry: unknown, indent: string, key?: string): void => {
    const label = key === undefined ? "" : `${key}:`;
    if (entry === null || typeof entry !== "object") {
      lines.push(`${indent}${label}${label ? " " : ""}${scalar(entry)}`);
      return;
    }
    if (label) lines.push(`${indent}${label}`);
    if (Array.isArray(entry)) {
      if (entry.length === 0) lines.push(`${indent}  (none)`);
      for (const item of entry) {
        if (item === null || typeof item !== "object")
          lines.push(`${indent}  - ${scalar(item)}`);
        else {
          lines.push(`${indent}  -`);
          append(item, `${indent}    `);
        }
      }
      return;
    }
    const entries = Object.entries(entry);
    if (entries.length === 0) lines.push(`${indent}  (none)`);
    for (const [childKey, child] of entries)
      append(child, label ? `${indent}  ` : indent, childKey);
  };
  append(value, "");
  return lines.join("\n") + "\n";
}
const contracts: Record<string, { required: string[]; optional: string[] }> =
  Object.fromEntries(
    [
      ["validate", ["manifest"], []],
      ["catalog", ["manifest", "principal"], []],
      ["explain", ["manifest", "node", "principal"], ["workflow"]],
      ["workflow", ["manifest", "node", "principal", "workflow"], []],
      ["discover", ["root"], ["depth"]],
      ["discover-github", ["owner"], []],
      [
        "report",
        ["manifest", "node", "principal", "root"],
        ["depth", "workflow", "format"],
      ],
      [
        "plan",
        ["manifest", "node", "principal", "root"],
        ["depth", "workflow"],
      ],
      [
        "audit",
        ["manifest", "node", "principal", "root"],
        ["depth", "workflow"],
      ],
      [
        "verify-plan",
        ["manifest", "node", "principal", "root", "plan"],
        ["depth", "workflow"],
      ],
    ].map(([name, required, optional]) => [name, { required, optional }]),
  ) as Record<string, { required: string[]; optional: string[] }>;
async function main(args: string[]): Promise<void> {
  if (args.length === 0 || (args.length === 1 && ["help", "--help"].includes(args[0]))) {
    process.stdout.write(help);
    return;
  }
  if (args.length === 1 && ["version", "--version"].includes(args[0])) {
    console.log("0.2.0");
    return;
  }
  const command = args[0];
  const useV2 =
    ["init", "import-v1", "apply", "list", "where", "workspace", "adopt", "checkout", "move", "worktree", "operation", "workflow", "config", "group", "repo", "context", "open", "host", "coordination"].includes(command) ||
    (command === "explain" && !args.includes("--manifest")) ||
    (command === "discover" && args.includes("--config")) ||
    (["report", "audit"].includes(command) && !args.includes("--manifest"));
  if (useV2) {
    publicErrorJson = args.includes("--json");
    const execution = await runV2Cli(args);
    requireThat(execution.handled && execution.body && execution.text);
    if (execution.exitCode !== undefined) process.exitCode = execution.exitCode;
    process.stdout.write(
      execution.json
        ? JSON.stringify(execution.body) + "\n"
        : execution.text,
    );
    return;
  }
  if (command === "doctor") {
    publicErrorJson = args.includes("--json");
    let configPath: string | undefined;
    let skillPath: string | undefined;
    let standalone = false;
    let json = false;
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === "--json" && !json) {
        json = true;
        continue;
      }
      if (flag === "--standalone" && !standalone) {
        standalone = true;
        continue;
      }
      if (
        flag === "--config" &&
        configPath === undefined &&
        index + 1 < args.length &&
        args[index + 1].length > 0
      ) {
        configPath = args[++index];
        continue;
      }
      if (
        flag === "--skill" &&
        skillPath === undefined &&
        index + 1 < args.length &&
        args[index + 1].length > 0
      ) {
        skillPath = args[++index];
        continue;
      }
      throw new CliError("INVALID_CONFIG", "Invalid doctor invocation.", 2);
    }
    if (standalone && skillPath !== undefined)
      throw new CliError("INVALID_CONFIG", "Invalid doctor invocation.", 2);
    const diagnosis = await diagnose({ configPath, skillPath, standalone });
    process.stdout.write(json ? JSON.stringify(diagnosis) + "\n" : renderDoctorText(diagnosis));
    process.exitCode = doctorExitCode(diagnosis);
    return;
  }
  if (!Object.hasOwn(contracts, command)) {
    publicErrorJson = args.includes("--json");
    throw new CliError("UNSUPPORTED", "Command is unsupported.", 2);
  }
  const contract = contracts[command];
  const flags: Record<string, string> = Object.create(null);
  let json = false;
  for (let i = 1; i < args.length; i += 1) {
    const k = args[i];
    if (k === "--json") {
      requireThat(!json);
      json = true;
      publicErrorJson = true;
      continue;
    }
    const v = args[++i];
    requireThat(
      k.startsWith("--") &&
        [...contract.required, ...contract.optional].includes(k.slice(2)) &&
        typeof v === "string" &&
        v.length > 0 &&
        !Object.hasOwn(flags, k.slice(2)),
    );
    flags[k.slice(2)] = v;
  }
  requireThat(contract.required.every((k) => Object.hasOwn(flags, k)));
  if (flags.depth !== undefined)
    requireThat(
      /^(0|[1-9]\d?)$/.test(flags.depth) && Number(flags.depth) <= 32,
    );
  if (command === "report")
    requireThat(flags.format === undefined || ["json", "html"].includes(flags.format));
  const scanOptions =
    flags.depth === undefined ? {} : { depth: Number(flags.depth) };
  const options =
    flags.workflow === undefined ? {} : { workflowId: flags.workflow };
  let result: unknown;
  if (command === "discover") {
    const inv = await discoverLocal(flags.root, scanOptions);
    result = inv;
    if (!inv.complete) process.exitCode = 3;
  } else if (command === "discover-github")
    result = await discoverGithub(flags.owner);
  else {
    const snapshot = await loadSnapshot(new FileSnapshotStore(flags.manifest));
    switch (command) {
      case "validate":
        result = {
          valid: true,
          apiVersion: snapshot.manifest.apiVersion,
          authorityId: snapshot.manifest.authorityId,
          revision: snapshot.revision,
          authorization: "advisory",
        };
        break;
      case "catalog":
        result = {
          authorization: "advisory",
          revision: snapshot.revision,
          nodes: visibleNodes(snapshot, flags.principal),
        };
        break;
      case "explain":
      case "workflow":
        result = resolvePolicy(snapshot, flags.node, flags.principal, options);
        break;
      default: {
        // Validate manifest, requested identity and parsed preview before touching scan root.
        resolvePolicy(snapshot, flags.node, flags.principal, options);
        const supplied =
          command === "verify-plan"
            ? (await readJsonFile(flags.plan)).value
            : undefined;
        const inventory = await discoverLocal(flags.root, scanOptions);
        if (command === "verify-plan") {
          verifyPlan(
            supplied,
            snapshot,
            inventory,
            flags.node,
            flags.principal,
            options,
          );
          result = { valid: true, executable: false };
        } else if (command === "report") {
          const report = createReport(
            snapshot,
            inventory,
            flags.node,
            flags.principal,
            options,
          );
          if (flags.format === "html") {
            process.stdout.write(renderReportHtml(report));
            return;
          }
          result = report;
        } else {
          const plan = createPlan(
            snapshot,
            inventory,
            flags.node,
            flags.principal,
            options,
          );
          const drift = plan.entries.some((e) => e.status !== "present");
          result = command === "audit" ? { ...plan, drift } : plan;
          if (command === "audit" && drift) process.exitCode = 3;
        }
      }
    }
  }
  process.stdout.write(json ? JSON.stringify(result) + "\n" : renderLegacyText(command, result));
}
try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CliError) {
    const body = { ok: false, error: { code: error.code, message: error.message } };
    console.error(
      publicErrorJson
        ? JSON.stringify(body)
        : `Error [${error.code}]: ${error.message}`,
    );
    process.exitCode = error.exitCode;
  } else {
    const e = error instanceof GovernanceError ? error : new GovernanceError();
    const body = {
      ok: false,
      error: {
        code: e.code,
        message: e.message,
        ...(e.details === undefined ? {} : { details: e.details }),
      },
    };
    console.error(publicErrorJson ? JSON.stringify(body) : `Error [${e.code}]: ${e.message}`);
    process.exitCode = ["INCOMPLETE", "STALE_PLAN", "RECOVERY_REQUIRED"].includes(e.code)
      ? 3
      : ["APPROVAL_REQUIRED", "UNTRUSTED_INPUT"].includes(e.code)
        ? 4
        : ["CONFLICT", "BUSY"].includes(e.code)
          ? 5
          : e.code === "ACTION_FAILED" || e.code === "TOOL_FAILURE"
            ? 6
            : 2;
  }
}
