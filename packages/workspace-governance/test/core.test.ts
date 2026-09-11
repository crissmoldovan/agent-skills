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
