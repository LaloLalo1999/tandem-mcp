/**
 * Workflow logic: GitHub + Jira + Notion working in tandem around one
 * unit of work — a Jira issue.
 *
 * These functions are transport-agnostic (they take a TandemContext and
 * plain arguments) so they can be called from MCP tools, tests, or any
 * future transport. They never publish or mutate anything outside the
 * single unit of work they were asked about — except tandem_release_notes,
 * which is explicitly draft-only.
 */

import type {
  Branch,
  CheckRun,
  DocPage,
  Issue,
  PullRequest,
  TandemContext,
} from "./providers/types.js";

export const ISSUE_KEY_RE = /^([A-Z][A-Z0-9]+)-(\d+)$/;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

function branchTypeFor(issueType: string): string {
  switch (issueType.toLowerCase()) {
    case "bug":
      return "fix";
    case "task":
    case "sub-task":
    case "subtask":
      return "chore";
    default:
      return "feature";
  }
}

export function branchNameFor(issue: Issue): string {
  return `${branchTypeFor(issue.type)}/${issue.key}-${slugify(issue.summary)}`;
}

function extractIssueKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)) {
    keys.add(m[1]);
  }
  return [...keys];
}

async function findDocForIssue(
  ctx: TandemContext,
  issueKey: string,
): Promise<DocPage | null> {
  const pages = await ctx.docs.searchPages(issueKey);
  return pages[0] ?? null;
}

async function findBranchForIssue(
  ctx: TandemContext,
  repo: string,
  issueKey: string,
): Promise<Branch | null> {
  const branches = await ctx.vc.listBranches(repo);
  return (
    branches.find((b) => b.name.includes(issueKey)) ??
    branches.find((b) => b.name.endsWith(`-${issueKey}`)) ??
    null
  );
}

function checksSummary(checks: CheckRun[]): {
  total: number;
  passing: number;
  failing: number;
  pending: number;
} {
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const c of checks) {
    if (c.conclusion === "success") passing++;
    else if (c.conclusion === "failure" || c.conclusion === "cancelled") failing++;
    else pending++;
  }
  return { total: checks.length, passing, failing, pending };
}

/* ------------------------------------------------------------------ */
/* tandem_start                                                        */
/* ------------------------------------------------------------------ */

export interface StartBundle {
  issue: Issue;
  branch: Branch;
  doc: DocPage;
  comment: { id: string; url: string };
}

export async function tandemStart(
  ctx: TandemContext,
  args: { issueKey: string; repo?: string; notionParentId?: string },
): Promise<StartBundle> {
  const repo = args.repo ?? ctx.config.githubRepo;
  const issue = await ctx.pm.getIssue(args.issueKey.toUpperCase());

  const branchName = branchNameFor(issue);
  const branch = await ctx.vc.createBranch(repo, "main", branchName);

  const parentId =
    args.notionParentId ??
    ctx.config.notionParentPageId ??
    (ctx.config.demoMode ? "demo-parent" : undefined);
  if (!parentId) {
    throw new Error(
      "No Notion parent page configured: set NOTION_PARENT_PAGE_ID or pass notionParentId (or run with DEMO_MODE=true)",
    );
  }
  const doc = await ctx.docs.createPage(parentId, `${issue.key} — ${issue.summary}`, [
    {
      heading: "Context",
      body: `${issue.summary}\nJira: ${issue.url}\nType: ${issue.type} · Status: ${issue.status} · Assignee: ${issue.assignee ?? "unassigned"}`,
    },
    {
      heading: "Plan",
      body: "1. \n2. \n3. ",
    },
    { heading: "Decisions", body: "(none yet)" },
    {
      heading: "Links",
      body: `Jira issue: ${issue.url}\nBranch: ${branch.url}`,
    },
  ]);

  const comment = await ctx.pm.addComment(
    issue.key,
    `Tandem started work on this issue.\nBranch: ${branch.url}\nWork doc: ${doc.url}`,
  );

  return { issue, branch, doc, comment };
}

