import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { generateClientConfig, installedMcpExecutable } from "../src/client-config.ts";
import { runV2Cli } from "../src/v2-cli.ts";

const READ_TOOLS = [
  "workspace_doctor", "workspace_list", "workspace_where", "workspace_context",
  "workspace_explain", "workspace_open", "workspace_workflow", "workspace_operation",
];

function parseTomlString(token: string): string {
  assert.ok(token.startsWith('"') && token.endsWith('"'));
  let value = "";
  for (let index = 1; index < token.length - 1; index += 1) {
    const character = token[index];
    if (character !== "\\") { value += character; continue; }
    const escape = token[++index];
    const simple: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    if (Object.hasOwn(simple, escape)) value += simple[escape];
    else {
      assert.ok(escape === "u" || escape === "U", `unsupported TOML escape ${escape}`);
      const width = escape === "u" ? 4 : 8;
      const digits = token.slice(index + 1, index + 1 + width);
      assert.match(digits, new RegExp(`^[0-9a-fA-F]{${width}}$`));
      value += String.fromCodePoint(Number.parseInt(digits, 16));
      index += width;
    }
  }
  return value;
}

function parseTomlValue(token: string): string | string[] {
  if (!token.startsWith("[")) return parseTomlString(token);
  const body = token.slice(1, -1).trim();
  if (!body) return [];
  const values = [];
  let start = 0, quoted = false, escaped = false;
  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index];
    if (quoted && character === "\\" && !escaped) { escaped = true; continue; }
    if (character === '"' && !escaped) quoted = !quoted;
    if ((!quoted && character === ",") || index === body.length) {
      values.push(parseTomlString(body.slice(start, index).trim()));
      start = index + 1;
    }
    escaped = false;
  }
  return values;
}

function parseTinyToml(source: string) {
  const lines = source.trim().split("\n");
  assert.equal(lines.shift(), "[mcp_servers.workspace-governance]");
  const result: Record<string, unknown> = {};
  for (const line of lines) {
    const separator = line.indexOf("=");
    assert.ok(separator > 0, line);
    const key = line.slice(0, separator).trim();
    result[key] = parseTomlValue(line.slice(separator + 1).trim());
  }
  return { mcp_servers: { "workspace-governance": result } };
}

function assertReadOnly(result: ReturnType<typeof generateClientConfig>) {
  assert.equal(result.status, "registration-generated");
  assert.equal(result.connected, false);
  assert.equal(result.profileWritten, false);
  assert.deepEqual(result.defaultTools, READ_TOOLS);
  assert.equal(result.capabilities, "read-only");
  assert.deepEqual(result.args, ["--config", "/tmp/M4 Consumer/config/workspace.json"]);
  const launch = JSON.stringify({ command: result.command, args: result.args, rendered: result.rendered });
  for (const forbidden of ["--allow-plans", "--allow-apply", "bypassPermissions", "auto_review", "approval_policy", "default_tools_approval_mode", "tools.include", "tools.exclude"])
    assert.equal(launch.includes(forbidden), false, forbidden);
  assert.match(result.guidance.registration, /does not connect|not a connection/i);
  assert.match(result.guidance.permissions, /human|host/i);
}

test("generic JSON is portable registration data with exact space-safe argv", () => {
  const result = generateClientConfig({
    client: "generic",
    serverPath: "/tmp/M4 Consumer/bin/workspacectl-mcp",
    configPath: "/tmp/M4 Consumer/config/workspace.json",
    destination: "/tmp/M4 Consumer/client registration.json",
    home: "/tmp/M4 Consumer/home",
    cwd: "/tmp/M4 Consumer/project",
  });
  assertReadOnly(result);
  assert.equal(result.destination, "/tmp/M4 Consumer/client registration.json");
  assert.equal(result.scope, "selected-destination");
  assert.equal(result.rendered.format, "json");
  assert.deepEqual(JSON.parse(result.rendered.content), result.rendered.value);
  assert.deepEqual(result.rendered.value, { mcpServers: { "workspace-governance": {
    type: "stdio", command: "/tmp/M4 Consumer/bin/workspacectl-mcp",
    args: ["--config", "/tmp/M4 Consumer/config/workspace.json"],
  } } });
  assert.equal(result.registrationCommand, null);
});

