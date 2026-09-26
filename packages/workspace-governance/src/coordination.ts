import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, canonicalRemote, digest, requireThat } from "./core.ts";
import { readSelectedRegistry } from "./catalog-readback.ts";
import { discoverLocal } from "./discovery.ts";

export type CoordinationMemberStatus = "exact" | "missing" | "changed" | "ambiguous" | "foreign";
export interface CoordinationMemberReadback {
  repositoryId: string;
  workspaceId: string;
  path: string | null;
  status: CoordinationMemberStatus;
}
export interface CoordinationReadback {
  schemaVersion: 1;
  id: string;
  path: string;
  status: "exact" | "drift";
  directoryStatus: "exact" | "missing" | "foreign";
  members: CoordinationMemberReadback[];
  revisions: { catalog: string; localState: string };
}

const exactObject = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));

function hasExactGeneratedMembers(value: unknown, expected: {
  schemaVersion: number;
  workspaceId: string;
  scope: { kind: string; id: string };
  members: Array<{ repositoryId: string; workspaceId: string; path: string | null }>;
}): boolean {
  if (!exactObject(value, ["schemaVersion", "workspaceId", "scope", "members"])) return false;
  if (!exactObject(value.scope, ["kind", "id"]) || !Array.isArray(value.members)) return false;
  if (!value.members.every((member) => exactObject(member, ["repositoryId", "workspaceId", "path"])
    && typeof member.repositoryId === "string"
    && typeof member.workspaceId === "string"
    && typeof member.path === "string")) return false;
  return canonicalJson(value) === canonicalJson(expected);
}

export async function reopenCoordinationWorkspace(configPath: string, workspaceId: string): Promise<CoordinationReadback> {
  requireThat(typeof workspaceId === "string" && workspaceId.length > 0, "INVALID_CONFIG");
  const registry = await readSelectedRegistry(configPath);
  const binding = registry.localState.coordinationWorkspaces.find((candidate) => candidate.id === workspaceId);
  requireThat(binding !== undefined, "NOT_FOUND");
  const group = registry.catalog.groups.find((candidate) => candidate.id === binding.scope.id && candidate.kind === binding.scope.kind);
  requireThat(group !== undefined, "INVALID_CONFIG");
  let directoryStatus: CoordinationReadback["directoryStatus"] = "exact";
  try {
    const status = await lstat(binding.path);
    if (!status.isDirectory() || status.isSymbolicLink()) directoryStatus = "foreign";
    else {
      try { await lstat(join(binding.path, ".git")); directoryStatus = "foreign"; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") directoryStatus = "foreign"; }
      for (const name of binding.generatedFiles) {
        const generated = await lstat(join(binding.path, name));
        if (!generated.isFile() || generated.isSymbolicLink()) directoryStatus = "foreign";
      }
      const membersFile = await readFile(join(binding.path, "members.json"), "utf8");
      const parsed: unknown = JSON.parse(membersFile);
      const expectedMembers = binding.memberRepositoryIds.map((repositoryId, index) => {
        const workspaceId = binding.memberWorkspaceIds[index];
        const persisted = registry.localState.repositoryWorkspaces.find((candidate) => candidate.id === workspaceId && candidate.repositoryId === repositoryId);
        return { repositoryId, workspaceId, path: persisted?.path ?? null };
      });
      const expected = { schemaVersion: 1, workspaceId: binding.id, scope: binding.scope, members: expectedMembers };
      if (binding.memberRepositoryIds.length !== binding.memberWorkspaceIds.length || !hasExactGeneratedMembers(parsed, expected)) directoryStatus = "foreign";
    }
  } catch (error) {
    directoryStatus = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "foreign";
  }
  const members: CoordinationMemberReadback[] = [];
  for (let index = 0; index < binding.memberRepositoryIds.length; index += 1) {
    const repositoryId = binding.memberRepositoryIds[index];
    const expectedWorkspaceId = binding.memberWorkspaceIds[index];
    const repository = registry.catalog.repositories.find((candidate) => candidate.id === repositoryId);
    const persisted = registry.localState.repositoryWorkspaces.find((candidate) => candidate.id === expectedWorkspaceId && candidate.repositoryId === repositoryId);
    const selected = registry.localState.repositoryWorkspaces.filter((candidate) => candidate.repositoryId === repositoryId && candidate.primarySelected);
    let status: CoordinationMemberStatus = "exact";
    let path: string | null = persisted?.path ?? null;
    if (repository === undefined || persisted === undefined) status = "missing";
    else if (selected.length > 1) status = "ambiguous";
    else if (selected.length !== 1 || selected[0].id !== expectedWorkspaceId) status = "changed";
    if (status === "exact") {
      try {
        const inventory = await discoverLocal(persisted!.path, { depth: 0, trustedMetadataRoots: registry.config.trustedRoots });
        const observed = inventory.repositories.find((candidate) => candidate.path === persisted!.path);
        if (observed === undefined) status = "missing";
        else if (observed.remote === null || observed.remote !== canonicalRemote(repository!.remote)) status = "foreign";
      } catch { status = "missing"; }
    }
    members.push({ repositoryId, workspaceId: expectedWorkspaceId, path, status });
  }
  const bindingBase = { ...binding } as Record<string, unknown>;
  delete bindingBase.revision;
  if (binding.revision !== `sha256:${digest(bindingBase)}`) directoryStatus = "foreign";
  return {
    schemaVersion: 1,
    id: binding.id,
    path: binding.path,
    status: directoryStatus === "exact" && members.every((member) => member.status === "exact") ? "exact" : "drift",
    directoryStatus,
    members,
    revisions: registry.revisions,
  };
}
