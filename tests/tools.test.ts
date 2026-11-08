/**
 * Tool tests: exercise every Tandem tool end to end through an
 * in-process MCP client (InMemoryTransport) against the demo fixtures.
 * No tokens, no network.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/providers/index.js";
import { createServer } from "../src/server.js";

async function setup() {
  const ctx = createContext(loadConfig({ DEMO_MODE: "true" }));
  const server = createServer(ctx);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tandem-test", version: "0.1.0" });
  await client.connect(clientTransport);
  return { client, ctx };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
  // The SDK returns non-JSON text for its own validation errors (e.g.
  // "MCP error -32602: ..."); tolerate that in tests.
  let json: Record<string, any>;
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    json = { _raw: text };
  }
  return { result: res, json };
}

describe("tandem_start", () => {
  test("creates branch + doc + comment for a To Do issue", async () => {
    const { client } = await setup();
    const { result, json } = await call(client, "tandem_start", {
      issueKey: "TAN-124",
    });
    expect(result.isError).toBeFalsy();
    expect(json.branch.name).toBe("fix/TAN-124-fix-flaky-login-test-in-ci");
    expect(json.doc.title).toContain("TAN-124");
    expect(json.doc.title).toContain("Fix flaky login test in CI");
    expect(json.comment.id).toBeTruthy();
    expect(json.issue.key).toBe("TAN-124");
  });

  test("rejects an unknown issue key", async () => {
    const { client } = await setup();
    const { result } = await call(client, "tandem_start", {
      issueKey: "TAN-999",
    });
    expect(result.isError).toBe(true);
  });

  test("rejects a malformed issue key", async () => {
    const { client } = await setup();
    const { result } = await call(client, "tandem_start", {
      issueKey: "not-a-key",
    });
    expect(result.isError).toBe(true);
  });
});

describe("tandem_ship", () => {
  test("opens a PR, moves issue + doc to In Review", async () => {
    const { client } = await setup();
    const started = await call(client, "tandem_start", { issueKey: "TAN-124" });
    const branch = started.json.branch.name as string;
    const { result, json } = await call(client, "tandem_ship", { branch });
    expect(result.isError).toBeFalsy();
    expect(json.pr.url).toContain("/pull/");
    expect(json.pr.title).toContain("TAN-124");
    expect(json.issue.status).toBe("In Review");
    expect(json.doc.status).toBe("In Review");
  });

  test("rejects a branch without an issue key", async () => {
    const { client } = await setup();
    const { result } = await call(client, "tandem_ship", {
      branch: "feature/some-random-work",
    });
    expect(result.isError).toBe(true);
  });
});

describe("tandem_status", () => {
  test("unified view for an issue with branch, PR, checks and doc", async () => {
    const { client } = await setup();
    const { result, json } = await call(client, "tandem_status", {
      issueKey: "TAN-125",
    });
    expect(result.isError).toBeFalsy();
    expect(json.issue.key).toBe("TAN-125");
    expect(json.branch.name).toBe("feature/TAN-125-release-notes");
    expect(json.pr.number).toBe(7);
    expect(json.pr.checksSummary.passing).toBe(2);
    expect(json.doc.status).toBe("In Review");
  });

  test("issue with no branch yet reports nulls", async () => {
    const { client } = await setup();
    const { json } = await call(client, "tandem_status", {
      issueKey: "TAN-124",
    });
    expect(json.branch).toBeNull();
    expect(json.pr).toBeNull();
    expect(json.doc).toBeNull();
  });
});

describe("tandem_standup", () => {
  test("lists in-flight work for an assignee with linked state", async () => {
    const { client } = await setup();
    const { result, json } = await call(client, "tandem_standup", {
      assignee: "Eduardo Javier Garcia Lopez",
    });
    expect(result.isError).toBeFalsy();
    const keys = (json.entries as { key: string }[]).map((e) => e.key);
    expect(keys).toContain("TAN-123");
    expect(keys).not.toContain("TAN-126"); // Done is excluded
    const tan125 = (json.entries as any[]).find((e) => e.key === "TAN-125");
    expect(tan125).toBeUndefined(); // different assignee
  });
});

describe("tandem_release_notes", () => {
  test("drafts grouped notes from merged PRs in range", async () => {
    const { client } = await setup();
    const { result, json } = await call(client, "tandem_release_notes", {
      since: "2026-10-01",
      until: "2026-11-30",
    });
    expect(result.isError).toBeFalsy();
    const types = (json.groups as { type: string }[]).map((g) => g.type);
    expect(types).toContain("Story");
    expect(types).toContain("Bug");
    expect(json.markdown).toContain("Release notes (draft)");
    expect(json.markdown).toContain("PR #5");
    expect(json.markdown).toContain("PR #6");
  });

  test("empty range produces an empty draft, not an error", async () => {
    const { client } = await setup();
    const { result, json } = await call(client, "tandem_release_notes", {
      since: "2020-01-01",
      until: "2020-02-01",
    });
    expect(result.isError).toBeFalsy();
    expect(json.groups).toEqual([]);
  });
});

describe("read helpers", () => {
  test("github_pr returns PR + checks", async () => {
    const { client } = await setup();
    const { json } = await call(client, "github_pr", { number: 7 });
    expect(json.title).toContain("TAN-125");
    expect(json.checks).toHaveLength(2);
  });

  test("jira_issue returns issue detail", async () => {
    const { client } = await setup();
    const { json } = await call(client, "jira_issue", { issueKey: "TAN-123" });
    expect(json.summary).toContain("retry with backoff");
    expect(json.status).toBe("In Progress");
  });

  test("notion_page returns page summary", async () => {
    const { client } = await setup();
    const { json } = await call(client, "notion_page", {
      pageId: "demo-page-tan-125",
    });
    expect(json.title).toContain("TAN-125");
    expect(json.status).toBe("In Review");
  });

  test("github_checks returns CI status for a branch", async () => {
    const { client } = await setup();
    const { json } = await call(client, "github_checks", {
      ref: "feature/TAN-125-release-notes",
    });
    expect(json).toHaveLength(2);
    expect(json[0].conclusion).toBe("success");
  });
});

describe("tandem_health", () => {
  test("reports demo providers live and observability disabled", async () => {
    const { client } = await setup();
    const { result, json } = await call(client, "tandem_health", {});
    expect(result.isError).toBeFalsy();
    expect(json.mode).toBe("demo");
    expect(json.providers.github.reachable).toBe(true);
    expect(json.providers.jira.reachable).toBe(true);
    expect(json.providers.notion.reachable).toBe(true);
    expect(json.observability).toEqual({
      posthog: "disabled",
      sentry: "disabled",
    });
  });
});
