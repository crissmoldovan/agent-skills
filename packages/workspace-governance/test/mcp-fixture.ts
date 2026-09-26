import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { documentRevision } from "../src/v2-model.ts";
import { startWorkflow } from "../src/workflow-execution.ts";

export interface McpFixture {
  root: string;
  configPath: string;
  catalogPath: string;
  statePath: string;
  repositoryPath: string;
  runId: string;
  snapshot(): Promise<string>;
}

const emptyPolicy = (kind: string, id: string, settings: Record<string, unknown> = {}) => ({
  scope: { kind, id }, settings, operations: [], constraints: [], instructions: [], knowledge: [], skills: [],
});

export async function createMcpFixture(root: string): Promise<McpFixture> {
  const plans = join(root, "plans");
  const trusted = join(root, "trusted");
  const repositoryPath = join(trusted, "repo");
  await Promise.all([mkdir(plans, { recursive: true }), mkdir(repositoryPath, { recursive: true })]);
  execFileSync("git", ["init", "-q", "-b", "main", repositoryPath]);
  execFileSync("git", ["-C", repositoryPath, "remote", "add", "origin", "https://github.com/example/repo.git"]);

  const configPath = join(root, "config.json");
  const catalogPath = join(root, "catalog.json");
  const statePath = join(root, "state.json");
  const config = {
    schemaVersion: 2,
    documentType: "workspacectl/config",
    catalog: { adapter: "file", path: catalogPath },
    localState: { adapter: "file", path: statePath },
    plans: { directory: plans },
    trustedRoots: [trusted],
  };
  const catalog = {
    schemaVersion: 2,
    documentType: "workspacectl/catalog",
    groups: [
      { id: "org", kind: "organization", name: "Example", slug: "example", parentId: null, metadata: {} },
      { id: "project", kind: "project", name: "Service", slug: "service", parentId: "org", metadata: {} },
    ],
    repositories: [{
      id: "repo", remote: "https://github.com/example/repo", sourceId: null,
      primaryGroupId: "project", memberOf: [], aliases: ["service"], classification: "confirmed", metadata: {},
    }],
    sources: [],
    policies: [emptyPolicy("organization", "org", { "commands.test": "npm test" })],
    workflows: [{
      id: "feature", scope: { kind: "project", id: "project" }, inputs: [], outputs: [], settings: {},
      operations: [], constraints: [], steps: [{
        id: "context", type: "context.resolve", needs: [], configuration: { repositoryId: "repo", workspaceId: "ws" }, sideEffect: "none",
        approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true,
      }],
    }],
    metadata: {},
  };
  const state = {
    schemaVersion: 2,
    documentType: "workspacectl/local-state",
    selectedConfig: { path: configPath, revision: documentRevision(config) },
    repositoryWorkspaces: [{
      id: "ws", kind: "primary", repositoryId: "repo", path: repositoryPath,
      branch: "main", primarySelected: true, hostLinks: {},
    }],
    coordinationWorkspaces: [], workspacePolicyOverlays: [], workspaceWorkflowOverlays: [],
    trustedInputApprovals: [], planReferences: [], runReferences: [], metadata: {},
  };
  await Promise.all([
    writeFile(configPath, JSON.stringify(config) + "\n"),
    writeFile(catalogPath, JSON.stringify(catalog) + "\n"),
    writeFile(statePath, JSON.stringify(state) + "\n"),
  ]);
  const run = await startWorkflow(configPath, {
    repositoryId: "repo", workspaceId: "ws", workflowId: "feature", inputs: {},
  });
  const runPath = join(plans, "runs", `${run.id}.json`);
  return {
    root, configPath, catalogPath, statePath, repositoryPath, runId: run.id,
    async snapshot() {
      const hash = createHash("sha256");
      for (const path of [configPath, catalogPath, statePath, runPath]) hash.update(await readFile(path));
      return hash.digest("hex");
    },
  };
}
