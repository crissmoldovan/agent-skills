import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SKILLS_CLI_VERSION,
  SkillLifecycleError,
  planSkillLifecycle,
  runSkillLifecycle,
  type SkillLifecycleAction,
  type SkillLifecycleOptions,
  type SkillScope,
} from "./skill-lifecycle.ts";

export const DEFAULT_SKILL_SOURCE = "crissmoldovan/agent-skills";
export const DEFAULT_SKILL_REF = "workspace-governance-v0.3.0";

interface SetupIo { input: Readable; output: Writable; env: NodeJS.ProcessEnv; cwd: string; interactive: boolean }
export interface SetupExecution { json: boolean; exitCode: number; body: Record<string, unknown>; text: string }

function quoted(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function instructions(source: string, ref: string, cwd: string): string[] {
  const effective = source.startsWith("/") || source.startsWith(".") ? source : `${source.replace(/#.*$/, "")}#${ref}`;
  return [
    `cd ${quoted(cwd)} && npx --yes skills@${SKILLS_CLI_VERSION} add ${quoted(effective)} --skill workspace-governance --agent hermes-agent --copy --yes --json`,
    `cd ${quoted(cwd)} && npx --yes skills@${SKILLS_CLI_VERSION} remove workspace-governance --agent hermes-agent --yes`,
  ];
}

async function setupDiagnostics(io: SetupIo): Promise<Record<string, unknown>> {
  const home = io.env.HOME || "";
  const configPath = io.env.WORKSPACECTL_CONFIG || join(io.env.XDG_CONFIG_HOME || join(home, ".config"), "workspacectl", "config.yaml");
  const candidates = [
    { agent: "hermes-agent", scope: "project", path: join(io.cwd, ".hermes", "skills", "workspace-governance", "SKILL.md") },
    { agent: "claude-code", scope: "project", path: join(io.cwd, ".claude", "skills", "workspace-governance", "SKILL.md") },
    { agent: "hermes-agent", scope: "global", path: join(io.env.HERMES_HOME || join(home, ".hermes"), "skills", "workspace-governance", "SKILL.md") },
    { agent: "claude-code", scope: "global", path: join(io.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills", "workspace-governance", "SKILL.md") },
  ];
  const projections = await Promise.all(candidates.map(async (candidate) => {
    try {
      const status = await lstat(candidate.path);
      if (!status.isFile() || status.isSymbolicLink()) return { ...candidate, status: "conflict" };
      const text = await readFile(candidate.path, "utf8");
      const version = /^---\r?\n[\s\S]*?^version:\s*["']?([^\s"']+)["']?\s*$/m.exec(text)?.[1] ?? null;
      return { ...candidate, status: "installed", version };
    } catch (error) {
      return { ...candidate, status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unreadable" };
    }
  }));
  const configuration = await lstat(configPath).then(
    (status) => ({ path: configPath, status: status.isFile() && !status.isSymbolicLink() ? "present" : "conflict" }),
    (error: NodeJS.ErrnoException) => ({ path: configPath, status: error.code === "ENOENT" ? "missing" : "unreadable" }),
  );
  return {
    cliReady: true,
    cliVersion: "0.2.0",
    skillsCliVersion: SKILLS_CLI_VERSION,
    skill: { optional: true, installed: projections.some((item) => item.status === "installed"), projections },
    configuration,
    mcp: { status: "not-inspected", note: "Registration and a live handshake are separate from setup." },
  };
}

function parse(args: string[]): { json: boolean; action?: SkillLifecycleAction; source?: string; ref?: string; agents: string[]; scope?: SkillScope; yes: boolean } {
  let json = false, action: SkillLifecycleAction | undefined, source: string | undefined, ref: string | undefined, scope: SkillScope | undefined, yes = false;
  const agents: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") { if (json) throw new SkillLifecycleError("INVALID_ARGUMENT", "Duplicate --json."); json = true; continue; }
    if (flag === "--yes") { if (yes) throw new SkillLifecycleError("INVALID_ARGUMENT", "Duplicate --yes."); yes = true; continue; }
    if (flag === "--install-skill" || flag === "--remove-skill") {
      if (action) throw new SkillLifecycleError("INVALID_ARGUMENT", "Choose exactly one skill lifecycle action.");
      action = flag === "--install-skill" ? "add" : "remove"; continue;
    }
    if (!["--source", "--ref", "--agent", "--scope"].includes(flag)) throw new SkillLifecycleError("INVALID_ARGUMENT", `Unknown setup option: ${flag}.`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new SkillLifecycleError("INVALID_ARGUMENT", `${flag} requires a value.`);
    if (flag === "--agent") agents.push(value);
    else if (flag === "--source") { if (source) throw new SkillLifecycleError("INVALID_ARGUMENT", "Duplicate --source."); source = value; }
    else if (flag === "--ref") { if (ref) throw new SkillLifecycleError("INVALID_ARGUMENT", "Duplicate --ref."); ref = value; }
    else { if (scope) throw new SkillLifecycleError("INVALID_ARGUMENT", "Duplicate --scope."); if (!["project", "global"].includes(value)) throw new SkillLifecycleError("INVALID_ARGUMENT", "Scope must be project or global."); scope = value as SkillScope; }
  }
  return { json, action, source, ref, agents, scope, yes };
}

function lifecycleOptions(parsed: ReturnType<typeof parse>, io: SetupIo): SkillLifecycleOptions {
  if (!parsed.source || !parsed.ref || parsed.agents.length === 0 || !parsed.scope)
    throw new SkillLifecycleError("INVALID_ARGUMENT", "Explicit --source, --ref, --agent, and --scope are required for a lifecycle action.");
  if (!parsed.yes) throw new SkillLifecycleError("CONSENT_REQUIRED", "Explicit --yes is required for a lifecycle action.");
  return { action: parsed.action!, source: parsed.source, ref: parsed.ref, agents: parsed.agents, scope: parsed.scope, cwd: io.cwd, env: io.env, yes: true };
}

async function question(rl: ReturnType<typeof createInterface>, prompt: string, output?: Writable): Promise<string | null> {
  output?.write(prompt);
  return new Promise((resolveQuestion) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      rl.off("line", onLine);
      rl.off("close", onClose);
      resolveQuestion(value);
    };
    const onLine = (line: string) => finish(line.trim());
    const onClose = () => finish(null);
    rl.once("line", onLine);
    rl.once("close", onClose);
  });
}

async function interactiveSetup(io: SetupIo): Promise<SetupExecution> {
  const source = io.env.WORKSPACECTL_SKILL_SOURCE || DEFAULT_SKILL_SOURCE;
  const ref = io.env.WORKSPACECTL_SKILL_REF || DEFAULT_SKILL_REF;
  io.output.write("The workspace-governance agent skill is optional. The CLI and MCP remain usable without it.\n");
  const rl = createInterface({ input: io.input, output: io.output, terminal: true });
  try {
    const choice = await question(rl, "Choose [i]nstall, show [m]anual instructions, or [s]kip (default skip): ", io.output);
    if (choice === null || choice === "" || ["s", "skip", "n", "no", "cancel"].includes(choice.toLowerCase()))
      return { json: false, exitCode: 0, body: { ok: true, command: "setup", mode: "skipped", cliReady: true }, text: "Skill installation skipped. CLI remains ready; configuration and MCP connection are separate.\n" };
    if (["m", "manual", "instructions"].includes(choice.toLowerCase())) {
      const commands = instructions(source, ref, io.cwd);
      return { json: false, exitCode: 0, body: { ok: true, command: "setup", mode: "instructions", instructions: commands }, text: `Manual commands (review scope and agent first):\n${commands.join("\n")}\n` };
    }
    if (!["i", "install", "y", "yes"].includes(choice.toLowerCase()))
      return { json: false, exitCode: 0, body: { ok: true, command: "setup", mode: "skipped", cliReady: true }, text: "Unrecognized choice; installation skipped safely.\n" };
    const agentAnswer = await question(rl, "Agent IDs (comma-separated: hermes-agent, claude-code): ", io.output);
    if (!agentAnswer) return { json: false, exitCode: 0, body: { ok: true, command: "setup", mode: "cancelled" }, text: "No agents selected; installation cancelled.\n" };
    const agents = agentAnswer.split(",").map((value) => value.trim()).filter(Boolean);
    const scopeAnswer = await question(rl, `Scope [project/global] (project uses current directory ${io.cwd}): `, io.output);
    if (!scopeAnswer || !["project", "global"].includes(scopeAnswer.toLowerCase()))
      return { json: false, exitCode: 0, body: { ok: true, command: "setup", mode: "cancelled" }, text: "No valid scope selected; installation cancelled.\n" };
    const options: SkillLifecycleOptions = { action: "add", source, ref, agents, scope: scopeAnswer.toLowerCase() as SkillScope, cwd: io.cwd, env: io.env, yes: true };
    const plan = await planSkillLifecycle(options);
    io.output.write(`Exact source: ${source}\nImmutable ref: ${ref}\nSkills CLI: ${SKILLS_CLI_VERSION}\nCommand: ${plan.command.map(quoted).join(" ")}\nDestinations:\n${plan.projections.map((item) => `  ${item.agent}: ${item.path} (${item.state})`).join("\n")}\n`);
    const consent = await question(rl, "Install exactly this selection? [y/N]: ", io.output);
    if (!consent || !["y", "yes"].includes(consent.toLowerCase()))
      return { json: false, exitCode: 0, body: { ok: true, command: "setup", mode: "declined" }, text: "Consent declined; nothing was installed.\n" };
    const result = await runSkillLifecycle(options);
    return { json: false, exitCode: result.ok ? 0 : 6, body: result as unknown as Record<string, unknown>, text: result.ok ? `Skill ${result.noop ? "already matched" : "installed and verified"}; version ${result.skillVersion}.\nCLI ready; configuration and MCP connection remain separate.\n` : `Skills CLI did not complete every projection.\nChanged: ${result.changed.map((item) => `${item.agent}:${item.path}`).join(", ") || "none"}\nUnchanged: ${result.unchanged.map((item) => `${item.agent}:${item.path}`).join(", ") || "none"}\nRecovery:\n${result.recoveryCommands.join("\n")}\n` };
  } finally { rl.close(); }
}

export async function runSetup(args: string[], io: SetupIo): Promise<SetupExecution> {
  const parsed = parse(args);
  if (!io.interactive || parsed.json || args.length > 0) {
    if (!parsed.action) {
      const base = { ok: true, command: "setup", mode: "preview", ...await setupDiagnostics(io), instructions: instructions(parsed.source || DEFAULT_SKILL_SOURCE, parsed.ref || DEFAULT_SKILL_REF, io.cwd) };
      if (parsed.source && parsed.ref && parsed.agents.length > 0 && parsed.scope) {
        const plan = await planSkillLifecycle({ action: "add", source: parsed.source, ref: parsed.ref, agents: parsed.agents, scope: parsed.scope, cwd: io.cwd, env: io.env });
        return { json: parsed.json, exitCode: 0, body: { ...base, plan }, text: `Setup preview only.\n${base.instructions.join("\n")}\n` };
      }
      return { json: parsed.json, exitCode: 0, body: base, text: `Setup preview only; the skill is optional.\n${base.instructions.join("\n")}\n` };
    }
    const result = await runSkillLifecycle(lifecycleOptions(parsed, io));
    return { json: parsed.json, exitCode: result.ok ? 0 : 6, body: result as unknown as Record<string, unknown>, text: result.ok ? `Skill lifecycle verified (${result.noop ? "no change" : "changed"}).\n` : `Skill lifecycle incomplete. Changed: ${result.changed.length}; unchanged: ${result.unchanged.length}.\n${result.recoveryCommands.join("\n")}\n` };
  }
  return interactiveSetup(io);
}
