/**
 * Tandem MCP server — Cloudflare Workers entry.
 *
 * Streamable HTTP via the SDK's WebStandard transport. Stateless mode:
 * a fresh MCP server per request, bound to one shared TandemContext
 * per isolate.
 *
 * Secrets come from Worker secrets / vars (wrangler.toml [vars] and
 * `wrangler secret put`). With no provider tokens configured, the
 * Worker runs in demo mode — handy for a public demo endpoint.
 *
 * Deploy:
 *   npx wrangler deploy
 *
 * Env (wrangler vars / secrets):
 *   GITHUB_TOKEN, GITHUB_REPO, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN,
 *   JIRA_PROJECT, NOTION_API_KEY, NOTION_PARENT_PAGE_ID,
 *   NOTION_STATUS_PROPERTY, POSTHOG_API_KEY, POSTHOG_HOST, SENTRY_DSN,
 *   DEMO_MODE
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig, type EnvLike } from "./config.js";
import { createContext } from "./providers/index.js";
import type { TandemContext } from "./providers/types.js";
import { createServer } from "./server.js";
import { tandemHealthPayload } from "./tools.js";

export interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  JIRA_API_TOKEN?: string;
  JIRA_PROJECT?: string;
  NOTION_API_KEY?: string;
  NOTION_PARENT_PAGE_ID?: string;
  NOTION_STATUS_PROPERTY?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
  SENTRY_DSN?: string;
  DEMO_MODE?: string;
}

let ctx: TandemContext | null = null;

/** Minimal Cloudflare Workers ExecutionContext (only what we use). */
interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function getContext(env: Env): TandemContext {
  if (!ctx) ctx = createContext(loadConfig(env as EnvLike));
  return ctx;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    workerCtx: WorkerExecutionContext,
  ): Promise<Response> {
    const context = getContext(env);
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json(await tandemHealthPayload(context));
    }
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json({
        name: "tandem-mcp",
        version: "0.1.0",
        mode: context.config.demoMode ? "demo" : "live",
        mcp: "/mcp",
        health: "/health",
      });
    }
    if (url.pathname === "/mcp") {
      const server = createServer(context);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
        // JSON responses instead of SSE streaming: the response is a
        // single JSON body, which every runtime handles identically.
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      // Flush pending observability events before the isolate sleeps.
      workerCtx.waitUntil(
        context.obs.flush().catch(() => transport.close().catch(() => {})),
      );
      return response;
    }
    return new Response("Not Found", { status: 404 });
  },
};
