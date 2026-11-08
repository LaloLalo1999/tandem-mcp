# Tandem

**GitHub, Jira, and Notion working in tandem around one unit of work — a Jira issue.**

Most MCP servers are 1:1 API wrappers: one tool per endpoint, and the agent still has to figure out the workflow. Tandem is the opposite. It is opinionated about the workflow, not the vendors: starting work on an issue means a branch, a work doc, and a link back — in one call. Shipping means a PR, a status transition, and a doc update — in one call. Status means one unified view, not three tabs. The vendors are swappable behind small interfaces; the workflow is the product.

## Tools

| Tool | What it does |
| --- | --- |
| `tandem_start` | From a Jira issue key: create a GitHub branch (`<type>/<KEY>-<slug>`), create a Notion work doc (Context / Plan / Decisions / Links), post both links to the issue. Returns the linked bundle. |
| `tandem_ship` | From a branch: open a GitHub PR (title/body from the issue + doc summary), link it to the issue, transition the issue to In Review, set the doc to In Review. |
| `tandem_status` | One unified view: Jira status/assignee, linked branch + PR + CI check status, linked Notion doc + status. |
| `tandem_standup` | What's in flight: issues In Progress / In Review for an assignee/project, each with branch, PR, checks, and doc status. |
| `tandem_release_notes` | Draft release notes from merged PRs in a date range + their Jira issues, grouped by type, with links. Draft only — never publishes. |
| `github_pr` | GitHub PR detail with CI check runs. |
| `jira_issue` | Jira issue detail. |
| `notion_page` | Notion page summary (title, status, content). |
| `github_checks` | CI check runs for a branch or commit SHA. |
| `tandem_health` | Verifies each integration (token present, API reachable) and reports live vs missing, including observability status. Never leaks secrets. |

All tools return structured JSON. Errors return `{ "error": "..." }` with `isError: true`.

## Architecture

```
src/
  server.ts        MCP server factory (shared by all transports)
  tools.ts         Tool registrations + observability wrapper
  workflows.ts     Workflow logic (start/ship/status/standup/release notes)
  config.ts        Env config (DEMO_MODE, tokens, observability)
  observability.ts PostHog + Sentry (optional, no-op when unconfigured)
  stdio.ts         stdio transport entry
  http.ts          Streamable HTTP entry (Bun.serve)
  worker.ts        Cloudflare Workers entry
  providers/
    types.ts       Provider interfaces (PM / VC / Docs)
    index.ts       Provider factory (demo vs live, incl. unconfigured stubs)
    demo.ts        In-memory fixtures (DEMO_MODE)
    github.ts      GitHub REST provider
    jira.ts        Jira Cloud REST provider
    notion.ts      Notion API provider
```

**Transports.** stdio for local clients (Claude Desktop, MCP Inspector) and Streamable HTTP (current MCP spec) for remote use. The HTTP transport runs stateless (a fresh MCP server per request, bound to one shared context, so demo fixtures persist across requests) and answers with JSON responses (`enableJsonResponse`) instead of SSE streaming — this keeps behavior identical on Bun, Node, and Workers.

**Provider interfaces.** Project management (`ProjectManagementProvider`: Jira today, Linear in v2) and documentation (`DocsProvider`: Notion today, Confluence in v2) sit behind small interfaces. Swapping a vendor means writing one new provider module, not rewiring the workflow tools. GitHub is the version-control + CI provider.

**Demo mode.** `DEMO_MODE=true` (or no tokens configured at all) runs everything against in-memory fixtures seeded with realistic Jira issues, a GitHub repo with branches/PRs/checks, and Notion pages — fully mutable, so `tandem_start` → `tandem_status` → `tandem_ship` works end to end with zero accounts and zero network calls. This is also what the test suite exercises.

## Setup

Requirements: Bun 1.x (recommended) or Node 24 + npm.

```bash
bun install          # or: npm install
cp .env.example .env # fill in real values (never commit .env)
```

Environment variables:

| Variable | Required | What it is |
| --- | --- | --- |
| `DEMO_MODE` | no | `true` = in-memory fixtures, no tokens needed |
| `GITHUB_TOKEN` | live mode | GitHub PAT (contents + pull_requests) |
| `GITHUB_REPO` | no | Default repo, `owner/repo` (default `lalolalo1999/tandem-demo`) |
| `JIRA_BASE_URL` | live mode | e.g. `https://your-site.atlassian.net` |
| `JIRA_EMAIL` | live mode | Jira account email |
| `JIRA_API_TOKEN` | live mode | Jira API token |
| `JIRA_PROJECT` | no | Default project key (default `TAN`) |
| `NOTION_API_KEY` | live mode | Notion internal integration token |
| `NOTION_PARENT_PAGE_ID` | live mode | Page under which work docs are created |
| `NOTION_STATUS_PROPERTY` | no | Status property name on work docs (default `Status`) |
| `POSTHOG_API_KEY` | no | Enables PostHog analytics (see below) |
| `POSTHOG_HOST` | no | Default `https://us.i.posthog.com` |
| `SENTRY_DSN` | no | Enables Sentry error tracking (see below) |
| `PORT` / `HOST` | no | HTTP transport bind (default `127.0.0.1:3000`) |

