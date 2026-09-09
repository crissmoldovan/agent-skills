import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/core.ts";
import { example, envelope } from "./fixtures.ts";
test("A2 settings merge algebra, constraints and operation provenance", () => {
  const m: any = example();
  m.policies = [
    {
      nodeId: "org",
      settings: [
        { key: "obj", merge: "deep-merge", value: { a: 1, n: { b: true } } },
        { key: "list", merge: "append", value: [1] },
        { key: "set", merge: "set-union", value: [{ a: 1 }] },
        { key: "items", merge: "keyed-merge", value: [{ id: "a", v: 1 }] },
        { key: "gone", merge: "replace", value: null },
      ],
      constraints: [
        {
          id: "required",
          key: "list",
          operator: "required-members",
          value: [1],
        },
      ],
    },
    {
      nodeId: "repo",
      settings: [
        { key: "obj", merge: "deep-merge", value: { n: { b: false } } },
        { key: "list", merge: "append", value: [2] },
        { key: "set", merge: "set-union", value: [{ a: 1 }, 2] },
        {
          key: "items",
          merge: "keyed-merge",
          value: [
            { id: "a", v: 2 },
            { id: "b", v: 3 },
          ],
        },
        { key: "gone", merge: "remove" },
      ],
      constraints: [],
    },
  ];
  const r = core.resolvePolicy(envelope(m), "repo", "reader");
  assert.deepEqual(r.values, {
    obj: { a: 1, n: { b: false } },
    list: [1, 2],
    set: [{ a: 1 }, 2],
    items: [
      { id: "a", v: 2 },
      { id: "b", v: 3 },
    ],
  });
  assert.equal(r.provenance.length, 10);
  assert.equal(r.provenance.at(-1)?.merge, "remove");
  assert.equal(r.constraints[0].nodeId, "org");
  for (const s of [
    { key: "list", merge: "replace", value: [] },
    { key: "obj", merge: "deep-merge", value: { a: "bad" } },
    { key: "missing", merge: "remove" },
    { key: "obj.a", merge: "replace", value: 1 },
  ])
    assert.throws(() =>
      core.resolvePolicy(envelope(m), "repo", "reader", {
        invocation: [s] as any,
      }),
    );
  assert.equal(
    core.resolvePolicy(envelope(), "repo", "reader", {
      defaults: [{ key: "x", merge: "replace", value: 1 }],
      invocation: [{ key: "x", merge: "replace", value: 2 }],
    }).values.x,
    2,
  );
});