/* ------------------------------------------------------------------ */
/* tandem_ship                                                         */
/* ------------------------------------------------------------------ */

export interface ShipResult {
  pr: PullRequest;
  issue: Issue;
  doc: DocPage | null;
}

export async function tandemShip(
  ctx: TandemContext,
  args: { branch: string; repo?: string; base?: string },
): Promise<ShipResult> {
  const repo = args.repo ?? ctx.config.githubRepo;
  const base = args.base ?? "main";
  const key = extractIssueKeys(args.branch)[0];
  if (!key) {
    throw new Error(
      `Could not find a Jira issue key in branch name "${args.branch}" (expected e.g. feature/TAN-123-some-work)`,
    );
  }
  const issue = await ctx.pm.getIssue(key);
  const doc = await findDocForIssue(ctx, key);

  const open = await ctx.vc.listPullRequests(repo, {
    state: "open",
    head: args.branch,
  });
  let pr = open[0];
  if (!pr) {
    const docSummary = doc?.content
      ? doc.content.slice(0, 500)
      : "(no work doc yet)";
    pr = await ctx.vc.openPullRequest(repo, {
      title: `${issue.key}: ${issue.summary}`,
      body: [
        `${issue.summary}`,
        ``,
        `Jira: ${issue.url}`,
        doc ? `Work doc: ${doc.url}` : null,
        ``,
        `## Work doc summary`,
        docSummary,
        ``,
        `---`,
        `Opened by Tandem from branch \`${args.branch}\`.`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
      head: args.branch,
      base,
    });
  }

  await ctx.pm.addComment(issue.key, `Pull request opened: ${pr.url}`);
  const updatedIssue = await ctx.pm.transitionIssue(issue.key, "In Review");
  let updatedDoc: DocPage | null = null;
  if (doc) {
    updatedDoc = await ctx.docs.setStatus(doc.id, "In Review");
  }

  return { pr, issue: updatedIssue, doc: updatedDoc };
}

/* ------------------------------------------------------------------ */
/* tandem_status                                                       */
/* ------------------------------------------------------------------ */

export interface StatusView {
  issue: Issue;
  branch: Branch | null;
  pr: (PullRequest & { checks: CheckRun[]; checksSummary: ReturnType<typeof checksSummary> }) | null;
  doc: DocPage | null;
}

export async function tandemStatus(
  ctx: TandemContext,
  args: { issueKey: string; repo?: string },
): Promise<StatusView> {
  const repo = args.repo ?? ctx.config.githubRepo;
  const issue = await ctx.pm.getIssue(args.issueKey.toUpperCase());
  const branch = await findBranchForIssue(ctx, repo, issue.key);

  let pr: StatusView["pr"] = null;
  if (branch) {
    const prs = await ctx.vc.listPullRequests(repo, {
      state: "all",
      head: branch.name,
    });
    const found = prs[0];
    if (found) {
      const checks = await ctx.vc.getChecks(repo, found.headSha ?? found.head);
      pr = { ...found, checks, checksSummary: checksSummary(checks) };
    }
  }

  const doc = await findDocForIssue(ctx, issue.key);
  return { issue, branch, pr, doc };
}

/* ------------------------------------------------------------------ */
/* tandem_standup                                                      */
/* ------------------------------------------------------------------ */

export interface StandupEntry {
  key: string;
  summary: string;
  type: string;
  status: string;
  assignee: string | null;
  url: string;
  branch: string | null;
  pr: { number: number; url: string; state: string } | null;
  checks: { total: number; passing: number; failing: number; pending: number } | null;
  doc: { title: string; url: string; status: string | null } | null;
}

export async function tandemStandup(
  ctx: TandemContext,
  args: { assignee?: string; project?: string; repo?: string },
): Promise<{ entries: StandupEntry[] }> {
  const repo = args.repo ?? ctx.config.githubRepo;
  const project = (args.project ?? ctx.config.jiraProject).toUpperCase();
  const clauses = [`project = ${project}`, `status in ("In Progress", "In Review")`];
  if (args.assignee) clauses.push(`assignee = "${args.assignee}"`);
  const issues = await ctx.pm.searchIssues(clauses.join(" AND "));

  const entries: StandupEntry[] = [];
  for (const issue of issues.slice(0, 20)) {
    const branch = await findBranchForIssue(ctx, repo, issue.key);
    let pr: StandupEntry["pr"] = null;
    let checks: StandupEntry["checks"] = null;
    if (branch) {
      const prs = await ctx.vc.listPullRequests(repo, {
        state: "all",
        head: branch.name,
      });
      const found = prs[0];
      if (found) {
        pr = { number: found.number, url: found.url, state: found.state };
        const runs = await ctx.vc.getChecks(repo, found.headSha ?? found.head);
        checks = checksSummary(runs);
      }
    }
    const doc = await findDocForIssue(ctx, issue.key);
    entries.push({
      key: issue.key,
      summary: issue.summary,
      type: issue.type,
      status: issue.status,
      assignee: issue.assignee ?? null,
      url: issue.url,
      branch: branch?.name ?? null,
      pr,
      checks,
      doc: doc
        ? { title: doc.title, url: doc.url, status: doc.status ?? null }
        : null,
    });
  }
  return { entries };
}

/* ------------------------------------------------------------------ */
/* tandem_release_notes (draft only — never publishes)                 */
/* ------------------------------------------------------------------ */

export interface ReleaseNotesDraft {
  repo: string;
  since: string;
  until: string;
  groups: {
    type: string;
    items: {
      pr: { number: number; title: string; url: string; mergedAt: string | null };
      issue: { key: string; summary: string; url: string } | null;
    }[];
  }[];
  markdown: string;
}

export async function tandemReleaseNotes(
  ctx: TandemContext,
  args: { repo?: string; since: string; until?: string },
): Promise<ReleaseNotesDraft> {
  const repo = args.repo ?? ctx.config.githubRepo;
  const since = new Date(args.since);
  const until = args.until ? new Date(args.until) : new Date();
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error("since/until must be ISO dates, e.g. 2026-10-01");
  }

  const prs = await ctx.vc.listPullRequests(repo, { state: "closed" });
  const merged = prs.filter(
    (p) =>
      p.merged &&
      p.mergedAt &&
      new Date(p.mergedAt) >= since &&
      new Date(p.mergedAt) <= until,
  );

  const grouped = new Map<string, ReleaseNotesDraft["groups"][number]["items"]>();
  for (const pr of merged) {
    const keys = extractIssueKeys(`${pr.title}\n${pr.body ?? ""}`);
    let issue: ReleaseNotesDraft["groups"][number]["items"][number]["issue"] = null;
    let type = "Other";
    if (keys[0]) {
      try {
        const full = await ctx.pm.getIssue(keys[0]);
        issue = { key: full.key, summary: full.summary, url: full.url };
        type = full.type;
      } catch {
        // Issue referenced but not readable — keep the PR under "Other".
      }
    }
    const items = grouped.get(type) ?? [];
    items.push({
      pr: { number: pr.number, title: pr.title, url: pr.url, mergedAt: pr.mergedAt },
      issue,
    });
    grouped.set(type, items);
  }

  const groups = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, items]) => ({ type, items }));

  const lines = [
    `# Release notes (draft) — ${repo}`,
    ``,
    `${args.since} → ${args.until ?? until.toISOString().slice(0, 10)}`,
    ``,
  ];
  for (const g of groups) {
    lines.push(`## ${g.type}`);
    for (const item of g.items) {
      const ref = item.issue
        ? ` (${item.issue.key}: ${item.issue.summary})`
        : "";
      lines.push(`- ${item.pr.title}${ref} — [PR #${item.pr.number}](${item.pr.url})`);
    }
    lines.push(``);
  }
  lines.push(`_Draft generated by Tandem — review before publishing._`);

  return {
    repo,
    since: args.since,
    until: args.until ?? until.toISOString().slice(0, 10),
    groups,
    markdown: lines.join("\n"),
  };
}
