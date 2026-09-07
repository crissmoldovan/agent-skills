export type RedactionVerdict = 'clean' | 'redacted' | 'failed';

export interface RedactionResult {
  readonly value: unknown;
  readonly verdict: RedactionVerdict;
  readonly hits: readonly string[];
  readonly reason?: string;
}

export interface RedactOptions {
  /** Maximum serialized size scanned. Exceeding it is a failure, never a silent pass. */
  readonly maxBytes?: number;
  /** Maximum object depth traversed. */
  readonly maxDepth?: number;
}

/** Patterns applied to string CONTENT rather than to key names. */
const PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi },
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'home-path', re: /\/(?:Users|home)\/[^/\s"']+/g },
];

const DEFAULT_MAX_BYTES = 262144;
const DEFAULT_MAX_DEPTH = 32;

function scrub(input: string, hits: string[], path: string): string {
  let out = input;
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    hits.push(`${path}:${name}`);
    out = name === 'home-path' ? out.replace(re, '/[REDACTED]') : out.replace(re, '[REDACTED]');
  }
  return out;
}

export function redact(value: unknown, options: RedactOptions = {}): RedactionResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const hits: string[] = [];

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? '';
  } catch (error) {
    return {
      value: undefined,
      verdict: 'failed',
      hits: [],
      reason: `unscannable value: ${(error as Error).message}`,
    };
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return {
      value: undefined,
      verdict: 'failed',
      hits: [],
      reason: `value exceeds the ${maxBytes}-byte scan budget`,
    };
  }

  function walk(node: unknown, depth: number, path: string): unknown {
    if (depth > maxDepth) throw new RangeError(`depth exceeds ${maxDepth} at ${path}`);
    if (typeof node === 'string') return scrub(node, hits, path || '$');
    if (Array.isArray(node)) return node.map((item, i) => walk(item, depth + 1, `${path}[${i}]`));
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v, depth + 1, path ? `${path}.${k}` : k);
      }
      return out;
    }
    return node;
  }

  try {
    const scrubbed = walk(value, 0, '');
    return { value: scrubbed, verdict: hits.length > 0 ? 'redacted' : 'clean', hits };
  } catch (error) {
    return { value: undefined, verdict: 'failed', hits, reason: (error as Error).message };
  }
}
