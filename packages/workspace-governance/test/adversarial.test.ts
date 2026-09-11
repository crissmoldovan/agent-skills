import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalRemote,
  validateManifest,
  canonicalJson,
  resolvePolicy,
} from "../src/core.ts";
import { example, envelope } from "./fixtures.ts";
test("A1 literal newlines, sparse arrays and synthetic provenance aliases reject", () => {
  assert.throws(() => canonicalRemote("https://github.com/example/api\n"));
  const m: any = example();
  m.nodes[1].slug = "service\n";
  assert.throws(() => validateManifest(m));
  assert.throws(() => canonicalJson(Array(2)));
  m.nodes[1].slug = "service";
  m.nodes[0].id = "$defaults";
  m.nodes[1].parentId = "$defaults";
  assert.throws(() => validateManifest(m));
});
test("A2 equals and forbidden constraints remain monotonic through defaults/invocation", () => {
  const m: any = example();
  m.policies = [
    {
      nodeId: "org",
      settings: [],
      constraints: [
        { id: "lock", key: "lock", operator: "equals", value: true },
        {
          id: "forbidden",
          key: "optional",
          operator: "forbidden-values",
          value: [false],
        },
      ],
    },
  ];
  assert.throws(() => resolvePolicy(envelope(m), "repo", "reader"), {
    code: "CONSTRAINT",
  });
  assert.equal(
    resolvePolicy(envelope(m), "repo", "reader", {
      defaults: [{ key: "lock", merge: "replace", value: true }],
    }).values.lock,
    true,
  );
  assert.throws(
    () =>
      resolvePolicy(envelope(m), "repo", "reader", {
        defaults: [{ key: "lock", merge: "replace", value: true }],
        invocation: [{ key: "lock", merge: "remove" }],
      }),
    { code: "CONSTRAINT" },
  );
});
