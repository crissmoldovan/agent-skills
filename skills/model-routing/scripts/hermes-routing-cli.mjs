#!/usr/bin/env node
import process from 'node:process';
import { HermesRoutingAdapter } from './hermes-routing.mjs';

const commands = new Set(['setup', 'show', 'change', 'switch', 'clear', 'reset']);
function fail(message, status = 2) { const error = new Error(message); error.status = status; throw error; }
function parse(argv) {
  const [command, ...tail] = argv;
  if (!command || command === '--help') return { help: true };
  if (!commands.has(command)) fail(`unknown command: ${command}`);
  const options = { command };
  for (let index = 0; index < tail.length; index += 1) {
    const item = tail[index]; if (item === '--confirm') { options.confirm = true; continue; }
    if (!['--root', '--home'].includes(item)) fail(`unknown option: ${item}`);
    options[item.slice(2)] = tail[++index]; if (!options[item.slice(2)]) fail(`${item} requires a value`);
  }
  return options;
}
async function input(command) {
  if (command === 'show' || command === 'clear' || command === 'reset') return {};
  const text = await new Response(process.stdin).text(); if (!text.trim()) fail(`${command} requires JSON on stdin`);
  try { return JSON.parse(text); } catch { fail('payload must be valid JSON'); }
}
try {
  const options = parse(process.argv.slice(2));
  if (options.help) process.stdout.write('Usage: hermes-routing-cli.mjs <setup|show|change|switch|clear|reset> [--root DIR] [--home DIR] [--confirm]\nMutations require --confirm; setup/change/switch accept JSON on stdin.\n');
  else {
    if (options.command !== 'show' && options.confirm !== true) fail(`${options.command} would mutate Hermes config; re-run with --confirm`);
    const adapter = new HermesRoutingAdapter({ root: options.root, home: options.home }); const body = await input(options.command);
    let result;
    if (options.command === 'change') {
      const active = await adapter.show(); const roles = { ...active.store.store?.profiles[active.store.store.active]?.roles, [body.role]: body.binding };
      if (!active.store.store?.active) fail('no active profile to change'); result = await adapter.setup({ name: active.store.store.active, roles, confirm: true });
    } else result = await adapter[options.command]({ ...body, confirm: options.confirm });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.status ?? 1; }
