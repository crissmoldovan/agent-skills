import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  GovernanceError,
  requireThat,
  validateManifest,
  validateSnapshot,
  parseJson,
  digest,
} from "./core.ts";
import type { Manifest, Snapshot } from "./core.ts";
export interface SnapshotStore {
  readSnapshot(): Promise<unknown>;
}
const envelope = (manifest: Manifest, revision: string): Snapshot => ({
  manifest,
  revision,
  complete: true,
  stale: false,
  authorization: "advisory",
  coverage: "authority",
  subject: null,
});
export class MemorySnapshotStore implements SnapshotStore {
  #snapshot: Snapshot;
  constructor(manifest: unknown) {
    const m = validateManifest(manifest);
    this.#snapshot = envelope(m, digest(m));
  }
  async readSnapshot(): Promise<Snapshot> {
    return structuredClone(this.#snapshot);
  }
}
/** Reads at most max+1 bytes from one regular file handle, including growth races. */
export async function readJsonFile(
  path: string,
): Promise<{ text: string; value: unknown }> {
  try {
    const file = await open(path, "r");
    try {
      const stat = await file.stat();
      requireThat(stat.isFile() && stat.size <= 2 * 1024 * 1024);
      const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
      let length = 0;
      while (length < bytes.length) {
        const r = await file.read(bytes, length, bytes.length - length, null);
        if (r.bytesRead === 0) break;
        length += r.bytesRead;
      }
      requireThat(length < bytes.length);
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes.subarray(0, length));
      return { text, value: parseJson(text) };
    } finally {
      await file.close();
    }
  } catch (e) {
    if (e instanceof GovernanceError) throw e;
    throw new GovernanceError();
  }
}
export class FileSnapshotStore implements SnapshotStore {
  #path: string;
  constructor(path: string) {
    this.#path = path;
  }
  async readSnapshot(): Promise<Snapshot> {
    const { text, value } = await readJsonFile(this.#path);
    return envelope(
      validateManifest(value),
      createHash("sha256").update(text, "utf8").digest("hex"),
    );
  }
}
export async function loadSnapshot(store: SnapshotStore): Promise<Snapshot> {
  try {
    return validateSnapshot(await store.readSnapshot());
  } catch (e) {
    if (e instanceof GovernanceError) throw e;
    throw new GovernanceError("TOOL_FAILURE");
  }
}
