import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createPortableDocument,
  parsePortableText,
  portableCatalog,
  rfc8785Canonicalize,
  validatePortableDocument,
} from "../src/portable.ts";
import type { CatalogDocument } from "../src/v2-model.ts";

const catalog = (): CatalogDocument => ({
  schemaVersion: 2,
  documentType: "workspacectl/catalog",
  groups: [
    { id: "org", kind: "organization", name: "Ångström", slug: "org", parentId: null, metadata: {} },
    { id: "project", kind: "project", name: "Project", slug: "project", parentId: "org", metadata: {} },
  ],
  repositories: [
    { id: "repo-a", remote: "https://github.com/acme/a.git", sourceId: "source", primaryGroupId: "project", memberOf: [], aliases: ["alpha"], classification: "confirmed", metadata: {} },
    { id: "repo-b", remote: "https://github.com/acme/b.git", sourceId: "source", primaryGroupId: null, memberOf: [], aliases: [], classification: "unclassified", metadata: {} },
  ],
  sources: [{ id: "source", provider: "github", owner: "acme", ownerType: "organization", include: ["*"], exclude: [], proposedDefaultGroupId: "project", metadata: {} }],
  policies: [{
    scope: { kind: "repository", id: "repo-a" }, settings: {}, operations: [], constraints: [], instructions: [],
    knowledge: [{ id: "guide", reference: "/source/home/guide.md", required: true }], skills: [],
    provenance: { sourceRepository: "repo-a", sourcePath: "/source/home/policy.json", sourceRevision: "abc", contentDigest: "a".repeat(64), declaredScope: { kind: "repository", id: "repo-a" } },
  }],
  workflows: [{
    id: "build", scope: { kind: "repository", id: "repo-a" }, inputs: [], outputs: [{ id: "artifact", required: true }], settings: {}, operations: [], constraints: [],
    steps: [
      { id: "run", type: "command", needs: [], configuration: { executable: "/bin/sh", argv: ["-c", "/source/home/script"], inputFiles: [{ argvIndex: 1 }], cwd: "workspace", environment: ["TOKEN"], timeoutMs: 1000, expectedExit: 0 }, sideEffect: "workspace", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: true },
      { id: "verify", type: "verify", needs: ["run"], configuration: { checks: [{ type: "file", path: "artifact.txt", content: "ok", outputId: "artifact" }] }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
    ],
  }],
  metadata: { note: "portable" },
});
const resign = (document: any) => {
  const unsigned = structuredClone(document); delete unsigned.digest;
  document.digest = `sha256:${createHash("sha256").update(rfc8785Canonicalize(unsigned)).digest("hex")}`;
};
const appendDuplicateExpectedOutput = (document: any, workflowIndex = 0, stepIndex = 0) => {
  const workflow = document.logical.workflows[workflowIndex];
  const step = workflow.steps[stepIndex];
  const field = `configuration.expectedOutputs.${step.configuration.expectedOutputs.length}.path`;
  const ownerId = `${workflow.scope.kind}:${workflow.scope.id}:${workflow.id}:${step.id}`;
  const id = `binding-${createHash("sha256").update(`path\0workflow-step\0${ownerId}\0${field}`).digest("hex").slice(0, 24)}`;
  const dependant = { kind: "workflow-step", id: ownerId, field };
  step.configuration.expectedOutputs.push({ id: step.configuration.expectedOutputs[0].id, path: `needs-binding:${id}` });
  const priorIndex = document.unresolvedBindings.findIndex((binding: any) =>
    binding.provenance.ownerId === ownerId && binding.provenance.field === `configuration.expectedOutputs.${step.configuration.expectedOutputs.length - 2}.path`);
  document.unresolvedBindings.splice(priorIndex + 1, 0, {
    id, status: "needs-binding", sourceKind: "path",
    provenance: { ownerKind: "workflow-step", ownerId, field },
    dependants: [dependant],
  });
};

test("portable export transforms authority and verifies RFC8785 digest", () => {
  const exported = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "0.3.0-dev");
  assert.equal(exported.format, "workspacectl-portable/1");
  assert.match(exported.digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(exported.unresolvedBindings.length >= 7);
  assert.ok(exported.unresolvedBindings.every(binding => binding.dependants.length > 0));
  assert.ok(!JSON.stringify(exported).includes("/source/home"));
  assert.deepEqual((exported.logical.workflows[0].steps[0] as any).configuration.inputFiles, [{ argvIndex: 1 }]);
  assert.deepEqual(exported.notCarried, [
    "config", "local-state", "checkout-paths", "workspace-ids", "native-project-ids", "coordination-bindings",
    "trusted-roots", "approvals", "plans", "journals", "runs", "locks", "observations", "receipts",
    "cached-state", "executable-fingerprints", "credentials", "environment-values",
  ]);
  assert.deepEqual(validatePortableDocument(structuredClone(exported)), exported);
  assert.deepEqual(portableCatalog(exported).groups.map(group => group.id), ["org", "project"]);
});

test("RFC8785 is key-order stable, UTF-16 ordered, and semantic changes mismatch", () => {
  assert.equal(rfc8785Canonicalize({ b: 1, a: "é", "😀": 2, "\uffff": 3 }), rfc8785Canonicalize({ "\uffff": 3, "😀": 2, a: "é", b: 1 }));
  const exported = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "0.3.0-dev");
  const reordered = JSON.parse(JSON.stringify(exported));
  assert.deepEqual(validatePortableDocument(reordered), exported);
  reordered.logical.metadata.note = "changed";
  assert.throws(() => validatePortableDocument(reordered), (error: any) => error.code === "INVALID_CONFIG");
  assert.throws(() => rfc8785Canonicalize({ invalid: "\ud800" }), (error: any) => error.code === "INVALID_CONFIG");
});