## Run it

```bash
# Demo mode, stdio (try it with zero setup):
DEMO_MODE=true bun start

# Demo mode, Streamable HTTP:
DEMO_MODE=true bun run start:http
# -> MCP endpoint http://127.0.0.1:3000/mcp
# -> health check  http://127.0.0.1:3000/health

# Live mode (tokens from .env):
bun start            # stdio
bun run start:http   # HTTP

# With MCP Inspector:
npx @modelcontextprotocol/inspector -- DEMO_MODE=true bun run src/stdio.ts
```

### Claude Desktop (stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tandem": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/tandem-mcp/src/stdio.ts"],
      "env": { "DEMO_MODE": "true" }
    }
  }
}
```

For live mode, replace `DEMO_MODE` with the real env vars (or point at a built `dist/stdio.js` with `node`).

## Demo mode

```bash
DEMO_MODE=true bun run start:http
```

Then point any MCP client at `http://127.0.0.1:3000/mcp` and try:

- `tandem_status` with `{"issueKey": "TAN-125"}` — branch, PR #7, passing checks, doc In Review.
- `tandem_start` with `{"issueKey": "TAN-124"}` — creates `fix/TAN-124-fix-flaky-login-test-in-ci` + a Notion doc.
- `tandem_ship` with `{"branch": "fix/TAN-124-fix-flaky-login-test-in-ci"}` — opens PR #8, issue → In Review.
- `tandem_standup` with `{"assignee": "Eduardo Javier Garcia Lopez"}`.
- `tandem_release_notes` with `{"since": "2026-10-01", "until": "2026-11-30"}`.
- `tandem_health` — all three demo providers live, observability disabled.

Seeded fixtures: issues TAN-123 (In Progress), TAN-124 (To Do), TAN-125 (In Review), TAN-126 (Done); repo `lalolalo1999/tandem-demo` with PRs #5–#7; one Notion doc for TAN-125.

## Deploy (Cloudflare Workers)

The Worker entry is `src/worker.ts` (Streamable HTTP, stateless, JSON responses). Config is in `wrangler.toml` — intentionally generic; the deploy target is TBD while the Cloudflare account is checked for existing Workers.

```bash
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put JIRA_API_TOKEN
npx wrangler secret put NOTION_API_KEY
# ...and JIRA_BASE_URL, JIRA_EMAIL, NOTION_PARENT_PAGE_ID as vars/secrets
```

With no provider tokens configured, the Worker runs in demo mode — suitable as a public demo endpoint. `wrangler.toml` sets `compatibility_flags = ["nodejs_compat"]` (used for `Buffer` in the Jira provider).

## Observability

Both integrations are **optional and off unless configured**. When unconfigured, they are complete no-ops: no SDKs loaded, no network calls (verified by `tests/observability.test.ts`).

### PostHog (product analytics)

Enable with `POSTHOG_API_KEY` (+ optional `POSTHOG_HOST`, default `https://us.i.posthog.com`). One event per tool call:

- Event: `tandem_tool_call`
- Properties: `tool`, `duration_ms`, `success`, plus allow-listed identifiers — `issue_key`, `repo`, `doc_id`, `branch`.

What is **never** sent: tokens, secrets, issue descriptions, doc content, PR bodies, or any other free text. The instrumentation passes an explicit allow-listed identifier record; raw tool arguments are never forwarded. Implementation is a direct `POST` to PostHog's public capture API (no vendor SDK), so it works identically on Bun, Node, and Workers.

Disable: unset `POSTHOG_API_KEY`.

### Sentry (error tracking)

Enable with `SENTRY_DSN` (e.g. `https://<publicKey>@o<org>.ingest.sentry.io/<projectId>`). Captures:

- Exceptions thrown by tool handlers (with the tool name as a tag).
- Transport errors (via the observability layer; the HTTP/Worker entries flush pending events on shutdown via `waitUntil`).

The event payload contains the exception type, message, and a best-effort stack trace — no tokens, no request bodies, no issue/doc content. Implementation posts a Sentry envelope directly to the DSN's ingest endpoint (no vendor SDK). A malformed DSN logs a warning and disables Sentry.

Disable: unset `SENTRY_DSN`.

### Status

`tandem_health` reports both under `observability`: `{"posthog": "enabled"|"disabled", "sentry": "enabled"|"disabled"}`.

## Tests

```bash
bun test        # 21 tests: one per workflow tool + read helpers + health + observability
bun run build   # tsc emit to dist/
bun run typecheck
```

## Roadmap

- **v2 adapters**: Linear as the project-management alternative to Jira, Confluence as the docs alternative to Notion — both behind the existing provider interfaces, selectable per workspace.
- **Craft** as an additional docs target (same `DocsProvider` interface).
- **CI/CD depth**: `tandem_ship` optionally waiting on checks before transitioning the issue; a `tandem_merge` tool that merges the PR once checks pass and moves the issue to Done.
- **Release notes**: publish the draft to a Notion page (currently draft-only by design).
- **Auth for the HTTP transport**: API-key / OAuth gating for the deployed Worker (currently open in demo mode by design).

## License

MIT — see [LICENSE](LICENSE).
