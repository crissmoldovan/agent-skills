#!/usr/bin/env node
import { runCli } from './cli.ts';

const result = await runCli(process.argv.slice(2), process.env);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
// Set the code and let Node exit once the streams drain. process.exit() here
// can truncate output on a pipe, where writes are asynchronous — and `coverage`
// emits the largest payload this CLI produces.
process.exitCode = result.code;
