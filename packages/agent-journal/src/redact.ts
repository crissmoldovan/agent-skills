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

/**
 * Patterns applied to string CONTENT rather than to key names.
 *
 * NO `\b` ANCHORS. `_` is a word character, so no boundary exists between an
 * alphanumeric and an underscore — and `_` is precisely what sits either side of
 * a credential in the two places credentials appear in prose: an environment
 * assignment (`GITHUB_TOKEN=ghp_...`) and an annotated note (`ghp_..._rotated`).
 * With `\b` on both ends every one of these patterns silently failed to fire
 * there, the verdict came back `clean`, and the secret was written byte-for-byte.
 * Each prefix is distinctive enough to stand alone, and the runs are greedy, so
 * dropping the anchors costs nothing but over-redaction — which is the direction
 * a fail-closed rule is supposed to err in.
 */
const PATTERNS: readonly { name: string; re: RegExp; keepPrefix?: true }[] = [
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{16,}/g },
  { name: 'openai-key', re: /sk-[A-Za-z0-9_-]{16,}/g },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{16,}/gi },
  // Every pattern above matches a secret by its own SHAPE. This one matches by
  // the name it is assigned to, because the observation plane changed what
  // reaches this function: previously only agent prose, now every Bash command
  // line and tool response, verbatim. A secret with no distinctive prefix --
  // `aws_secret_access_key=wJalrXUt...` -- has no shape to catch, and went to
  // disk byte-for-byte. Deliberately narrow: it requires a secret-ish NAME, an
  // `=` or `:`, and 8+ non-space characters, so an ordinary `--flag=value` or
  // `key=1` is untouched.
  { name: 'assigned-secret', re: /((?:secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|auth)[A-Za-z0-9_-]*\s*[:=]\s*)(?:"|')?[^\s"';,]{8,}/gi, keepPrefix: true },

  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'home-path', re: /\/(?:Users|home)\/[^/\s"']+/g },
  { name: 'home-path-win', re: /[A-Za-z]:\\Users\\[^\\\s"']+/g },
];

const DEFAULT_MAX_BYTES = 262144;
const DEFAULT_MAX_DEPTH = 32;

function scrub(input: string, hits: string[], path: string): string {
  let out = input;
  for (const { name, re, keepPrefix } of PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    hits.push(`${path}:${name}`);
    // keepPrefix leaves the captured NAME in place: `aws_secret_access_key=
    // [REDACTED]` tells a reader which credential was there, which is the whole
    // value of a journal, while `[REDACTED]` alone loses it.
    out = keepPrefix ? out.replace(re, '$1[REDACTED]')
      : name === 'home-path' ? out.replace(re, '/[REDACTED]')
      : out.replace(re, '[REDACTED]');
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
    const here = path || '$';
    if (typeof node === 'string') return scrub(node, hits, here);
    if (node === null || typeof node !== 'object') return node;

    // Boxed primitives. Without this, Object.entries decomposes a boxed String
    // into one entry PER CHARACTER, every pattern needs contiguous characters,
    // nothing matches, and a secret returns verdict 'clean' fully intact.
    if (node instanceof String) return scrub(node.valueOf(), hits, here);
    if (node instanceof Number || node instanceof Boolean) return node.valueOf();

    // Binary. Buffer is what execSync returns by default, so raw captured
    // command output reaches here routinely. Decode and scan it as text.
    if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) {
      const view = node instanceof ArrayBuffer
        ? new Uint8Array(node)
        : new Uint8Array((node as ArrayBufferView).buffer,
                         (node as ArrayBufferView).byteOffset,
                         (node as ArrayBufferView).byteLength);
      return scrub(new TextDecoder().decode(view), hits, here);
    }

    // Align the scan with the byte-budget pre-check, which uses JSON.stringify
    // semantics. Without this a Date scans as {} — no own enumerable keys — and
    // reports 'clean' for content that was never examined.
    const toJson = (node as { toJSON?: unknown }).toJSON;
    if (typeof toJson === 'function') {
      return walk((toJson as () => unknown).call(node), depth + 1, path);
    }

    if (Array.isArray(node)) return node.map((item, i) => walk(item, depth + 1, `${path}[${i}]`));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(v, depth + 1, path ? `${path}.${k}` : k);
    }
    return out;
  }

  try {
    const scrubbed = walk(value, 0, '');
    return { value: scrubbed, verdict: hits.length > 0 ? 'redacted' : 'clean', hits };
  } catch (error) {
    // hits is reset: a failed verdict yields no usable value, so reporting
    // partial hits would mislead any caller that branches on hits.length.
    hits.length = 0;
    return { value: undefined, verdict: 'failed', hits, reason: (error as Error).message };
  }
}
