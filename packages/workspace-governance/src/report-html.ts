import { relative, sep } from "node:path";
import type { Json } from "./core.ts";
import type { Report, ReportNode, ReportRepository } from "./report.ts";

const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);

const statusLabel: Record<ReportRepository["status"], string> = {
  present: "Present",
  misplaced: "Misplaced",
  "missing-checkout": "Missing checkout",
  duplicate: "Duplicate",
  blocked: "Blocked",
};

function renderTree(nodes: ReportNode[]): string {
  const children = new Map<string | null, ReportNode[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const included = new Set(nodes.map((node) => node.id));
  const roots = nodes.filter((node) => node.parentId === null || !included.has(node.parentId));
  const branch = (node: ReportNode): string => {
    const descendants = children.get(node.id) ?? [];
    return `<li><span class="kind">${escapeHtml(node.kind)}</span><strong>${escapeHtml(node.slug)}</strong>${
      descendants.length > 0 ? `<ul>${descendants.map(branch).join("")}</ul>` : ""
    }</li>`;
  };
  return `<ul class="tree">${roots.map(branch).join("")}</ul>`;
}

function renderValue(value: Json): string {
  return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
}

function renderRepository(repository: ReportRepository, root: string): string {
  const relativePath = (path: string) => {
    const pathFromRoot = relative(root, path);
    return pathFromRoot.length === 0 ? "." : `.${sep}${pathFromRoot}`;
  };
  const found = repository.presentPaths.length === 0
    ? "Nowhere under scan root"
    : repository.presentPaths.map(relativePath).join(", ");
  const settings = Object.entries(repository.resolution.values)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${renderValue(value)}</dd>`)
    .join("");
  const provenance = repository.resolution.provenance
    .map((source) => `<li><code>${escapeHtml(source.key)}</code> · Merge <code>${escapeHtml(source.merge)}</code> · ${
      "value" in source ? `Value ${renderValue(source.value)}` : "Value <em>removed</em>"
    } · Source <strong>${escapeHtml(source.nodeId)}</strong>${
      source.workflowId === null ? "" : ` · Workflow <strong>${escapeHtml(source.workflowId)}</strong>`
    }</li>`)
    .join("");
  const constraints = repository.resolution.constraints.length === 0
    ? "<p>No resolved constraints.</p>"
    : `<ul class="constraints">${repository.resolution.constraints.map((constraint) =>
      `<li><code>${escapeHtml(constraint.id)}</code> · Key <code>${escapeHtml(constraint.key)}</code> · Operator <code>${escapeHtml(constraint.operator)}</code> · Value ${renderValue(constraint.value)} · Source <strong>${escapeHtml(constraint.nodeId)}</strong>${
        constraint.workflowId === null ? "" : ` · Workflow <strong>${escapeHtml(constraint.workflowId)}</strong>`
      }</li>`
    ).join("")}</ul>`;
  const workflow = repository.resolution.workflow;
  const steps = workflow === null
    ? "<p>No workflow selected.</p>"
    : `<ol class="workflow-steps">${workflow.steps.map((step) => "action" in step
      ? `<li>Step <code>${escapeHtml(step.id)}</code> · Action <code>${escapeHtml(step.action)}</code> · Inputs ${renderValue(step.inputs)}</li>`
      : `<li>Removed step <code>${escapeHtml(step.id)}</code></li>`
    ).join("")}</ol>`;
  return `<article class="repository">
    <header><div><h3>${escapeHtml(repository.slug)}</h3><div class="remote">${escapeHtml(repository.remote)}</div></div><span class="badge ${escapeHtml(repository.status)}">${statusLabel[repository.status]}</span></header>
    <p><strong>Target</strong> <code>${escapeHtml(relativePath(repository.target))}</code></p>
    <p><strong>Found</strong> <code>${escapeHtml(found)}</code></p>
    <p><strong>Dirty</strong> ${repository.dirty ? "Yes" : "No"}</p>
    <details><summary>Resolved policy details</summary><h4>Settings</h4><dl>${settings}</dl><h4>Provenance</h4><ul class="provenance">${provenance}</ul><h4>Resolved constraints</h4>${constraints}<h4>Workflow ${workflow === null ? "" : `<code>${escapeHtml(workflow.id)}</code>`}</h4>${steps}</details>
  </article>`;
}

export function renderReportHtml(report: Report): string {
  const summary = [
    ["Present", report.summary.present],
    ["Misplaced", report.summary.misplaced],
    ["Missing", report.summary.missingCheckout],
    ["Duplicate", report.summary.duplicate],
    ["Blocked", report.summary.blocked],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workspace governance report</title>
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px;color:var(--foreground,CanvasText);background:var(--background,Canvas)}main{max-width:1120px;margin:0 auto}.eyebrow{color:var(--accent,#5b7cfa);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:7px 0 8px;font-size:30px}.lede{color:var(--muted-foreground,#707070);line-height:1.5}.notice,.panel{border:1px solid var(--border,#8885);border-radius:12px;background:var(--card,transparent)}.notice{border-left:4px solid var(--accent,#5b7cfa);padding:11px 13px;margin:16px 0}.report-context{display:flex;flex-wrap:wrap;gap:8px 18px;margin:12px 0;font-size:12px}.summary{display:grid;grid-template-columns:repeat(5,minmax(100px,1fr));gap:8px;margin:16px 0}.stat{padding:12px}.stat strong{display:block;font-size:24px}.stat span,.remote{color:var(--muted-foreground,#707070);font-size:12px}.layout{display:grid;grid-template-columns:minmax(250px,.75fr) minmax(430px,1.5fr);gap:12px;align-items:start}.panel{padding:14px}.panel h2{font-size:17px;margin:0 0 12px}.tree,.tree ul{list-style:none;padding-left:0}.tree ul{padding-left:17px;border-left:1px solid var(--border,#8885);margin:5px 0 5px 8px}.tree li{padding:4px 0}.kind{font-size:10px;text-transform:uppercase;color:var(--muted-foreground,#707070);border:1px solid var(--border,#8885);border-radius:999px;padding:2px 5px;margin-right:7px}.repository{padding:13px 0;border-top:1px solid var(--border,#8885)}.repository:first-of-type{border-top:0}.repository header{display:flex;justify-content:space-between;gap:10px}.repository h3{font-size:15px;margin:0 0 4px}.repository p{font-size:12px}.badge{height:max-content;border-radius:999px;padding:4px 7px;font-size:11px;font-weight:700}.present{color:#35b96f}.misplaced{color:#e5a42f}.missing-checkout{color:#4f9eed}.duplicate,.blocked{color:#ef6b6b}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;overflow-wrap:anywhere}details{font-size:12px}details h4{margin:12px 0 6px}summary{cursor:pointer;color:var(--accent,#5b7cfa)}dl{display:grid;grid-template-columns:minmax(130px,.7fr) 1fr;gap:5px 10px}dt{color:var(--muted-foreground,#707070)}dd{margin:0}.provenance,.constraints,.workflow-steps{padding-left:18px;color:var(--muted-foreground,#707070)}footer{margin-top:12px;color:var(--muted-foreground,#707070);font-size:12px}@media(max-width:760px){body{padding:12px}.summary{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<div class="eyebrow">Read-only · ${report.summary.drift ? "attention needed" : "aligned"}</div>
<h1>Workspace governance report</h1>
<p class="lede">One declared hierarchy, observed local checkouts, inherited policy, and inert workflow previews.</p>
<div class="notice">This report does not move, clone, delete, enforce policy, or execute workflows.</div>
<div class="report-context"><span><strong>Principal</strong> <code>${escapeHtml(report.principal)}</code></span><span><strong>Authorization</strong> <code>${escapeHtml(report.authorization)}</code></span></div>
<section class="summary">${summary.map(([label, count]) => `<div class="panel stat"><strong>${count}</strong><span>${label}</span></div>`).join("")}</section>
<div class="layout"><section class="panel"><h2>Hierarchy</h2>${renderTree(report.nodes)}</section><section class="panel"><h2>Repositories</h2>${report.repositories.map((repository) => renderRepository(repository, report.root)).join("")}</section></div>
<footer>Revision <code>${escapeHtml(report.revision)}</code> · Scope <code>${escapeHtml(report.nodeId)}</code> · Workflow <code>${escapeHtml(report.workflowId ?? "none")}</code></footer>
</main></body></html>\n`;
}
