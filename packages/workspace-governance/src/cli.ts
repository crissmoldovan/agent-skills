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
import { manifestInitPlan, manifestInitTrialPlan } from "./setup/init-cli.ts";
import { readMutationStatus } from "./setup/mutation-status.ts";
const help = `workspacectl 0.1.0 — read-only JSON previews
Local --principal is advisory simulation, NOT authentication.
validate --manifest FILE
manifest-init-plan --manifest FILE --request FILE --state-dir DIR --executor-profile FILE
  Native-verified non-executable preview only; proposed policy is not apply authority.
manifest-init-trial-plan --install-root DIR --candidate FILE --intent FILE
  Full read-only trial issuance plan; no approval, reservation or apply.
mutation-status --state-dir DIR --operation-id ID
  Strict initial-trial ledger observation only, not a durability attestation.
  verified requires complete linkage and safe current finals; no helper or locks.
catalog --manifest FILE --principal SUBJECT
explain --manifest FILE --node ID --principal SUBJECT [--workflow ID]
workflow --manifest FILE --node ID --principal SUBJECT --workflow ID
discover --root DIR [--depth N]
discover-github --owner OWNER
plan|audit --manifest FILE --node ID --principal SUBJECT --root DIR [--depth N] [--workflow ID]
verify-plan --manifest FILE --node ID --principal SUBJECT --root DIR --plan FILE [--depth N] [--workflow ID]
--help | --version
No apply, execution, override flags, remote writes or automatic configuration.
`;
const contracts: Record<string, { required: string[]; optional: string[] }> =
  Object.fromEntries(
    [
      ["validate", ["manifest"], []],
      ["mutation-status", ["state-dir", "operation-id"], []],
      ["manifest-init-trial-plan", ["install-root", "candidate", "intent"], []],
      ["manifest-init-plan", ["manifest", "request", "state-dir", "executor-profile"], []],
      ["catalog", ["manifest", "principal"], []],
      ["explain", ["manifest", "node", "principal"], ["workflow"]],
      ["workflow", ["manifest", "node", "principal", "workflow"], []],
      ["discover", ["root"], ["depth"]],
      ["discover-github", ["owner"], []],
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
  // Set only by the separately provisioned native preload after authenticated
  // controller startup. No public flag/env/JSON chooses a launcher or grant.
  const startup = (globalThis as typeof globalThis & {__workspacectlNativeTrialStartup?: () => string}).__workspacectlNativeTrialStartup;
  if (args.length === 0 && typeof startup === "function") {
    const diagnostic = startup();
    process.stdout.write(diagnostic + "\n");
    process.exitCode = JSON.parse(diagnostic).ok === true ? 0 : 3; // Native-validated terminal reply.
    return;
  }
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help);
    return;
  }
  if (args.length === 1 && args[0] === "--version") {
    console.log("0.1.0");
    return;
  }
  const command = args[0];
  requireThat(Object.hasOwn(contracts, command));
  const contract = contracts[command];
  const flags: Record<string, string> = Object.create(null);
  for (let i = 1; i < args.length; i += 2) {
    const k = args[i];
    const v = args[i + 1];
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
  const scanOptions =
    flags.depth === undefined ? {} : { depth: Number(flags.depth) };
  const options =
    flags.workflow === undefined ? {} : { workflowId: flags.workflow };
  let result: unknown;
  if (command === "mutation-status") {
    result = await readMutationStatus(flags['state-dir'], flags['operation-id']);
  } else if (command === "manifest-init-trial-plan") {
    result = await manifestInitTrialPlan(flags);
  } else if (command === "manifest-init-plan") {
    result = await manifestInitPlan(flags);
  } else if (command === "discover") {
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
  console.log(JSON.stringify(result));
}
try {
  await main(process.argv.slice(2));
} catch (error) {
  const e = error instanceof GovernanceError ? error : new GovernanceError();
  console.error(
    JSON.stringify({ error: { code: e.code, message: e.message } }),
  );
  process.exitCode = ["INCOMPLETE", "STALE_PLAN", "RECOVERY_REQUIRED"].includes(e.code) ? 3 : 2;
}