test("Claude Code JSON and opt-in command preserve server argv and add no permission rule", () => {
  const result = generateClientConfig({
    client: "claude-code", scope: "project",
    serverPath: "/tmp/M4 Consumer/bin/workspacectl-mcp",
    configPath: "/tmp/M4 Consumer/config/workspace.json",
    home: "/tmp/M4 Consumer/home", cwd: "/tmp/M4 Consumer/project",
  });
  assertReadOnly(result);
  assert.equal(result.destination, "/tmp/M4 Consumer/project/.mcp.json");
  assert.equal(result.scope, "project");
  assert.deepEqual(JSON.parse(result.rendered.content), result.rendered.value);
  assert.deepEqual(result.registrationCommand, {
    command: "claude",
    args: ["mcp", "add", "--scope", "project", "workspace-governance", "--", "/tmp/M4 Consumer/bin/workspacectl-mcp", "--config", "/tmp/M4 Consumer/config/workspace.json"],
    executed: false,
  });
  assert.equal(result.liveTestStatus, "documented-not-live-tested");
});

test("Codex emits parseable TOML and an inert registration command", () => {
  const result = generateClientConfig({
    client: "codex", scope: "user",
    serverPath: "/tmp/M4 Consumer/bin/workspacectl-mcp",
    configPath: "/tmp/M4 Consumer/config/workspace.json",
    home: "/tmp/M4 Consumer/home", cwd: "/tmp/M4 Consumer/project",
  });
  assertReadOnly(result);
  assert.equal(result.destination, "/tmp/M4 Consumer/home/.codex/config.toml");
  assert.equal(result.rendered.format, "toml");
  assert.deepEqual(parseTinyToml(result.rendered.content), result.rendered.value);
  assert.deepEqual(result.registrationCommand, {
    command: "codex",
    args: ["mcp", "add", "workspace-governance", "--", "/tmp/M4 Consumer/bin/workspacectl-mcp", "--config", "/tmp/M4 Consumer/config/workspace.json"],
    executed: false,
  });
  assert.match(result.guidance.permissions, /auto, prompt, or approve/);
  assert.match(result.guidance.permissions, /approve skips per-call prompting/);
  assert.match(result.guidance.permissions, /auto_review is automated review rather than human consent/);
});

test("Claude local scope renders the exact project entry in the user settings file", () => {
  const result = generateClientConfig({
    client: "claude-code", scope: "local",
    serverPath: "/tmp/M4 Consumer/bin/workspacectl-mcp",
    configPath: "/tmp/M4 Consumer/config/workspace.json",
    home: "/tmp/M4 Consumer/home", cwd: "/tmp/M4 Consumer/project",
  });
  assert.deepEqual(result.rendered.value, { projects: { "/tmp/M4 Consumer/project": {
    mcpServers: { "workspace-governance": {
      type: "stdio", command: "/tmp/M4 Consumer/bin/workspacectl-mcp",
      args: ["--config", "/tmp/M4 Consumer/config/workspace.json"],
    } },
  } } });
});

test("Codex project scope omits the user-scoped CLI registration command", () => {
  const result = generateClientConfig({
    client: "codex", scope: "project",
    serverPath: "/tmp/M4 Consumer/bin/workspacectl-mcp",
    configPath: "/tmp/M4 Consumer/config/workspace.json",
    home: "/tmp/M4 Consumer/home", cwd: "/tmp/M4 Consumer/project",
  });
  assert.equal(result.destination, "/tmp/M4 Consumer/project/.codex/config.toml");
  assert.equal(result.registrationCommand, null);
});

test("Codex TOML independently round-trips quotes, slashes, controls, and Unicode", () => {
  const serverPath = "/tmp/quote \" slash \\ snowman ☃/workspacectl-mcp";
  const configPath = "/tmp/line\nbreak\tand\bbackspace/config.json";
  const result = generateClientConfig({ client: "codex", scope: "user", serverPath, configPath, home: "/tmp/home", cwd: "/tmp/project" });
  assert.deepEqual(parseTinyToml(result.rendered.content), result.rendered.value);
});

