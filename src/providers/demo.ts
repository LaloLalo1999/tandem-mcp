/**
 * In-memory demo providers.
 *
 * Seeded with a small, realistic fixture set (Jira issues, a GitHub repo
 * with branches/PRs/checks, Notion pages) and fully mutable, so the
 * workflow tools behave end to end without any tokens. This is what
 * DEMO_MODE runs against — and what the test suite exercises.
 */

import type {
  Branch,
  CheckRun,
  DocPage,
  DocsProvider,
  HealthResult,
  Issue,
  ProjectManagementProvider,
  PullRequest,
  VersionControlProvider,
} from "./types.js";

const DEMO_HEALTH: HealthResult = {
  configured: true,
  reachable: true,
  detail: "demo fixture (no network calls)",
};

const REPO = "lalolalo1999/tandem-demo";
const ISSUE_URL = (key: string) =>
  `https://tandem-demo.atlassian.net/browse/${key}`;
const BRANCH_URL = (name: string) =>
  `https://github.com/${REPO}/tree/${encodeURIComponent(name)}`;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ------------------------------------------------------------------ */
/* Jira (demo)                                                         */
/* ------------------------------------------------------------------ */

export class DemoJira implements ProjectManagementProvider {
  readonly kind = "demo-pm";
  private issues: Issue[] = [
    {
      key: "TAN-123",
      summary: "Add retry with backoff to the checkout worker",
      type: "Story",
      status: "In Progress",
      assignee: "Eduardo Javier Garcia Lopez",
      url: ISSUE_URL("TAN-123"),
      description:
        "The checkout worker fails hard on transient 5xx from the payment API. Add exponential backoff with jitter and a max of 5 attempts.",
      priority: "High",
    },
    {
      key: "TAN-124",
      summary: "Fix flaky login test in CI",
      type: "Bug",
      status: "To Do",
      assignee: "Eduardo Javier Garcia Lopez",
      url: ISSUE_URL("TAN-124"),
      description:
        "login.spec.ts fails intermittently on CI only. Suspect a race between the session cookie and the redirect.",
      priority: "Medium",
    },
    {
      key: "TAN-125",
      summary: "Draft release notes for v0.9.0",
      type: "Task",
      status: "In Review",
      assignee: "Ricardo Soberanis",
      url: ISSUE_URL("TAN-125"),
      description: "Collect merged PRs since v0.8.0 and draft notes grouped by type.",
      priority: "Low",
    },
    {
      key: "TAN-126",
      summary: "Add MCP tool for release notes",
      type: "Story",
      status: "Done",
      assignee: "Eduardo Javier Garcia Lopez",
      url: ISSUE_URL("TAN-126"),
      description: "tandem_release_notes: draft notes from merged PRs + their Jira issues.",
      priority: "Medium",
    },
  ];
  private comments: Record<string, string[]> = { "TAN-125": [] };

  async getIssue(key: string): Promise<Issue> {
    const issue = this.issues.find((i) => i.key === key.toUpperCase());
    if (!issue) throw new Error(`Jira issue ${key} not found (demo fixture)`);
    return clone(issue);
  }

  async addComment(
    key: string,
    body: string,
  ): Promise<{ id: string; url: string }> {
    const issue = await this.getIssue(key);
    (this.comments[issue.key] ??= []).push(body);
    return {
      id: `demo-comment-${this.comments[issue.key].length}`,
      url: `${issue.url}?focusedCommentId=demo-comment-${this.comments[issue.key].length}`,
    };
  }

  async transitionIssue(key: string, targetStatus: string): Promise<Issue> {
    const issue = this.issues.find((i) => i.key === key.toUpperCase());
    if (!issue) throw new Error(`Jira issue ${key} not found (demo fixture)`);
    issue.status = targetStatus;
    return clone(issue);
  }

