import { canonicalJson, requireThat } from '../core.ts';

export type RefSelection = { mode: 'remote-default-at-apply' } |
  { mode: 'branch' | 'tag'; name: string; expectedOid: string | null };
export type AuthSelection = { mode: 'anonymous'; providerId: null } |
  { mode: 'provider'; providerId: string };
export interface ScaffoldRequestV2 {
  apiVersion: 'workspace-governance/scaffold-request-v2';
  repositoryId: string;
  ref: RefSelection;
  auth: AuthSelection;
  cloneProfile: 'github-normal-checkout-v1';
}
function object(value: unknown, keys: string[]): asserts value is Record<string, any> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireThat(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)));
}
function id(value: unknown): void {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 16384 &&
    !/[\x00-\x1f/\\]/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value));
}
function refName(name: unknown, branch: boolean): void {
  requireThat(typeof name === 'string' && name.length > 0 && name.length <= 16384 &&
    /^[\x21-\x7e]+$/.test(name) && !name.startsWith('-') && !(branch && name === 'HEAD') &&
    !name.includes('..') && !name.includes('@{') && !/[~^:?*\[\\]/.test(name) && !name.endsWith('.'));
  requireThat(name.split('/').every(part => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock')));
}
/** Local-only strict data admission; does not inspect any remote or provider. */
export function validateScaffoldRequest(input: unknown): ScaffoldRequestV2 {
  canonicalJson(input);
  object(input, ['apiVersion', 'repositoryId', 'ref', 'auth', 'cloneProfile']);
  requireThat(input.apiVersion === 'workspace-governance/scaffold-request-v2');
  requireThat(input.cloneProfile === 'github-normal-checkout-v1');
  id(input.repositoryId);
  const ref = input.ref;
  requireThat(ref !== null && typeof ref === 'object');
  if (ref.mode === 'remote-default-at-apply') object(ref, ['mode']);
  else {
    object(ref, ['mode', 'name', 'expectedOid']);
    requireThat(ref.mode === 'branch' || ref.mode === 'tag');
    refName(ref.name, ref.mode === 'branch');
    requireThat(ref.expectedOid === null || (typeof ref.expectedOid === 'string' && /^[a-f0-9]{40}$/.test(ref.expectedOid)));
  }
  object(input.auth, ['mode', 'providerId']);
  if (input.auth.mode === 'anonymous') requireThat(input.auth.providerId === null);
  else {
    requireThat(input.auth.mode === 'provider');
    id(input.auth.providerId);
  }
  return structuredClone(input) as ScaffoldRequestV2;
}
