#!/usr/bin/env node
import { runCli } from './cli.ts';

const result = await runCli(process.argv.slice(2), process.env);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.code);