  async searchIssues(jql: string): Promise<Issue[]> {
    let out = [...this.issues];
    const assignee = /assignee\s*=\s*"([^"]+)"/i.exec(jql)?.[1];
    if (assignee) {
      out = out.filter(
        (i) => i.assignee?.toLowerCase().includes(assignee.toLowerCase()),
      );
    }
    const statuses = /status\s+in\s*\(([^)]+)\)/i.exec(jql)?.[1];
    if (statuses) {
      const wanted = statuses
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, "").toLowerCase());
      out = out.filter((i) => wanted.includes(i.status.toLowerCase()));
    }
    const project = /project\s*=\s*([A-Z0-9]+)/i.exec(jql)?.[1];
    if (project) {
      out = out.filter((i) => i.key.startsWith(`${project.toUpperCase()}-`));
    }
    if (/status\s*!=\s*"Done"|status\s*!=\s*Done/i.test(jql)) {
      out = out.filter((i) => i.status !== "Done");
    }
    return clone(out);
  }

  async health(): Promise<HealthResult> {
    return DEMO_HEALTH;
  }
}

/* ------------------------------------------------------------------ */
/* GitHub (demo)                                                       */
/* ------------------------------------------------------------------ */

export class DemoGitHub implements VersionControlProvider {
  readonly kind = "demo-vc";
  private branches: Branch[] = [
    { name: "main", url: BRANCH_URL("main"), sha: "demo-sha-main" },
    {
      name: "feature/TAN-125-release-notes",
      url: BRANCH_URL("feature/TAN-125-release-notes"),
      sha: "demo-sha-tan125",
    },
  ];
  private prs: PullRequest[] = [
    {
      number: 7,
      title: "TAN-125: Draft release notes for v0.9.0",
      body: "Draft notes for v0.9.0.\n\nJira: TAN-125",
      url: `https://github.com/${REPO}/pull/7`,
      state: "open",
      merged: false,
      mergedAt: null,
      head: "feature/TAN-125-release-notes",
      headSha: "demo-sha-tan125",
      base: "main",
      author: "lalolalo1999",
    },
    {
      number: 6,
      title: "TAN-124: Fix flaky login test in CI",
      body: "Await the session cookie before asserting the redirect.\n\nJira: TAN-124",
      url: `https://github.com/${REPO}/pull/6`,
      state: "closed",
      merged: true,
      mergedAt: "2026-11-02T15:30:00.000Z",
      head: "fix/TAN-124-flaky-login-test",
      headSha: "demo-sha-tan124",
      base: "main",
      author: "lalolalo1999",
    },
    {
      number: 5,
      title: "TAN-123: Add retry with backoff to the checkout worker",
      body: "Exponential backoff with jitter, max 5 attempts.\n\nJira: TAN-123",
      url: `https://github.com/${REPO}/pull/5`,
      state: "closed",
      merged: true,
      mergedAt: "2026-10-28T11:00:00.000Z",
      head: "feature/TAN-123-retry-backoff-checkout",
      headSha: "demo-sha-tan123",
      base: "main",
      author: "lalolalo1999",
    },
  ];
  private checks: Record<string, CheckRun[]> = {
    "demo-sha-tan125": [
      {
        name: "ci / test",
        status: "completed",
        conclusion: "success",
        url: `https://github.com/${REPO}/actions/runs/101`,
      },
      {
        name: "ci / lint",
        status: "completed",
        conclusion: "success",
        url: `https://github.com/${REPO}/actions/runs/102`,
      },
    ],
    "demo-sha-tan124": [
      {
        name: "ci / test",
        status: "completed",
        conclusion: "success",
        url: `https://github.com/${REPO}/actions/runs/99`,
      },
    ],
    "demo-sha-tan123": [
      {
        name: "ci / test",
        status: "completed",
        conclusion: "success",
        url: `https://github.com/${REPO}/actions/runs/97`,
      },
      {
        name: "ci / typecheck",
        status: "completed",
        conclusion: "success",
        url: `https://github.com/${REPO}/actions/runs/98`,
      },
    ],
  };
  private nextPr = 8;

