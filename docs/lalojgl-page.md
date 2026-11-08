# Tandem — portfolio landing page copy (lalojgl.com)

## Headline

**Tandem — GitHub, Jira, and Notion working in tandem.**

## Subheadline

Most MCP servers are 1:1 API wrappers. Tandem is workflow-level: one call starts the work across all three systems, one call ships it, one call tells you where it stands.

## What it does

Tandem treats a Jira issue as the unit of work and keeps GitHub and Notion linked to it automatically:

- **Start** — `tandem_start` takes a Jira issue and creates the GitHub branch (`feature/TAN-123-retry-backoff`), a Notion work doc (Context / Plan / Decisions / Links), and posts both links back to the issue.
- **Ship** — `tandem_ship` opens the PR from the issue and the doc, links it to the issue, moves the issue to In Review, and updates the doc status.
- **Status** — `tandem_status` gives one unified view: issue, branch, PR, CI checks, and doc — no hunting across three tabs.
- **Standup** — `tandem_standup` summarizes everything in flight for a person or project, with branch/PR/check/doc state on each item.
- **Release notes** — `tandem_release_notes` drafts notes from merged PRs and their Jira issues, grouped by type. Draft only, never publishes.

Plus read helpers (`github_pr`, `jira_issue`, `notion_page`, `github_checks`) and `tandem_health`, which reports which integrations are live.

## Why it's opinionated

The point is the workflow, not the vendors. Project management (Jira now, Linear next) and docs (Notion now, Confluence next) sit behind small interfaces, so swapping a vendor means one new adapter — the workflow tools don't change.

## Stack

TypeScript · MCP TypeScript SDK · Zod · Bun · Cloudflare Workers (Streamable HTTP) · PostHog + Sentry observability (optional, off by default) · DEMO_MODE fixtures so it runs with zero tokens.

## Links

- Repo: https://github.com/lalolalo1999/tandem-mcp (to be published)
- Live demo: https://tandem-mcp.<your-workers-subdomain>.workers.dev/mcp (deploy pending)
- Try it locally: `DEMO_MODE=true bun run src/stdio.ts` — see the README for the full setup.

## Demo snippet (what a client sees)

```json
// tandem_start { "issueKey": "TAN-124" }
{
  "issue": { "key": "TAN-124", "status": "To Do" },
  "branch": { "name": "fix/TAN-124-fix-flaky-login-test-in-ci" },
  "doc": { "title": "TAN-124 — Fix flaky login test in CI" }
}
```
