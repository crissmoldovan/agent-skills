#!/usr/bin/env node
import { runTestSuite } from './test-runner.mjs';

const outcome = await runTestSuite();
if (outcome.signal) process.kill(process.pid, outcome.signal);
else process.exitCode = outcome.status ?? 1;
