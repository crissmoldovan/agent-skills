import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';

// Refuses to start without its configuration, then serves the registry.
loadConfig();
const registry = new URL('../generated/registry.json', import.meta.url);

createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(await readFile(registry));
}).listen(8080);
