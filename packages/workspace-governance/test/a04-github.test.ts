import test from "node:test";
import assert from "node:assert/strict";
import { discoverGithub, type GithubRunner } from "../src/discovery.ts";

const fullOrganizationPage = Array.from({ length: 100 }, (_, index) => ({
  id: index + 1,
  html_url: `https://github.com/Synthetic-Org/repo-${index + 1}`,
  archived: false,
  private: false,
}));

const fixedNow = () => new Date("2026-09-14T12:00:00.000Z");

test("A04 GitHub organization and user endpoints paginate to a short page with explicit visibility truth", async () => {
  const calls: Array<{ args: string[]; options: Parameters<GithubRunner>[2] }> = [];
  const runner: GithubRunner = async (_bin, args, options) => {
    calls.push({ args, options });
    const endpoint = args.at(-1);
    if (endpoint?.startsWith("/orgs/Synthetic-Org/")) {
      return JSON.stringify(
        /[?&]page=1(?:&|$)/.test(endpoint)
          ? fullOrganizationPage
          : [{
              id: 101,
              html_url: "https://github.com/Synthetic-Org/private-archive",
              archived: true,
              private: true,
            }],
      );
    }
    return JSON.stringify([{
      id: 201,
      html_url: "https://github.com/Synthetic-User/public-repo",
      archived: false,
      private: false,
    }]);
  };

  const organization = await discoverGithub("Synthetic-Org", {
    ownerType: "organization",
    runner,
    now: fixedNow,
  });
  assert.equal(organization.ownerType, "organization");
  assert.equal(organization.observedAt, "2026-09-14T12:00:00.000Z");
  assert.equal(organization.repositories.length, 101);
  assert.equal(organization.complete, true);
  assert.deepEqual(organization.coverage, {
    status: "complete",
    scope: "credential-visible",
    absenceAuthoritative: false,
    privateVisibility: "observed",
    endpoint: "organization",
    pages: {
      requested: 2,
      completed: 2,
      max: 100,
      nextPage: null,
      truncated: false,
    },
    limitations: ["PRIVATE_REPOSITORY_ABSENCE_NOT_AUTHORITATIVE"],
    errors: [],
  });
  assert.deepEqual(organization.counts, {
    received: 101,
    private: 1,
    archived: 1,
  });

  const user = await discoverGithub("Synthetic-User", {
    ownerType: "user",
    runner,
    now: fixedNow,
  });
  assert.equal(user.ownerType, "user");
  assert.equal(user.repositories.length, 1);
  assert.equal(user.complete, false);
  assert.equal(user.coverage.status, "partial");
  assert.equal(user.coverage.endpoint, "user");
  assert.equal(user.coverage.privateVisibility, "unavailable");
  assert.deepEqual(user.coverage.limitations, [
    "PRIVATE_VISIBILITY_UNAVAILABLE_FOR_USER_ENDPOINT",
  ]);

  assert.deepEqual(
    calls.map(({ args }) => args),
    [
      [
        "api",
        "--hostname",
        "github.com",
        "/orgs/Synthetic-Org/repos?per_page=100&page=1&type=all&sort=full_name&direction=asc",
      ],
      [
        "api",
        "--hostname",
        "github.com",
        "/orgs/Synthetic-Org/repos?per_page=100&page=2&type=all&sort=full_name&direction=asc",
      ],
      [
        "api",
        "--hostname",
        "github.com",
        "/users/Synthetic-User/repos?per_page=100&page=1&type=owner&sort=full_name&direction=asc",
      ],
    ],
  );
  assert.ok(calls.every(({ options }) => options.env.GH_HOST === undefined));
});

test("A04 interrupted pagination retains completed pages as partial without leaking runner text", async () => {
  let page = 0;
  const runner: GithubRunner = async () => {
    page += 1;
    if (page === 1) return JSON.stringify(fullOrganizationPage);
    throw Object.assign(new Error("fixture secret must not be returned"), {
      code: "FIXTURE_INTERRUPTED",
      status: 503,
      stderr: "fixture secret stderr must not be returned",
    });
  };

  const inventory = await discoverGithub("Synthetic-Org", {
    ownerType: "organization",
    runner,
    now: fixedNow,
  });

  assert.equal(inventory.repositories.length, 100);
  assert.equal(inventory.complete, false);
  assert.equal(inventory.coverage.status, "partial");
  assert.deepEqual(inventory.coverage.pages, {
    requested: 2,
    completed: 1,
    max: 100,
    nextPage: 2,
    truncated: false,
  });
  assert.deepEqual(inventory.coverage.errors, [{
    code: "PAGE_FAILED",
    page: 2,
    causeCode: "FIXTURE_INTERRUPTED",
    httpStatus: 503,
  }]);
  assert.equal(JSON.stringify(inventory).includes("fixture secret"), false);
});

test("A04 denied first page is unknown rather than an authoritative empty inventory", async () => {
  const runner: GithubRunner = async () => {
    throw Object.assign(new Error("fixture denied body"), {
      code: "FIXTURE_DENIED",
      statusCode: 403,
    });
  };
  const inventory = await discoverGithub("Synthetic-Org", {
    ownerType: "organization",
    runner,
    now: fixedNow,
  });
  assert.deepEqual(inventory.repositories, []);
  assert.equal(inventory.complete, false);
  assert.equal(inventory.coverage.status, "unknown");
  assert.equal(inventory.coverage.absenceAuthoritative, false);
  assert.deepEqual(inventory.coverage.pages, {
    requested: 1,
    completed: 0,
    max: 100,
    nextPage: 1,
    truncated: false,
  });
  assert.deepEqual(inventory.coverage.errors, [{
    code: "ACCESS_DENIED",
    page: 1,
    causeCode: "FIXTURE_DENIED",
    httpStatus: 403,
  }]);
  assert.equal(JSON.stringify(inventory).includes("fixture denied body"), false);
});

test("A04 a full final allowed page reports bounded-limit partial coverage and next page", async () => {
  let calls = 0;
  const inventory = await discoverGithub("Synthetic-Org", {
    ownerType: "organization",
    maxPages: 1,
    now: fixedNow,
    runner: async () => {
      calls += 1;
      return JSON.stringify(fullOrganizationPage);
    },
  });
  assert.equal(calls, 1);
  assert.equal(inventory.repositories.length, 100);
  assert.equal(inventory.coverage.status, "partial");
  assert.deepEqual(inventory.coverage.pages, {
    requested: 1,
    completed: 1,
    max: 1,
    nextPage: 2,
    truncated: true,
  });
  assert.deepEqual(inventory.coverage.errors, [{
    code: "PAGE_LIMIT",
    page: 2,
    causeCode: null,
    httpStatus: null,
  }]);
});

test("A04 a repeated page retains only completed unique pages and names the response defect", async () => {
  let calls = 0;
  const inventory = await discoverGithub("Synthetic-Org", {
    ownerType: "organization",
    now: fixedNow,
    runner: async () => {
      calls += 1;
      return JSON.stringify(fullOrganizationPage);
    },
  });
  assert.equal(calls, 2);
  assert.equal(inventory.repositories.length, 100);
  assert.equal(inventory.coverage.status, "partial");
  assert.deepEqual(inventory.coverage.pages, {
    requested: 2,
    completed: 1,
    max: 100,
    nextPage: 2,
    truncated: false,
  });
  assert.deepEqual(inventory.coverage.errors, [{
    code: "REPEATED_RESPONSE",
    page: 2,
    causeCode: null,
    httpStatus: null,
  }]);
});
