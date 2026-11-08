/**
 * Optional observability: PostHog product analytics + Sentry error tracking.
 *
 * Design decisions:
 * - Both are OFF unless configured. When unconfigured, every method is a
 *   no-op and makes zero network calls (verified by tests).
 * - No vendor SDKs: PostHog's public capture API and Sentry's envelope
 *   API are both plain HTTP, so this module works identically on Bun,
 *   Node, and Cloudflare Workers, and keeps the dependency list minimal.
 * - Privacy: only tool names, durations, success/failure, and the
 *   identifiers a tool was called with (Jira key, repo, doc id) are ever
 *   sent. Never tokens, secrets, or issue/doc content. The caller passes
 *   an explicit allow-listed identifier record — raw tool arguments are
 *   never forwarded.
 * - Observability must never break a tool call: every send is
 *   fire-and-forget with errors swallowed.
 */

export interface ObservabilityConfig {
  posthogApiKey?: string;
  posthogHost: string;
  sentryDsn?: string;
}

export interface ToolCallEvent {
  tool: string;
  durationMs: number;
  success: boolean;
  issueKey?: string;
  repo?: string;
  docId?: string;
  branch?: string;
}

export type SendFn = (
  url: string,
  body: string,
  headers?: Record<string, string>,
) => Promise<unknown>;

const defaultSend: SendFn = (url, body, headers) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body,
  });

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parse a Sentry DSN into its public key, host, and project id. */
export function parseSentryDsn(
  dsn: string,
): { publicKey: string; host: string; projectId: string } | null {
  const m = /^https?:\/\/([^@]+)@([^/]+)\/(\d+)\/?$/.exec(dsn.trim());
  if (!m) return null;
  return { publicKey: m[1], host: m[2], projectId: m[3] };
}

/** Best-effort stack frame extraction from an Error stack. */
function parseStackFrames(
  stack: string,
): { filename: string; function?: string; lineno?: number; colno?: number }[] {
  const frames: { filename: string; function?: string; lineno?: number; colno?: number }[] = [];
  for (const line of stack.split("\n").slice(1, 11)) {
    const m =
      /^\s*at (?:(.+?) \((.*):(\d+):(\d+)\)|(.*):(\d+):(\d+))$/.exec(
        line.trim(),
      );
    if (!m) continue;
    if (m[2]) {
      frames.push({
        function: m[1],
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
      });
    } else if (m[5]) {
      frames.push({
        filename: m[5],
        lineno: Number(m[6]),
        colno: Number(m[7]),
      });
    }
  }
  return frames.reverse();
}

export interface Observability {
  enabled: { posthog: boolean; sentry: boolean };
  captureToolCall(event: ToolCallEvent): void;
  captureException(err: unknown, context?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export function createObservability(
  config: ObservabilityConfig,
  sender: SendFn = defaultSend,
): Observability {
  const posthogEnabled = Boolean(config.posthogApiKey);
  const sentry = config.sentryDsn
    ? parseSentryDsn(config.sentryDsn)
    : null;
  const sentryEnabled = sentry !== null;
  if (config.sentryDsn && !sentryEnabled) {
    console.error(
      "[tandem] SENTRY_DSN is set but could not be parsed; Sentry disabled.",
    );
  }

  const pending = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => {
    pending.add(p);
    p.catch(() => {}).finally(() => pending.delete(p));
  };

  return {
    enabled: { posthog: posthogEnabled, sentry: sentryEnabled },

    captureToolCall(event: ToolCallEvent): void {
      if (!posthogEnabled) return;
      const host = (config.posthogHost || "https://us.i.posthog.com").replace(
        /\/$/,
        "",
      );
      const properties: Record<string, unknown> = {
        tool: event.tool,
        duration_ms: event.durationMs,
        success: event.success,
        $lib: "tandem-mcp",
      };
      if (event.issueKey) properties.issue_key = event.issueKey;
      if (event.repo) properties.repo = event.repo;
      if (event.docId) properties.doc_id = event.docId;
      if (event.branch) properties.branch = event.branch;
      track(
        sender(
          `${host}/capture/`,
          JSON.stringify({
            api_key: config.posthogApiKey,
            event: "tandem_tool_call",
            distinct_id: "tandem-server",
            timestamp: new Date().toISOString(),
            properties,
          }),
        ),
      );
    },

    captureException(err: unknown, context?: Record<string, unknown>): void {
      if (!sentryEnabled || !sentry) return;
      const error = err instanceof Error ? err : new Error(String(err));
      const eventId = randomHex(16);
      const header = JSON.stringify({
        event_id: eventId,
        sent_at: new Date().toISOString(),
        sdk: { name: "tandem-mcp", version: "0.1.0" },
      });
      const payload = JSON.stringify({
        event_id: eventId,
        timestamp: Date.now() / 1000,
        level: "error",
        platform: "javascript",
        exception: {
          values: [
            {
              type: error.name,
              value: error.message,
              stacktrace: error.stack
                ? { frames: parseStackFrames(error.stack) }
                : undefined,
            },
          ],
        },
        tags: {
          component: "tandem-mcp",
          ...(context?.tool ? { tool: String(context.tool) } : {}),
        },
        extra: context ?? {},
      });
      const envelope = [
        header,
        JSON.stringify({ type: "event", content_type: "application/json" }),
        payload,
      ].join("\n");
      track(
        sender(
          `https://${sentry.host}/api/${sentry.projectId}/envelope/`,
          envelope,
          {
            "Content-Type": "application/x-sentry-envelope",
            "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${sentry.publicKey}, sentry_client=tandem-mcp/0.1.0`,
          },
        ),
      );
    },

    async flush(): Promise<void> {
      await Promise.allSettled([...pending]);
    },
  };
}

/**
 * Allow-listed identifiers from tool arguments. Only these fields are
 * ever sent to PostHog/Sentry — never bodies, content, or tokens.
 */
export function identifiersFromArgs(
  args: Record<string, unknown>,
): Pick<ToolCallEvent, "issueKey" | "repo" | "docId" | "branch"> {
  const out: Pick<ToolCallEvent, "issueKey" | "repo" | "docId" | "branch"> = {};
  if (typeof args.issueKey === "string") out.issueKey = args.issueKey;
  if (typeof args.repo === "string") out.repo = args.repo;
  if (typeof args.pageId === "string") out.docId = args.pageId;
  if (typeof args.docId === "string") out.docId = args.docId;
  if (typeof args.branch === "string") out.branch = args.branch;
  return out;
}
