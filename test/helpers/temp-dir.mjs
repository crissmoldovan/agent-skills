import { chmodSync, readdirSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Temporary directories that remove themselves.
 *
 * `node --test` runs every test file in its own process, so a directory registered here is removed
 * when that file's process exits — after all of its tests have run, including a test that reads a
 * fixture an earlier one left behind. Before this, the suite created its fixtures with a bare
 * `mkdtemp` and never removed them: one machine had collected about 1.3 million directories,
 * roughly 17 GB, in the OS temp folder before anyone looked.
 */

const pending = new Set();
let armed = false;

// Some tests chmod a fixture directory read-only to prove a writer refuses it. A recursive remove
// cannot empty a directory it may not write to, so give write permission back before retrying.
function makeWritable(dir) {
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) makeWritable(path.join(dir, entry.name));
  }
}

function removeAll() {
  for (const dir of pending) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      try {
        makeWritable(dir);
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Still unremovable: leave it rather than turning a run whose tests all passed into a
        // failure at exit.
      }
    }
  }
  pending.clear();
}

/** Registers `dir` for removal when this test process exits, and returns it unchanged. */
export function removeOnExit(dir) {
  if (!armed) {
    armed = true;
    process.once('exit', removeAll);
  }
  pending.add(dir);
  return dir;
}

/** `mkdtemp` under the OS temp directory; the directory is removed when this test process exits. */
export async function tempDir(prefix) {
  return removeOnExit(await mkdtemp(path.join(tmpdir(), prefix)));
}
