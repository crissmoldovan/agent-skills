import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(packageRoot, "../..");

test("P31 consumer harness is stdlib-only and exercises the carried helper plus real CLI/MCP removal", async () => {
  const source = await readFile(join(packageRoot, "scripts", "m4-consumer.mjs"), "utf8");
  assert.doesNotMatch(source, /packages\/workspace-governance|\.\.\/src|\/dist\//);
  assert.doesNotMatch(source, /@modelcontextprotocol|from\s+["']yaml["']|from\s+["']zod["']/);
  for (const marker of [
    "--helper", "--manifest-sha256", "--yes", "--version", "doctor", "list",
    'request("initialize"', 'request("tools/list"', 'request("tools/call"',
    'name: "workspace_list"', "status", "remove", "governedBefore", "governedAfter",
    "NODE_PATH", "npm_config_registry", "sourceImports",
  ]) assert.ok(source.includes(marker), marker);
});

test("CI adds producer-separated Linux and macOS clean consumers without replacing existing gates", async () => {
  const workflow = await readFile(join(repositoryRoot, ".github", "workflows", "verify.yml"), "utf8");
  assert.match(workflow, /\n  verify:\n/);
  assert.match(workflow, /\n  journal-node-floor:\n/);
  assert.match(workflow, /\n  workspace-governance-bundle:/);
  assert.match(workflow, /\n  clean-bundled-consumer:/);
  assert.match(workflow, /needs: workspace-governance-bundle/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /macos-14/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.match(workflow, /actions\/download-artifact@/);
  const consumerJob = workflow.slice(workflow.indexOf("  clean-bundled-consumer:"));
  assert.doesNotMatch(consumerJob, /actions\/checkout@/);
  assert.match(consumerJob, /m4-consumer\.mjs/);
  assert.match(consumerJob, /NODE_PATH:/);
  assert.match(consumerJob, /127\.0\.0\.1:9\/unreachable/);
});
