import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { emptyCatalogDocument, validateCatalogDocument } from "../src/v2-model.ts";

const schemaPath = fileURLToPath(new URL("../schemas/v2/catalog.schema.json", import.meta.url));
const policy = { scope: { kind: "organization", id: "org" }, settings: { "commands.test": "npm test" }, operations: [], constraints: [], instructions: [], knowledge: [], skills: [] };

test("A07 draft-07 schema and runtime agree on record shapes while runtime owns cross-record invariants", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const check = new Ajv({ strict: true, allErrors: true }).compile(schema);
  const catalog: any = emptyCatalogDocument();
  catalog.groups = [{ id: "org", kind: "organization", name: "Org", slug: "org", parentId: null, metadata: {} }];
  catalog.repositories = [{ id: "repo", remote: "https://github.com/synthetic/repo", sourceId: null, primaryGroupId: "org", memberOf: [], aliases: [], classification: "confirmed", metadata: {} }];
  catalog.policies = [policy];
  catalog.workflows = [{ id: "feature", scope: { kind: "organization", id: "org" }, inputs: [], outputs: [], settings: {}, operations: [], constraints: [], steps: [{ id: "check", type: "command", needs: [], configuration: {}, sideEffect: "workspace", approval: "explicit", retry: { mode: "never", maxAttempts: 1 }, required: false }] }];
  assert.equal(check(catalog), true, JSON.stringify(check.errors));
  assert.deepEqual(validateCatalogDocument(catalog), catalog);

  const extra = structuredClone(catalog);
  extra.policies[0].unexpected = true;
  assert.equal(check(extra), false);
  assert.throws(() => validateCatalogDocument(extra));

  const duplicateScope = structuredClone(catalog);
  duplicateScope.policies.push(structuredClone(policy));
  assert.equal(check(duplicateScope), true, "draft-07 cannot express uniqueness by scope tuple");
  assert.throws(() => validateCatalogDocument(duplicateScope));
});
