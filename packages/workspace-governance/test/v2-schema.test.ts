import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import {
  parseDataText,
  validateCatalogDocument,
  validateConfigDocument,
  validateLocalStateDocument,
  validateWorkspacePlan,
} from "../src/v2-model.ts";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/v2/${name}`, import.meta.url));
const schema = (name: string) =>
  fileURLToPath(new URL(`../schemas/v2/${name}`, import.meta.url));
const load = async (path: string) => JSON.parse(await readFile(path, "utf8"));

test("M2 v2 executable schemas accept valid fixtures and reject invalid fixtures", async () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const contracts = [
    ["config.schema.json", "config.valid.json", "config.invalid.json"],
    ["catalog.schema.json", "catalog.valid.json", "catalog.invalid.json"],
    ["local-state.schema.json", "local-state.valid.json", "local-state.invalid.json"],
    ["workspace-plan.schema.json", "workspace-plan.valid.json", "workspace-plan.invalid.json"],
  ] as const;
  for (const [schemaName, validName, invalidName] of contracts) {
    const validate = ajv.compile(await load(schema(schemaName)));
    assert.equal(validate(await load(fixture(validName))), true, JSON.stringify(validate.errors));
    assert.equal(validate(await load(fixture(invalidName))), false, `${schemaName} accepted invalid fixture`);
  }
});

test("M2 JSON and safe YAML map to the same bounded v2 model", () => {
  const config = {
    schemaVersion: 2,
    documentType: "workspacectl/config",
    catalog: { adapter: "file", path: "/tmp/workspacectl-synthetic/catalog.json" },
    localState: { adapter: "file", path: "/tmp/workspacectl-synthetic/local-state.json" },
    plans: { directory: "/tmp/workspacectl-synthetic/plans" },
    trustedRoots: ["/tmp/workspacectl-synthetic/workspaces"],
  };
  assert.deepEqual(
    validateConfigDocument(parseDataText(JSON.stringify(config), "json", 256 * 1024)),
    config,
  );
  assert.deepEqual(
    validateConfigDocument(
      parseDataText(
        [
          "schemaVersion: 2",
          "documentType: workspacectl/config",
          "catalog:",
          "  adapter: file",
          "  path: /tmp/workspacectl-synthetic/catalog.json",
          "localState:",
          "  adapter: file",
          "  path: /tmp/workspacectl-synthetic/local-state.json",
          "plans:",
          "  directory: /tmp/workspacectl-synthetic/plans",
          "trustedRoots:",
          "  - /tmp/workspacectl-synthetic/workspaces",
          "",
        ].join("\n"),
        "yaml",
        256 * 1024,
      ),
    ),
    config,
  );

  for (const unsafeYaml of [
    "schemaVersion: 2\nschemaVersion: 2\n",
    "value: &shared [1]\ncopy: *shared\n",
    "value: !<tag:yaml.org,2002:js/function> function(){}\n",
  ]) assert.throws(() => parseDataText(unsafeYaml, "yaml", 256 * 1024));
  assert.throws(() => parseDataText("x".repeat(256 * 1024 + 1), "yaml", 256 * 1024));
});

test("M2 runtime validators enforce semantic constraints beyond JSON Schema", async () => {
  const catalog = await load(fixture("catalog.valid.json"));
  const localState = await load(fixture("local-state.valid.json"));
  const plan = await load(fixture("workspace-plan.valid.json"));
  assert.doesNotThrow(() => validateCatalogDocument(catalog));
  assert.doesNotThrow(() => validateLocalStateDocument(localState));
  assert.doesNotThrow(() => validateWorkspacePlan(plan));

  const duplicateRemote: any = await load(fixture("catalog.valid.json"));
  duplicateRemote.repositories.push({
    ...duplicateRemote.repositories[0],
    id: "repo-synthetic-copy",
    remote: "git@github.com:Synthetic/Example.git",
  });
  assert.throws(() => validateCatalogDocument(duplicateRemote));
});
