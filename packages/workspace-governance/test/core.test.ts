import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/core.ts";
import { example } from "./fixtures.ts";
test("A1 bounded duplicate-safe JSON and canonical identities", () => {
  assert.equal(core.canonicalJson({ z: -0, a: [2, 1] }), '{"a":[2,1],"z":0}');
  for (const s of [
    '{"a":1,"a":2}',
    '{"x":{"constructor":1}}',
    '{"a":1e999}',
    "[1,]",
  ])
    assert.throws(() => core.parseJson(s));
  assert.deepEqual(core.parseJson('{"a":[true,null,2]}'), {
    a: [true, null, 2],
  });
  for (const s of [
    "git@github.com:Example/Api.git",
    "ssh://git@github.com/Example/Api.git",
    "https://github.com/Example/Api.git/",
  ])
    assert.equal(core.canonicalRemote(s), "https://github.com/example/api");
  for (const s of [
    " https://github.com/example/api",
    "https://github.com/example/api?x",
    "https://github.com/a--b/api",
    "https://github.com/example/a.",
    "file:///tmp/a",
  ])
    assert.throws(() => core.canonicalRemote(s));
  assert.equal(core.validateManifest(example()).nodes.length, 3);
  for (const edit of [
    (m: any) => (m.nodes[0].visibility = undefined),
    (m: any) => (m.revision = "x"),
    (m: any) => (m.nodes[2].remote = "git@github.com:example/api"),
    (m: any) => (m.nodes[1].parentId = "repo"),
    (m: any) => (m.nodes[2].slug = "CON"),
    (m: any) => m.nodes.push({ ...m.nodes[2] }),
  ]) {
    const m = example();
    edit(m);
    assert.throws(() => core.validateManifest(m));
  }
});

test("A1 domain and source namespace form a valid hierarchy", () => {
  const manifest = {
    apiVersion: "workspace-governance/v1",
    authorityId: "taxonomy-example",
    nodes: [
      { id: "person", kind: "user", slug: "criss", parentId: null, visibility: { mode: "public", readers: [] } },
      { id: "cue", kind: "domain", slug: "cueplusplus", parentId: "person" },
      { id: "cue-github", kind: "namespace", slug: "cueplusplus", parentId: "cue" },
      { id: "agent-tools", kind: "area", slug: "agent-tools", parentId: "cue-github" },
      { id: "reactor-project", kind: "project", slug: "reactor", parentId: "agent-tools" },
      { id: "reactor-repo", kind: "repository", slug: "reactor", parentId: "reactor-project", remote: "https://github.com/cueplusplus/reactor" },
    ],
    policies: [],
    workflows: [],
    metadata: {},
  };

  assert.doesNotThrow(() => core.validateManifest(manifest));
});

test("A1 domain and source namespace reject illegal roots and parents", () => {
  const cases = [
    [
      { id: "cue", kind: "domain", slug: "cue", parentId: null, visibility: { mode: "public", readers: [] } },
    ],
    [
      { id: "person", kind: "user", slug: "person", parentId: null, visibility: { mode: "public", readers: [] } },
      { id: "source", kind: "namespace", slug: "source", parentId: "person" },
    ],
    [
      { id: "legacy", kind: "organization", slug: "legacy", parentId: null, visibility: { mode: "public", readers: [] } },
      { id: "cue", kind: "domain", slug: "cue", parentId: "legacy" },
    ],
    [
      { id: "legacy", kind: "organization", slug: "legacy", parentId: null, visibility: { mode: "public", readers: [] } },
      { id: "source", kind: "namespace", slug: "source", parentId: "legacy" },
    ],
  ];

  for (const nodes of cases) {
    assert.throws(() => core.validateManifest({
      apiVersion: "workspace-governance/v1",
      authorityId: "invalid-taxonomy",
      nodes,
      policies: [],
      workflows: [],
      metadata: {},
    }), { code: "INVALID" });
  }
});

test("A1 area and project are optional below a source namespace", () => {
  const manifest = {
    apiVersion: "workspace-governance/v1",
    authorityId: "optional-taxonomy-example",
    nodes: [
      { id: "person", kind: "user", slug: "criss", parentId: null, visibility: { mode: "public", readers: [] } },
      { id: "personal", kind: "domain", slug: "personal", parentId: "person" },
      { id: "github", kind: "namespace", slug: "crissmoldovan", parentId: "personal" },
      { id: "direct-repo", kind: "repository", slug: "notes", parentId: "github", remote: "https://github.com/example/notes" },
      { id: "tools", kind: "area", slug: "tools", parentId: "github" },
      { id: "area-repo", kind: "repository", slug: "scripts", parentId: "tools", remote: "https://github.com/example/scripts" },
      { id: "website", kind: "project", slug: "website", parentId: "github" },
      { id: "project-repo", kind: "repository", slug: "site", parentId: "website", remote: "https://github.com/example/site" },
    ],
    policies: [],
    workflows: [],
    metadata: {},
  };

  assert.doesNotThrow(() => core.validateManifest(manifest));
});

test("A1 display labels preserve exact taxonomy names without changing path slugs", () => {
  const manifest = {
    apiVersion: "workspace-governance/v1",
    authorityId: "labeled-taxonomy-example",
    nodes: [
      { id: "person", kind: "user", slug: "criss", label: "Cristian", parentId: null, visibility: { mode: "public", readers: [] } },
      { id: "cue", kind: "domain", slug: "cue", label: "CUE++", parentId: "person" },
      { id: "rgc-labs", kind: "namespace", slug: "rgc-labs", label: "RGC-LABS", parentId: "cue" },
      { id: "brand-assets", kind: "project", slug: "brand-assets", label: "Brand Assets", parentId: "rgc-labs" },
      { id: "repo", kind: "repository", slug: "public-assets", label: "Public Assets", parentId: "brand-assets", remote: "https://github.com/rgc-labs/public-assets" },
    ],
    policies: [],
    workflows: [],
    metadata: {},
  };

  const validated = core.validateManifest(manifest);
  assert.equal(validated.nodes.find((node) => node.id === "cue")?.label, "CUE++");
  assert.equal(validated.nodes.find((node) => node.id === "brand-assets")?.slug, "brand-assets");
});

test("A1 display labels reject surrounding whitespace and control characters", () => {
  for (const label of [" CUE++", "CUE++ ", "Brand\nAssets", "Brand\u007fAssets"]) {
    const manifest: any = example();
    manifest.nodes[0].label = label;
    assert.throws(() => core.validateManifest(manifest), { code: "INVALID" });
  }
});