test("portable validation refuses dangling needs, alias ambiguity, and unknown authority mappings", () => {
  const dangling = catalog();
  (dangling.workflows[0].steps[1] as any).needs = ["missing"];
  assert.throws(() => createPortableDocument(dangling, "2026-09-26T00:00:00.000Z", "x"), (error: any) => ["INVALID_CONFIG", "POLICY_CONFLICT"].includes(error.code));
  const ambiguous = catalog();
  ambiguous.repositories[1].aliases = ["ALPHA"];
  assert.throws(() => createPortableDocument(ambiguous, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG");
  const unsupported = catalog();
  (unsupported.workflows[0].steps[0] as any).type = "custom.exec";
  assert.throws(() => createPortableDocument(unsupported, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "UNSUPPORTED");
});

test("portable command inputFiles refuse malformed, duplicate, out-of-range, and non-absolute argv references", () => {
  for (const inputFiles of [
    [{ argvIndex: -1 }],
    [{ argvIndex: 2 }],
    [{ argvIndex: 1 }, { argvIndex: 1 }],
    [{ argvIndex: 0 }],
    [{ argvIndex: "1" }],
    [{ argvIndex: 1, path: "/source/home/script" }],
  ]) {
    const malformed = catalog() as any;
    malformed.workflows[0].steps[0].configuration.inputFiles = inputFiles;
    assert.throws(() => createPortableDocument(malformed, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG", JSON.stringify(inputFiles));
  }
});

test("incoming portable validation reclassifies authority and graph semantics instead of trusting its digest", () => {
  const rawAuthority: any = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "x");
  rawAuthority.logical.workflows[0].steps[0].configuration.executable = "/malicious/source/tool";
  rawAuthority.unresolvedBindings = rawAuthority.unresolvedBindings.filter((binding: any) => binding.sourceKind !== "executable");
  resign(rawAuthority);
  assert.throws(() => validatePortableDocument(rawAuthority), (error: any) => error.code === "INVALID_CONFIG");

  const cyclic: any = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "x");
  cyclic.logical.workflows[0].steps[0].needs = ["verify"];
  resign(cyclic);
  assert.throws(() => validatePortableDocument(cyclic), (error: any) => ["INVALID_CONFIG", "POLICY_CONFLICT"].includes(error.code));
});

test("portable provenance references resolve to carried repositories with exact policy and workflow scopes", () => {
  const valid = catalog();
  valid.workflows[0].provenance = {
    sourceRepository: "repo-b", sourcePath: "/source/workflow.json",
    sourceRevision: "rev", contentDigest: "b".repeat(64), declaredScope: { kind: "repository", id: "repo-a" },
  };
  const exported = createPortableDocument(valid, "2026-09-26T00:00:00.000Z", "x");
  assert.equal(exported.logical.policies[0].provenance?.sourceRepository, "repo-a");
  assert.equal(exported.logical.workflows[0].provenance?.sourceRepository, "repo-b");
  const reexported = createPortableDocument(portableCatalog(exported), "2026-09-26T00:01:00.000Z", "x");
  assert.deepEqual(reexported.logical, exported.logical);
  assert.deepEqual(reexported.unresolvedBindings, exported.unresolvedBindings);

  for (const external of ["https://github.com/external/rules.git", "https://github.com/other/rules.git"]) {
    const uncarried = catalog();
    uncarried.workflows[0].provenance = {
      sourceRepository: external, sourcePath: "/source/workflow.json", sourceRevision: "rev", contentDigest: "b".repeat(64),
      declaredScope: { kind: "repository", id: "repo-a" },
    };
    assert.throws(() => createPortableDocument(uncarried, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG");
  }

  const carriedAlias = catalog();
  carriedAlias.policies[0].provenance!.sourceRepository = "ALPHA";
  assert.equal(
    createPortableDocument(carriedAlias, "2026-09-26T00:00:00.000Z", "x").logical.policies[0].provenance?.sourceRepository,
    "ALPHA",
  );

  for (const sourceRepository of ["missing-repository", "org", "source"] as const) {
    const malformedPolicy = catalog();
    malformedPolicy.policies[0].provenance!.sourceRepository = sourceRepository;
    assert.throws(() => createPortableDocument(malformedPolicy, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG");

    const malformedWorkflow = catalog();
    malformedWorkflow.workflows[0].provenance = {
      sourceRepository, sourcePath: "/source/workflow.json", sourceRevision: "rev", contentDigest: "b".repeat(64),
      declaredScope: { kind: "repository", id: "repo-a" },
    };
    assert.throws(() => createPortableDocument(malformedWorkflow, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG");
  }

  const wrongDeclaredKind = catalog();
  wrongDeclaredKind.policies[0].provenance!.declaredScope = { kind: "organization", id: "project" };
  assert.throws(() => createPortableDocument(wrongDeclaredKind, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG");

  const wrongWorkflowScope = catalog();
  wrongWorkflowScope.workflows[0].provenance = {
    sourceRepository: "repo-a", sourcePath: "/source/workflow.json", sourceRevision: "rev", contentDigest: "b".repeat(64),
    declaredScope: { kind: "organization", id: "project" },
  };
  assert.throws(() => createPortableDocument(wrongWorkflowScope, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG");
});

test("portable workflow output references close over effective inherited declarations", () => {
  const valid = catalog();
  valid.workflows = [
    {
      id: "delivery", scope: { kind: "organization", id: "org" }, inputs: [], outputs: [{ id: "artifact", required: true }], settings: {}, operations: [], constraints: [],
      steps: [{ id: "produce", type: "agent.task", needs: [], configuration: {
        target: "agent", objective: "produce", expectedOutputs: [{ id: "artifact", path: "artifact.json" }],
        verification: [
          { type: "json-file", path: "artifact.json", fields: { id: "x" }, outputId: "artifact" },
          { type: "file", path: "artifact.json", content: "ok", outputId: "artifact" },
        ],
      }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true }],
    },
    {
      id: "delivery", scope: { kind: "repository", id: "repo-a" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [],
      steps: [
        { id: "confirm", type: "verify", needs: ["produce"], configuration: { checks: [{ type: "file", path: "artifact.json", content: "ok", outputId: "artifact" }] }, sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true },
        { id: "publish", type: "rules.distribute", needs: ["confirm"], configuration: { outputId: "artifact", source: { repositoryId: "repo-a", path: "/source/rules.json", revision: "rev", contentDigest: "c".repeat(64) }, repositories: [{ repositoryId: "repo-b", workspaceId: "ws-b", status: "matching" }] }, sideEffect: "external", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: true },
      ],
    },
  ] as any;
  const first = createPortableDocument(valid, "2026-09-26T00:00:00.000Z", "x");
  const second = createPortableDocument(portableCatalog(first), "2026-09-26T00:01:00.000Z", "x");
  assert.deepEqual(second.logical, first.logical);
  assert.deepEqual(second.unresolvedBindings, first.unresolvedBindings);

  const mutations: Array<(value: CatalogDocument) => void> = [
    value => ((value.workflows[0].steps[0] as any).configuration.expectedOutputs[0].id = "ghost"),
    value => ((value.workflows[0].steps[0] as any).configuration.verification[0].outputId = "ghost"),
    value => ((value.workflows[1].steps[0] as any).configuration.checks[0].outputId = "ghost"),
    value => ((value.workflows[1].steps[1] as any).configuration.outputId = "ghost"),
  ];
  for (const mutate of mutations) {
    const malformed = structuredClone(valid);
    mutate(malformed);
    assert.throws(() => createPortableDocument(malformed, "2026-09-26T00:00:00.000Z", "x"), (error: any) => error.code === "INVALID_CONFIG");
  }
});

test("portable export refuses duplicate expected-output identities for agent and external steps", () => {
  const accepted: string[] = [];
  for (const type of ["agent.task", "external.action"] as const) {
    const duplicate = catalog();
    duplicate.workflows[0].steps = [{
      id: "produce", type, needs: [], configuration: {
        target: type === "agent.task" ? "agent" : "service",
        objective: "produce",
        expectedOutputs: [
          { id: "artifact", path: "one.json" },
          { id: "artifact", path: "two.json" },
        ],
        verification: [],
      },
      sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true,
    }] as any;
    try { createPortableDocument(duplicate, "2026-09-26T00:00:00.000Z", "x"); accepted.push(type); }
    catch (error: any) { assert.equal(error.code, "INVALID_CONFIG", type); }
  }
  assert.deepEqual(accepted, []);
});

test("incoming valid-digest documents cannot add dangling provenance or output references", () => {
  const danglingProvenance: any = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "x");
  danglingProvenance.logical.policies[0].provenance.sourceRepository = "missing-repository";
  resign(danglingProvenance);
  assert.throws(() => validatePortableDocument(danglingProvenance), (error: any) => error.code === "INVALID_CONFIG");

  const uncarriedExternal: any = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "x");
  uncarriedExternal.logical.policies[0].provenance.sourceRepository = "https://github.com/external/rules.git";
  resign(uncarriedExternal);
  assert.throws(() => validatePortableDocument(uncarriedExternal), (error: any) => error.code === "INVALID_CONFIG");

  const danglingOutput: any = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "x");
  danglingOutput.logical.workflows[0].steps[1].configuration.checks[0].outputId = "ghost-output";
  resign(danglingOutput);
  assert.throws(() => validatePortableDocument(danglingOutput), (error: any) => error.code === "INVALID_CONFIG");
});

test("incoming valid-digest documents cannot duplicate expected-output identities", () => {
  for (const type of ["agent.task", "external.action"] as const) {
    const source = catalog();
    source.workflows[0].steps = [{
      id: "produce", type, needs: [], configuration: {
        target: type === "agent.task" ? "agent" : "service",
        objective: "produce",
        expectedOutputs: [{ id: "artifact", path: "one.json" }],
        verification: [],
      },
      sideEffect: "none", approval: "none", retry: { mode: "never", maxAttempts: 1 }, required: true,
    }] as any;
    const duplicate: any = createPortableDocument(source, "2026-09-26T00:00:00.000Z", "x");
    appendDuplicateExpectedOutput(duplicate);
    resign(duplicate);
    assert.throws(
      () => validatePortableDocument(duplicate),
      (error: any) => error.code === "INVALID_CONFIG",
      type,
    );
  }
});

test("portable raw parsing rejects duplicate JSON member names", () => {
  const document = createPortableDocument(catalog(), "2026-09-26T00:00:00.000Z", "x");
  const duplicate = JSON.stringify(document).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  assert.throws(() => parsePortableText(duplicate), (error: any) => error.code === "INVALID_CONFIG");
});
