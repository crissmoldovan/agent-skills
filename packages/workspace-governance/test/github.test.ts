import test from "node:test";
import assert from "node:assert/strict";
import * as discovery from "../src/discovery.ts";

const page = Array.from({ length: 100 }, (_, index) => ({
  id: index + 1,
  html_url: `https://github.com/example/repo-${index}`,
  archived: false,
  private: false,
}));

test("A04 default GitHub organization GET completes and malformed input remains bounded", async () => {
  const calls: any[] = [];
  const runner = async (bin: string, args: string[], options: any) => {
    calls.push({ bin, args, options });
    return JSON.stringify(calls.length === 1 ? page : []);
  };
  const inventory = await discovery.discoverGithub("example", { runner });
  assert.equal(inventory.repositories.length, 100);
  assert.equal(inventory.complete, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bin, "gh");
  assert.deepEqual(calls[0].args, [
    "api",
    "--hostname",
    "github.com",
    "/orgs/example/repos?per_page=100&page=1&type=all&sort=full_name&direction=asc",
  ]);
  assert.equal(calls[0].options.env.GH_HOST, undefined);

  for (const fixture of [
    { runner: async () => "{bad", code: "INVALID_RESPONSE" },
    { runner: async () => JSON.stringify([{}]), code: "INVALID_RESPONSE" },
    {
      runner: async () => {
        throw new Error("secret stderr");
      },
      code: "PAGE_FAILED",
    },
  ]) {
    const observed = await discovery.discoverGithub("example", {
      runner: fixture.runner,
    });
    assert.equal(observed.coverage.status, "unknown");
    assert.equal(observed.coverage.errors[0].code, fixture.code);
    assert.equal(JSON.stringify(observed).includes("secret stderr"), false);
  }

  await assert.rejects(() =>
    discovery.discoverGithub("bad/owner", {
      runner: async () => {
        throw new Error("must not run");
      },
    }),
  );
});
