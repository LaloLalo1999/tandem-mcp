/**
 * MCP tool registrations.
 *
 * Every handler is wrapped with observability: one PostHog event per
 * tool call (tool name, duration, success, allow-listed identifiers)
 * and Sentry capture on exceptions. When PostHog/Sentry are
 * unconfigured, the wrapper is a pure pass-through.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { identifiersFromArgs } from "./observability.js";
import type { TandemContext } from "./providers/types.js";
import {
  ISSUE_KEY_RE,
  tandemReleaseNotes,
  tandemShip,
  tandemStandup,
  tandemStart,
  tandemStatus,
} from "./workflows.js";

type Json = Record<string, unknown>;

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(err: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { error: err instanceof Error ? err.message : String(err) },
          null,
          2,
        ),
      },
    ],
  };
}

export interface HealthPayload {
  mode: "demo" | "live";
  providers: {
    jira: { kind: string; configured: boolean; reachable: boolean; detail: string };
    github: { kind: string; configured: boolean; reachable: boolean; detail: string };
    notion: { kind: string; configured: boolean; reachable: boolean; detail: string };
  };
  observability: { posthog: "enabled" | "disabled"; sentry: "enabled" | "disabled" };
  repo: string;
  jiraProject: string;
}

/** Shared by the tandem_health tool and the HTTP /health endpoint. */
export async function tandemHealthPayload(
  ctx: TandemContext,
): Promise<HealthPayload> {
  const [pm, vc, docs] = await Promise.all([
    ctx.pm.health(),
    ctx.vc.health(),
    ctx.docs.health(),
  ]);
  return {
    mode: ctx.config.demoMode ? "demo" : "live",
    providers: {
      jira: { kind: ctx.pm.kind, ...pm },
      github: { kind: ctx.vc.kind, ...vc },
      notion: { kind: ctx.docs.kind, ...docs },
    },
    observability: {
      posthog: ctx.obs.enabled.posthog ? "enabled" : "disabled",
      sentry: ctx.obs.enabled.sentry ? "enabled" : "disabled",
    },
    repo: ctx.config.githubRepo,
    jiraProject: ctx.config.jiraProject,
  };
}

const issueKeySchema = z
  .string()
  .regex(
    ISSUE_KEY_RE,
    "Jira issue key, e.g. TAN-123",
  )
  .describe("Jira issue key, e.g. TAN-123");
const repoSchema = z
  .string()
  .optional()
  .describe(
    'GitHub repo as "owner/repo". Defaults to GITHUB_REPO env var.',
  );

