import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScaffoldRequest } from '../src/setup/request.ts';

test('request rejects ref expressions, malformed identities and unknown strict fields without repair', () => {
  const badNames = ['', '-main', 'HEAD', '.hidden', 'feature/.hidden', 'x..y', 'x@{1}', 'x.lock/y',
    'x.lock', 'main^', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', '/main', 'main/', 'a//b', 'main.', 'a b', 'a\n', 'résumé'];
  for (const name of badNames)
    assert.throws(() => validateScaffoldRequest({ ...request, ref: { ...request.ref, name } }), { code: 'INVALID' }, JSON.stringify(name));
  for (const bad of [null, {}, { ...request, extra: true }, { ...request, apiVersion: 'workspace-governance/scaffold-request-v1' },
    { ...request, repositoryId: 'bad/id' }, { ...request, repositoryId: 'constructor' },
    { ...request, ref: { mode: 'remote-default-at-apply', name: 'main' } },
    { ...request, ref: { ...request.ref, expectedOid: 'A'.repeat(40) } },
    { ...request, ref: { ...request.ref, expectedOid: 'a'.repeat(39) } },
    { ...request, auth: { mode: 'anonymous', providerId: 'ambient' } },
    { ...request, auth: { mode: 'provider', providerId: null } },
    { ...request, auth: { mode: 'provider', providerId: 'example', token: 'example-token' } },
    { ...request, cloneProfile: 'github-anonymous-full-v1' }])
    assert.throws(() => validateScaffoldRequest(bad), { code: 'INVALID' });
});

const request = { apiVersion: 'workspace-governance/scaffold-request-v2', repositoryId: 'example-repo',
  ref: { mode: 'branch', name: 'feature/api', expectedOid: null },
  auth: { mode: 'provider', providerId: 'example-provider' }, cloneProfile: 'github-normal-checkout-v1' };

test('normal request preserves explicit branch, peeled tag pin, default and auth selections', async () => {
  const modulePath = '../src/setup/request.ts';
  const { validateScaffoldRequest } = await import(modulePath);
  for (const ref of [request.ref, { mode: 'tag', name: 'release/v1', expectedOid: 'a'.repeat(40) }, { mode: 'remote-default-at-apply' }]) {
    for (const auth of [request.auth, { mode: 'anonymous', providerId: null }]) {
      const input = { ...request, ref, auth };
      assert.deepEqual(validateScaffoldRequest(input), input);
    }
  }
});
