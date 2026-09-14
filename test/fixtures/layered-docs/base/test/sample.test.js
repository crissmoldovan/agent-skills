import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const TOKEN = 'example-token';

test('loadConfig requires both variables', () => {
  assert.throws(() => loadConfig({}));
  const config = loadConfig({ WIDGET_API_URL: 'https://example.com', WIDGET_API_TOKEN: TOKEN });
  assert.equal(config.retentionDays, 30);
});

test('loadConfig keeps the url it was given', () => {
  const config = loadConfig({ WIDGET_API_URL: 'https://example.com', WIDGET_API_TOKEN: TOKEN });
  assert.equal(config.url, 'https://example.com');
});
