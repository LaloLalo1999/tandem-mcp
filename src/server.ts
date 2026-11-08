/**
 * Shared MCP server factory. One server per transport connection,
 * all bound to the same TandemContext (so demo fixtures stay shared
 * across requests on the HTTP transport).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TandemContext } from "./providers/types.js";
import { registerTools } from "./tools.js";

export function createServer(ctx: TandemContext): McpServer {
  const server = new McpServer(
    { name: "tandem-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, ctx);
  return server;
}