  async createBranch(
    _repo: string,
    _base: string,
    name: string,
  ): Promise<Branch> {
    const existing = this.branches.find((b) => b.name === name);
    if (existing) return clone(existing);
    const branch: Branch = {
      name,
      url: BRANCH_URL(name),
      sha: `demo-sha-${name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
    };
    this.branches.push(branch);
    return clone(branch);
  }

  async getBranch(_repo: string, name: string): Promise<Branch | null> {
    return clone(this.branches.find((b) => b.name === name) ?? null);
  }

  async listBranches(_repo: string): Promise<Branch[]> {
    return clone(this.branches);
  }

  async openPullRequest(
    _repo: string,
    opts: { title: string; body: string; head: string; base: string },
  ): Promise<PullRequest> {
    const head = this.branches.find((b) => b.name === opts.head);
    const pr: PullRequest = {
      number: this.nextPr++,
      title: opts.title,
      body: opts.body,
      url: `https://github.com/${REPO}/pull/${this.nextPr - 1}`,
      state: "open",
      merged: false,
      mergedAt: null,
      head: opts.head,
      headSha: head?.sha,
      base: opts.base,
      author: "lalolalo1999",
    };
    this.prs.push(pr);
    this.checks[pr.headSha ?? ""] = [
      {
        name: "ci / test",
        status: "queued",
        conclusion: null,
        url: `https://github.com/${REPO}/actions/runs/demo-${pr.number}`,
      },
    ];
    return clone(pr);
  }

  async getPullRequest(_repo: string, number: number): Promise<PullRequest> {
    const pr = this.prs.find((p) => p.number === number);
    if (!pr) throw new Error(`PR #${number} not found (demo fixture)`);
    return clone(pr);
  }

  async listPullRequests(
    _repo: string,
    opts?: { state?: "open" | "closed" | "all"; head?: string },
  ): Promise<PullRequest[]> {
    let out = [...this.prs];
    if (opts?.state && opts.state !== "all") {
      out = out.filter((p) => p.state === opts.state);
    }
    if (opts?.head) out = out.filter((p) => p.head === opts.head);
    return clone(out);
  }

  async getChecks(_repo: string, ref: string): Promise<CheckRun[]> {
    const branch = this.branches.find((b) => b.name === ref);
    const sha = branch?.sha ?? ref;
    return clone(this.checks[sha] ?? []);
  }

  async health(): Promise<HealthResult> {
    return DEMO_HEALTH;
  }
}

/* ------------------------------------------------------------------ */
/* Notion (demo)                                                       */
/* ------------------------------------------------------------------ */

export class DemoNotion implements DocsProvider {
  readonly kind = "demo-docs";
  private pages: DocPage[] = [
    {
      id: "demo-page-tan-125",
      title: "TAN-125 — Draft release notes for v0.9.0",
      url: "https://notion.so/demo-page-tan-125",
      status: "In Review",
      content:
        "Context: Collect merged PRs since v0.8.0.\nPlan: Group by type, link each PR and Jira issue.\nDecisions: (none yet)\nLinks: TAN-125, PR #7",
    },
  ];
  private nextId = 1;

  async createPage(
    _parentId: string,
    title: string,
    sections: { heading: string; body: string }[],
  ): Promise<DocPage> {
    const page: DocPage = {
      id: `demo-page-${this.nextId++}`,
      title,
      url: `https://notion.so/demo-page-${this.nextId - 1}`,
      status: "Draft",
      content: sections.map((s) => `${s.heading}: ${s.body}`).join("\n"),
    };
    this.pages.push(page);
    return clone(page);
  }

  async getPage(id: string): Promise<DocPage> {
    const page = this.pages.find((p) => p.id === id);
    if (!page) throw new Error(`Notion page ${id} not found (demo fixture)`);
    return clone(page);
  }

  async searchPages(query: string): Promise<DocPage[]> {
    const q = query.toLowerCase();
    return clone(
      this.pages.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.content ?? "").toLowerCase().includes(q),
      ),
    );
  }

  async setStatus(id: string, status: string): Promise<DocPage> {
    const page = this.pages.find((p) => p.id === id);
    if (!page) throw new Error(`Notion page ${id} not found (demo fixture)`);
    page.status = status;
    return clone(page);
  }

  async health(): Promise<HealthResult> {
    return DEMO_HEALTH;
  }
}