export function registerTools(server: McpServer, ctx: TandemContext): void {
  const wrap = <T extends Json>(
    tool: string,
    fn: (args: T) => Promise<unknown>,
  ) => {
    return async (args: T) => {
      const started = Date.now();
      const ids = identifiersFromArgs(args as Record<string, unknown>);
      try {
        const result = await fn(args);
        ctx.obs.captureToolCall({
          tool,
          durationMs: Date.now() - started,
          success: true,
          ...ids,
        });
        return jsonResult(result);
      } catch (err) {
        ctx.obs.captureToolCall({
          tool,
          durationMs: Date.now() - started,
          success: false,
          ...ids,
        });
        ctx.obs.captureException(err, { tool, ...ids });
        return errorResult(err);
      }
    };
  };

  server.registerTool(
    "tandem_start",
    {
      title: "Start work on a Jira issue",
      description:
        "Start work on a Jira issue: create a GitHub branch named from the issue, create a Notion work doc from the Tandem template, and post both links back to the issue as a comment. Returns the linked bundle (issue, branch, doc).",
      inputSchema: {
        issueKey: issueKeySchema,
        repo: repoSchema,
        notionParentId: z
          .string()
          .optional()
          .describe("Notion parent page id for the work doc. Defaults to NOTION_PARENT_PAGE_ID."),
      },
    },
    wrap("tandem_start", (args) =>
      tandemStart(ctx, {
        issueKey: args.issueKey,
        repo: args.repo,
        notionParentId: args.notionParentId,
      }),
    ),
  );

  server.registerTool(
    "tandem_ship",
    {
      title: "Ship a branch",
      description:
        "Ship a branch: open a GitHub PR (title/body from the Jira issue and Notion doc), link the PR to the issue, transition the issue to In Review, and set the Notion doc status to In Review. Returns the PR URL and updated states.",
      inputSchema: {
        branch: z
          .string()
          .describe("Branch name, e.g. feature/TAN-123-retry-backoff"),
        repo: repoSchema,
        base: z
          .string()
          .optional()
          .describe('Base branch for the PR. Defaults to "main".'),
      },
    },
    wrap("tandem_ship", (args) =>
      tandemShip(ctx, {
        branch: args.branch,
        repo: args.repo,
        base: args.base,
      }),
    ),
  );

  server.registerTool(
    "tandem_status",
    {
      title: "Unified status for a Jira issue",
      description:
        "One unified view of a Jira issue: status/assignee, linked GitHub branch, PR and CI check status, and the linked Notion doc with its status. One call, no hunting across tabs.",
      inputSchema: {
        issueKey: issueKeySchema,
        repo: repoSchema,
      },
    },
    wrap("tandem_status", (args) =>
      tandemStatus(ctx, {
        issueKey: args.issueKey,
        repo: args.repo,
      }),
    ),
  );

  server.registerTool(
    "tandem_standup",
    {
      title: "What's in flight",
      description:
        "Compact standup summary: Jira issues In Progress or In Review for an assignee/project, each with its branch, PR, CI checks, and doc status.",
      inputSchema: {
        assignee: z
          .string()
          .optional()
          .describe("Assignee display name to filter by. Defaults to all."),
        project: z
          .string()
          .optional()
          .describe("Jira project key. Defaults to JIRA_PROJECT."),
        repo: repoSchema,
      },
    },
    wrap("tandem_standup", (args) =>
      tandemStandup(ctx, {
        assignee: args.assignee,
        project: args.project,
        repo: args.repo,
      }),
    ),
  );

  server.registerTool(
    "tandem_release_notes",
    {
      title: "Draft release notes",
      description:
        "Draft release notes from merged PRs in a date range plus their Jira issues, grouped by issue type, with links. Draft only — never publishes anything.",
      inputSchema: {
        repo: repoSchema,
        since: z
          .string()
          .describe("Start of range, ISO date, e.g. 2026-10-01"),
        until: z
          .string()
          .optional()
          .describe("End of range, ISO date. Defaults to today."),
      },
    },
    wrap("tandem_release_notes", (args) =>
      tandemReleaseNotes(ctx, {
        repo: args.repo,
        since: args.since,
        until: args.until,
      }),
    ),
  );

  server.registerTool(
    "github_pr",
    {
      title: "GitHub PR detail",
      description: "Get a GitHub pull request with its CI check runs.",
      inputSchema: {
        repo: repoSchema,
        number: z.number().int().describe("Pull request number."),
      },
    },
    wrap("github_pr", async (args) => {
      const repo = args.repo ?? ctx.config.githubRepo;
      const pr = await ctx.vc.getPullRequest(repo, args.number);
      const checks = await ctx.vc.getChecks(repo, pr.headSha ?? pr.head);
      return { ...pr, checks };
    }),
  );

  server.registerTool(
    "jira_issue",
    {
      title: "Jira issue detail",
      description: "Get a Jira issue with summary, type, status, assignee, and description.",
      inputSchema: { issueKey: issueKeySchema },
    },
    wrap("jira_issue", (args) => ctx.pm.getIssue(args.issueKey.toUpperCase())),
  );

  server.registerTool(
    "notion_page",
    {
      title: "Notion page summary",
      description: "Get a Notion page with its title, status, and a content summary.",
      inputSchema: {
        pageId: z.string().describe("Notion page id."),
      },
    },
    wrap("notion_page", (args) => ctx.docs.getPage(args.pageId)),
  );

  server.registerTool(
    "github_checks",
    {
      title: "CI checks for a ref",
      description: "Get CI check runs for a GitHub branch or commit SHA.",
      inputSchema: {
        repo: repoSchema,
        ref: z.string().describe("Branch name or commit SHA."),
      },
    },
    wrap("github_checks", (args) =>
      ctx.vc.getChecks(args.repo ?? ctx.config.githubRepo, args.ref),
    ),
  );

  server.registerTool(
    "tandem_health",
    {
      title: "Integration health",
      description:
        "Verify each configured integration (token present, API reachable) and report which are live vs missing — including observability status — without leaking any secret.",
      inputSchema: {},
    },
    wrap("tandem_health", async () => tandemHealthPayload(ctx)),
  );
}
