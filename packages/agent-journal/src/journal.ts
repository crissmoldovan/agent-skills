import { appendFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalEvent } from './envelope.ts';
import { redact, type RedactionVerdict } from './redact.ts';

export interface SegmentJournalOptions {
  readonly root: string;
  readonly workspace: string;
  readonly machine: string;
  readonly session: string;
  readonly agent: string;
  readonly epoch: string;
  /** Rotate once the active segment passes this size. Small keeps the mutable surface small. */
  readonly rotateBytes?: number;
}

export interface AppendResult {
  readonly written: boolean;
  readonly path: string;
  readonly verdict: RedactionVerdict;
  readonly reason?: string;
}

const DEFAULT_ROTATE_BYTES = 524288;

export class SegmentJournal {
  readonly #options: SegmentJournalOptions;
  readonly #rotateBytes: number;
  #index = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: SegmentJournalOptions) {
    this.#options = options;
    this.#rotateBytes = options.rotateBytes ?? DEFAULT_ROTATE_BYTES;
  }

  get #dir(): string {
    const { root, workspace, machine, session } = this.#options;
    return join(root, 'workspaces', workspace, 'segments', machine, session);
  }

  segmentPath(): string {
    const { agent, epoch } = this.#options;
    return join(this.#dir, `${agent}.${epoch}.${this.#index}.jsonl`);
  }

  async #rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.segmentPath());
      if (info.size >= this.#rotateBytes) this.#index += 1;
    } catch {
      // No active segment yet; nothing to rotate.
    }
  }

  /**
   * Redaction is the only fail-closed path (spec 12). A failed verdict refuses the
   * write rather than writing a possible secret.
   */
  async append(event: JournalEvent): Promise<AppendResult> {
    const scrubbed = redact(event);
    if (scrubbed.verdict === 'failed') {
      return {
        written: false,
        path: this.segmentPath(),
        verdict: 'failed',
        ...(scrubbed.reason === undefined ? {} : { reason: scrubbed.reason }),
      };
    }

    let path = this.segmentPath();
    const write = this.#queue.then(async () => {
      await mkdir(this.#dir, { recursive: true });
      await this.#rotateIfNeeded();
      path = this.segmentPath();
      await appendFile(path, `${JSON.stringify(scrubbed.value)}\n`, 'utf8');
    });
    this.#queue = write.catch(() => undefined);
    await write;

    return { written: true, path, verdict: scrubbed.verdict };
  }
}
