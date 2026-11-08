#!/usr/bin/env bun
/**
 * Tandem MCP server — Streamable HTTP transport (local dev / demo).
 *
 * Usage:
 *   DEMO_MODE=true bun run src/http.ts        # demo fixtures, port 3000
 *   bun run start:http                        # same, via package.json
 *
 * Endpoints:
 *   GET  /        — server info (JSON)
 *   GET  /health  — tandem_health output (JSON, no MCP client needed)
 *   POST /mcp     — MCP Streamable HTTP (stateless: a fresh server per
 *                   request, bound to the shared TandemContext, so demo
 *                   fixtures persist across requests)
 *
 * Point any MCP client at http://127.0.0.1:3000/mcp
 * (e.g. MCP Inspector: `npx @modelcontextprotocol/inspector`).
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig } from "./config.js";
import { createContext } from "./providers/index.js";
import type { TandemContext } from "./providers/types.js";
import { createServer } from "./server.js";
import { tandemHealthPayload } from "./tools.js";

const config = loadConfig();
const ctx: TandemContext = createContext(config);

async function handleMcp(req: Request): Promise<Response> {
  const server = createServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    // Bun.serve finalizes a Response whose body is a lazily-enqueued
    // ReadableStream before the SSE event is written (empty body). JSON
    // responses avoid the streaming path entirely. Workers use the same
    // setting via src/worker.ts.
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close().catch(() => {});
  }
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/mcp") {
      if (req.method !== "POST" && req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleMcp(req);
    }
    if (url.pathname === "/health") {
      return Response.json(await tandemHealthPayload(ctx));
    }
    if (url.pathname === "/" && req.method === "GET") {
      return Response.json({
        name: "tandem-mcp",
        version: "0.1.0",
        mode: config.demoMode ? "demo" : "live",
        mcp: "/mcp",
        health: "/health",
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.error(
  `[tandem] Streamable HTTP on http://${config.host}:${config.port}/mcp (mode=${config.demoMode ? "demo" : "live"}, repo=${config.githubRepo})`,
);
console.error(`[tandem] health: http://${config.host}:${config.port}/health`);

process.on("SIGINT", async () => {
  await ctx.obs.flush().catch(() => {});
  server.stop();
  process.exit(0);
});
