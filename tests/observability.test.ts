/**
 * Observability tests.
 *
 * The hard requirement: when PostHog / Sentry are unconfigured, the
 * module must be a complete no-op — zero network calls. When configured,
 * events must carry only allow-listed identifiers, never tokens or
 * issue/doc content.
 */

import { describe, expect, test } from "bun:test";
import {
  createObservability,
  identifiersFromArgs,
  parseSentryDsn,
  type SendFn,
} from "../src/observability.js";

function recordingSender() {
  const calls: { url: string; body: string; headers?: Record<string, string> }[] = [];
  const send: SendFn = async (url, body, headers) => {
    calls.push({ url, body, headers });
  };
  return { calls, send };
}

describe("unconfigured observability is a no-op", () => {
  test("no PostHog/Sentry calls when nothing is configured", async () => {
    const { calls, send } = recordingSender();
    const obs = createObservability(
      { posthogHost: "https://us.i.posthog.com" },
      send,
    );
    expect(obs.enabled).toEqual({ posthog: false, sentry: false });
    obs.captureToolCall({
      tool: "tandem_start",
      durationMs: 42,
      success: true,
      issueKey: "TAN-123",
      repo: "lalolalo1999/tandem-demo",
    });
    obs.captureException(new Error("boom"), { tool: "tandem_start" });
    await obs.flush();
    expect(calls).toHaveLength(0);
  });

  test("malformed Sentry DSN disables Sentry without sending", async () => {
    const { calls, send } = recordingSender();
    const obs = createObservability(
      { posthogHost: "https://us.i.posthog.com", sentryDsn: "not-a-dsn" },
      send,
    );
    expect(obs.enabled.sentry).toBe(false);
    obs.captureException(new Error("boom"));
    await obs.flush();
    expect(calls).toHaveLength(0);
  });
});

describe("PostHog capture", () => {
  test("sends one event with allow-listed fields only", async () => {
    const { calls, send } = recordingSender();
    const obs = createObservability(
      {
        posthogApiKey: "phc_test_key",
        posthogHost: "https://us.i.posthog.com",
      },
      send,
    );
    expect(obs.enabled.posthog).toBe(true);
    obs.captureToolCall({
      tool: "tandem_ship",
      durationMs: 120,
      success: false,
      issueKey: "TAN-124",
      repo: "lalolalo1999/tandem-demo",
      branch: "fix/TAN-124-x",
    });
    await obs.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://us.i.posthog.com/capture/");
    const payload = JSON.parse(calls[0].body);
    expect(payload.event).toBe("tandem_tool_call");
    expect(payload.properties.tool).toBe("tandem_ship");
    expect(payload.properties.duration_ms).toBe(120);
    expect(payload.properties.success).toBe(false);
    expect(payload.properties.issue_key).toBe("TAN-124");
    expect(payload.properties.repo).toBe("lalolalo1999/tandem-demo");
    expect(payload.properties.branch).toBe("fix/TAN-124-x");
    // The API key travels in the documented api_key field only.
    expect(payload.api_key).toBe("phc_test_key");
    expect(calls[0].body).not.toContain("GITHUB_TOKEN");
  });
});

describe("Sentry capture", () => {
  test("sends an envelope to the DSN project endpoint", async () => {
    const { calls, send } = recordingSender();
    const obs = createObservability(
      {
        posthogHost: "https://us.i.posthog.com",
        sentryDsn: "https://publickey123@o123.ingest.sentry.io/456",
      },
      send,
    );
    expect(obs.enabled.sentry).toBe(true);
    obs.captureException(new Error("boom"), { tool: "tandem_status" });
    await obs.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://o123.ingest.sentry.io/api/456/envelope/",
    );
    expect(calls[0].headers?.["X-Sentry-Auth"]).toContain(
      "sentry_key=publickey123",
    );
    const lines = calls[0].body.split("\n");
    expect(lines).toHaveLength(3);
    const event = JSON.parse(lines[2]);
    expect(event.exception.values[0].value).toBe("boom");
    expect(event.tags.tool).toBe("tandem_status");
  });

  test("parseSentryDsn handles valid and invalid DSNs", () => {
    expect(
      parseSentryDsn("https://abc@o1.ingest.sentry.io/2"),
    ).toEqual({ publicKey: "abc", host: "o1.ingest.sentry.io", projectId: "2" });
    expect(parseSentryDsn("garbage")).toBeNull();
    expect(parseSentryDsn("")).toBeNull();
  });
});

describe("identifiersFromArgs allow-list", () => {
  test("keeps only safe identifiers, drops bodies and secrets", () => {
    const ids = identifiersFromArgs({
      issueKey: "TAN-123",
      repo: "o/r",
      pageId: "page-1",
      branch: "feature/x",
      body: "secret issue content that must never leave the server",
      token: "ghp_should_never_be_sent",
      number: 7,
    });
    expect(ids).toEqual({
      issueKey: "TAN-123",
      repo: "o/r",
      docId: "page-1",
      branch: "feature/x",
    });
  });
});
