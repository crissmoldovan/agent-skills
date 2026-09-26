#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./mcp-server.ts";
import { createGovernanceService } from "./mcp-service.ts";
import { BoundedStdioServerTransport } from "./mcp-transport.ts";

function parseArgs(args: string[]): { configPath: string; allowPlans: boolean; allowApply: boolean } {
  let config: string | undefined, allowPlans = false, allowApply = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--allow-plans") { if (allowPlans) throw new Error("Duplicate --allow-plans."); allowPlans = true; continue; }
    if (arg === "--allow-apply") { if (allowApply) throw new Error("Duplicate --allow-apply."); allowApply = true; continue; }
    if (arg === "--config" && config === undefined) { config = args[++index]; continue; }
    throw new Error("Usage: workspacectl-mcp --config ABSOLUTE_FILE [--allow-plans] [--allow-apply]");
  }
  if (!config || !isAbsolute(config)) throw new Error("Usage: workspacectl-mcp --config ABSOLUTE_FILE [--allow-plans] [--allow-apply]");
  const configPath = resolve(config);
  if (configPath !== config) throw new Error("Configuration path must be absolute and normalized.");
  return { configPath, allowPlans: allowPlans || allowApply, allowApply };
}

try {
  const selected = parseArgs(process.argv.slice(2));
  const service = createGovernanceService({ ...selected, env: { ...process.env } });
  const handle = serveStdio(() => createMcpServer(service), { transport: new BoundedStdioServerTransport(), onerror: () => { process.stderr.write("MCP transport error.\n"); } });
  let closing = false;
  const close = () => { if (closing) return; closing = true; void handle.close().finally(() => { process.exitCode = 0; }); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Invalid MCP server configuration."}\n`);
  process.exitCode = 2;
}
