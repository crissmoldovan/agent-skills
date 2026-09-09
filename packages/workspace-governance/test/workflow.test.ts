import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/core.ts";
import { example, envelope } from "./fixtures.ts";
test("A3 selected workflow overlays replace and remove stable steps", () => {
  const m: any = example();
  m.workflows = [
    {
      nodeId: "org",
      id: "feature",
      settings: [{ key: "x", merge: "replace", value: 1 }],
      constraints: [],
      steps: [
        { id: "a", action: "test", inputs: { old: true } },
        { id: "b", action: "build", inputs: {} },
      ],
    },
    {
      nodeId: "repo",
      id: "feature",
      settings: [{ key: "x", merge: "replace", value: 2 }],
      constraints: [],
      steps: [
        { id: "a", action: "new", inputs: {} },
        { id: "b", remove: true },
      ],
    },
  ];
  m.policies = [
    {
      nodeId: "repo",
      settings: [{ key: "x", merge: "replace", value: 3 }],
      constraints: [],
    },
  ];
  const r = core.resolvePolicy(envelope(m), "repo", "reader", {
    workflowId: "feature",
  });
  assert.deepEqual(r.workflow, {
    id: "feature",
    steps: [{ id: "a", action: "new", inputs: {} }],
    executable: false,
  });
  assert.equal(r.values.x, 3);
  assert.equal(r.provenance[0].workflowId, "feature");
  assert.equal(
    core.resolvePolicy(envelope(m), "repo", "reader").workflow,
    null,
  );
  assert.throws(() =>
    core.resolvePolicy(envelope(m), "repo", "reader", { workflowId: "absent" }),
  );
  m.workflows[1].steps = [{ id: "missing", remove: true }];
  assert.throws(() =>
    core.resolvePolicy(envelope(m), "repo", "reader", {
      workflowId: "feature",
    }),
  );
});
test("A4 visibility intersects; fixed projection and subject binding deny safely", () => {
  const m: any = example();
  m.nodes[0].visibility = { mode: "restricted", readers: ["alice"] };
  m.nodes[2].visibility = { mode: "public", readers: [] };
  m.nodes[2].metadata = { secret: "not emitted" };
  assert.deepEqual(core.visibleNodes(envelope(m), "bob"), []);
  assert.equal(
    JSON.stringify(core.visibleNodes(envelope(m), "alice")).includes("secret"),
    false,
  );
  const errors = ["repo", "absent"].map((n) => {
    try {
      core.resolvePolicy(envelope(m), n, "bob");
    } catch (e) {
      return JSON.stringify({
        code: (e as any).code,
        message: (e as Error).message,
      });
    }
  });
  assert.equal(errors[0], errors[1]);
  assert.throws(() =>
    core.visibleNodes(
      { ...envelope(m), authorization: "enforced", subject: "alice" },
      "bob",
    ),
  );
  for (const edit of [
    { stale: true },
    { complete: false },
    { coverage: "filtered" },
    { authorization: "enforced", subject: null },
  ])
    assert.throws(() => core.validateSnapshot({ ...envelope(m), ...edit }));
});
