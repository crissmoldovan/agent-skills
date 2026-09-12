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