test("Hermes emits parseable profile-aware YAML without claiming per-call approval", () => {
  const result = generateClientConfig({
    client: "hermes",
    serverPath: "/tmp/M4 Consumer/bin/workspacectl-mcp",
    configPath: "/tmp/M4 Consumer/config/workspace.json",
    home: "/tmp/M4 Consumer/home", hermesHome: "/tmp/M4 Consumer/hermes profile",
    cwd: "/tmp/M4 Consumer/project",
  });
  assertReadOnly(result);
  assert.equal(result.destination, "/tmp/M4 Consumer/hermes profile/config.yaml");
  assert.equal(result.rendered.format, "yaml");
  assert.deepEqual(parseYaml(result.rendered.content), result.rendered.value);
  assert.equal(result.registrationCommand, null);
  assert.match(result.guidance.permissions, /does not establish a per-call human-consent prompt/i);
});

test("Hermes YAML escapes NEL so the host parser preserves exact executable and config paths", () => {
  const serverPath = "/tmp/bin\u0085name/workspacectl-mcp";
  const configPath = "/tmp/path\u0085name/config.json";
  const result = generateClientConfig({
    client: "hermes", serverPath, configPath,
    home: "/tmp/home", hermesHome: "/tmp/hermes", cwd: "/tmp/project",
  });
  assert.ok(result.rendered.content.includes("\\u0085"), "NEL must be emitted as a YAML escape, not a literal line-break character");
  assert.equal(result.rendered.content.includes("\u0085"), false);
  assert.deepEqual(parseYaml(result.rendered.content), result.rendered.value);
});

test("generator refuses relative paths, unsupported scopes, and missing generic destination", () => {
  const base = { client: "generic" as const, serverPath: "/bin/workspacectl-mcp", configPath: "/tmp/config.json", home: "/tmp/home", cwd: "/tmp/project" };
  assert.throws(() => generateClientConfig(base), /destination/i);
  assert.throws(() => generateClientConfig({ ...base, destination: "relative.json" }), /absolute/i);
  assert.throws(() => generateClientConfig({ ...base, destination: "/tmp/out", configPath: "relative.json" }), /absolute/i);
  assert.throws(() => generateClientConfig({ ...base, destination: "/tmp/out", serverPath: "workspacectl-mcp" }), /absolute/i);
  assert.throws(() => generateClientConfig({ ...base, destination: "/tmp/out", configPath: "/tmp/nul\0config" }), /NUL/i);
  assert.throws(() => generateClientConfig({ ...base, client: "codex", scope: "local" as never }), /scope/i);
});

test("installed executable uses a managed sibling or current direct package entry without PATH guessing", () => {
  assert.equal(installedMcpExecutable({ WORKSPACECTL_LAUNCHER: "/tmp/managed bin/workspacectl" }, "/ignored/dist/cli.js"), "/tmp/managed bin/workspacectl-mcp");
  assert.equal(installedMcpExecutable({}, "/tmp/direct install/node_modules/@scope/package/dist/cli.js"), "/tmp/direct install/node_modules/@scope/package/dist/mcp-cli.js");
  assert.throws(() => installedMcpExecutable({}, "/tmp/direct install/bin/workspacectl"), /dist\/cli\.js/);
});

test("CLI route is pure, resolves the managed sibling launcher, and never writes profiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-config-pure-"));
  try {
    const home = join(root, "home with spaces");
    const bin = join(root, "bin with spaces");
    const config = join(root, "config with spaces", "workspace.json");
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(join(root, "config with spaces"), { recursive: true });
    await writeFile(join(home, ".claude", "sentinel"), "unchanged\n");
    const before = await readdir(join(home, ".claude"));
    const execution = await runV2Cli([
      "mcp", "config", "--client", "claude-code", "--scope", "local", "--config", config, "--json",
    ], { HOME: home, WORKSPACECTL_LAUNCHER: join(bin, "workspacectl") });
    assert.equal(execution.handled, true);
    assert.equal(execution.json, true);
    assert.equal(execution.body?.profileWritten, false);
    assert.equal(execution.body?.command, join(bin, "workspacectl-mcp"));
    assert.deepEqual(await readdir(join(home, ".claude")), before);
    assert.equal(await readFile(join(home, ".claude", "sentinel"), "utf8"), "unchanged\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
