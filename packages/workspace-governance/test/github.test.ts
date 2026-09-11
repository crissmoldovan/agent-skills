import test from "node:test";
import assert from "node:assert/strict";
import * as discovery from "../src/discovery.ts";
const page = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  html_url: `https://github.com/example/repo-${i}`,
  archived: false,
  private: false,
}));
test("A7 GitHub fixed GET pagination completes and rejects partial/error/repeated pages", async () => {
  const calls: any[] = [];
  const runner = async (bin: string, args: string[], options: any) => {
    calls.push({ bin, args, options });
    return JSON.stringify(calls.length === 1 ? page : []);
  };
  const inv = await discovery.discoverGithub("example", { runner });
  assert.equal(inv.repositories.length, 100);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bin, "gh");
  assert.deepEqual(calls[0].args, [
    "api",
    "--hostname",
    "github.com",
    "/orgs/example/repos?per_page=100&page=1&type=all",
  ]);
  assert.equal(calls[0].options.env.GH_HOST, undefined);
  for (const fn of [
    async () => JSON.stringify(page),
    async () => "{bad",
    async () => JSON.stringify([{}]),
    async () => {
      throw new Error("secret stderr");
    },
  ])
    await assert.rejects(() =>
      discovery.discoverGithub("example", { runner: fn }),
    );
  await assert.rejects(() =>
    discovery.discoverGithub("bad/owner", {
      runner: async () => {
        throw new Error("must not run");
      },
    }),
  );
});
