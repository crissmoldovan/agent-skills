import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as stores from "../src/stores.ts";
import { example, envelope } from "./fixtures.ts";
test("A5 coherent defensive file/memory/custom snapshots, no fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "governance-"));
  try {
    const m: any = example();
    const memory = new stores.MemorySnapshotStore(m);
    m.nodes[0].slug = "changed";
    const a = await stores.loadSnapshot(memory);
    assert.equal(a.manifest.nodes[0].slug, "example");
    a.manifest.nodes[0].slug = "edited";
    assert.equal(
      (await stores.loadSnapshot(memory)).manifest.nodes[0].slug,
      "example",
    );
    const bytes = JSON.stringify(example(), null, 2);
    const file = join(root, "manifest.json");
    await writeFile(file, bytes);
    const s = await stores.loadSnapshot(new stores.FileSnapshotStore(file));
    assert.equal(s.revision, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(s.authorization, "advisory");
    const remote = {
      async readSnapshot() {
        return { ...envelope(), authorization: "enforced", subject: "alice" };
      },
    };
    assert.equal((await stores.loadSnapshot(remote)).subject, "alice");
    await assert.rejects(() =>
      stores.loadSnapshot({
        async readSnapshot() {
          throw new Error("private detail");
        },
      }),
    );
    for (const data of [
      { ...envelope(), complete: false },
      { ...envelope(), stale: true },
    ])
      await assert.rejects(() =>
        stores.loadSnapshot({
          async readSnapshot() {
            return data;
          },
        }),
      );
    await writeFile(file, "x".repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(() =>
      stores.loadSnapshot(new stores.FileSnapshotStore(file)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
