#!/usr/bin/env bun
/**
 * Tandem MCP server — stdio transport (local dev, Claude Desktop, etc).
 *
 * Usage:
 *   DEMO_MODE=true bun run src/stdio.ts
 *   bun start            # same, via package.json
 *
 * Real mode: set GITHUB_TOKEN, JIRA_BASE_URL, JIRA_EMAIL,
 * JIRA_API_TOKEN, NOTION_API_KEY, NOTION_PARENT_PAGE_ID (see .env.example).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createContext } from "./providers/index.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createContext(config);
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[tandem] running on stdio (mode=${config.demoMode ? "demo" : "live"}, repo=${config.githubRepo})`,
  );
  const shutdown = async () => {
    await ctx.obs.flush().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[tandem] failed to start:", err);
  process.exit(1);
});
