import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * A scratch directory that local discovery will accept as a scan root.
 *
 * `mkdtemp(join(tmpdir(), ...))` hands back `/var/folders/...` on macOS, and
 * `/var` is itself a symlink to `/private/var`. Discovery documents that a root
 * must be an existing real path with no symlink ancestors (README "Discovery and
 * preview limitations", specification S8, SKILL.md safety boundaries), so it
 * refuses the raw fixture path with INVALID before the test reaches anything it
 * means to assert. Resolve the directory the way a caller has to, and the fixture
 * stops depending on whether the platform's temporary directory is canonical.
 *
 * Only roots handed to discovery or to `--root` need this; scratch directories
 * that merely hold a manifest file are read by path and are unaffected.
 */
export const scratchRoot = async (prefix: string): Promise<string> =>
  realpath(await mkdtemp(join(tmpdir(), prefix)));
export const example = () => ({
  apiVersion: "workspace-governance/v1",
  authorityId: "example",
  nodes: [
    {
      id: "org",
      kind: "organization",
      slug: "example",
      parentId: null,
      visibility: { mode: "public", readers: [] },
    },
    { id: "project", kind: "project", slug: "service", parentId: "org" },
    {
      id: "repo",
      kind: "repository",
      slug: "api",
      parentId: "project",
      remote: "https://github.com/example/api",
    },
  ],
  policies: [],
  workflows: [],
  metadata: {},
});
export const envelope = (m: unknown = example()) => ({
  manifest: m,
  revision: "r1",
  complete: true,
  stale: false,
  authorization: "advisory",
  coverage: "authority",
  subject: null,
});
