#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = readdirSync(join(root, "test"))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join(root, "test", name));
const outcome = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...tests],
  { cwd: root, stdio: "inherit" },
);
if (outcome.error) throw outcome.error;
if (outcome.signal) process.kill(process.pid, outcome.signal);
else process.exitCode = outcome.status ?? 1;
