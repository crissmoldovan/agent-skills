import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { example } from "./fixtures.ts";
import { validateManifest, canonicalJson } from "../src/core.ts";
test("A1 packaged JSON Schema and runtime agree on representative structural cases", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../schemas/manifest.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const validate = new Ajv({ strict: false }).compile(schema);
  const largeMetadata: any = example();
  largeMetadata.metadata.list = Array(20001).fill(null);
  const good: any[] = [example(), largeMetadata];
  const withPolicy: any = example();
  withPolicy.policies = [
    {
      nodeId: "org",
      settings: [
        { key: "x", merge: "replace", value: null },
        { key: "list", merge: "append", value: [] },
      ],
      constraints: [
        { id: "required", key: "x", operator: "equals", value: null },
      ],
    },
  ];
  good.push(withPolicy);
  for (const m of good) {
    assert.equal(validate(m), true, JSON.stringify(validate.errors));
    assert.doesNotThrow(() => validateManifest(m));
  }
  for (const change of [
    (m: any) => (m.extra = 1),
    (m: any) => delete m.metadata,
    (m: any) => (m.nodes[0].visibility = { mode: "restricted", readers: [] }),
    (m: any) => (m.nodes[2].path = "not portable"),
    (m: any) => (m.nodes[2].remote = "git@github.com:example/api"),
    (m: any) => (m.nodes[1].kind = "session"),
    (m: any) => (m.nodes[1].slug = ".."),
    (m: any) =>
      (m.policies = [
        {
          nodeId: "org",
          settings: [{ key: "x", merge: "remove", value: 1 }],
          constraints: [],
        },
      ]),
    (m: any) =>
      (m.policies = [
        {
          nodeId: "org",
          settings: [{ key: "a.constructor", merge: "replace", value: 1 }],
          constraints: [],
        },
      ]),
  ]) {
    const m = example();
    change(m);
    assert.equal(validate(m), false);
    assert.throws(() => validateManifest(m));
  }
});
test("A1 canonical object order is Unicode codepoint not UTF-16", () => {
  assert.equal(
    canonicalJson({ "\u{10000}": 1, "\uE000": 2 }),
    '{"\uE000":2,"\u{10000}":1}',
  );
});
