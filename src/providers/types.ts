/**
 * Provider interfaces.
 *
 * Tandem is opinionated about the workflow, not about the vendors.
 * Project management (Jira today, Linear in v2) and documentation
 * (Notion today, Confluence in v2) sit behind these small interfaces,
 * so swapping a vendor means writing one new module, not rewiring
 * the workflow tools.
 */

export interface Issue {
  key: string;
  summary: string;
  type: string;
  status: string;
  assignee?: string | null;
  url: string;
  description?: string | null;
  priority?: string | null;
}

export interface Branch {
  name: string;
  url: string;
  sha?: string;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: string;
  merged: boolean;
  mergedAt: string | null;
  head: string;
  headSha?: string;
  base: string;
  author: string;
}

export interface DocPage {
  id: string;
  title: string;
  url: string;
  status?: string | null;
  content?: string;
}

export interface HealthResult {
  configured: boolean;
  reachable: boolean;
  detail: string;
}

/** Project management: Jira in v1, Linear planned for v2. */
export interface ProjectManagementProvider {
  kind: string;
  getIssue(key: string): Promise<Issue>;
  addComment(key: string, body: string): Promise<{ id: string; url: string }>;
  transitionIssue(key: string, targetStatus: string): Promise<Issue>;
  searchIssues(jql: string): Promise<Issue[]>;
  health(): Promise<HealthResult>;
}

/** Version control + CI: GitHub in v1. */
export interface VersionControlProvider {
  kind: string;
  createBranch(repo: string, base: string, name: string): Promise<Branch>;
  getBranch(repo: string, name: string): Promise<Branch | null>;
  listBranches(repo: string): Promise<Branch[]>;
  openPullRequest(
    repo: string,
    opts: { title: string; body: string; head: string; base: string },
  ): Promise<PullRequest>;
  getPullRequest(repo: string, number: number): Promise<PullRequest>;
  listPullRequests(
    repo: string,
    opts?: { state?: "open" | "closed" | "all"; head?: string },
  ): Promise<PullRequest[]>;
  getChecks(repo: string, ref: string): Promise<CheckRun[]>;
  health(): Promise<HealthResult>;
}

/** Documentation: Notion in v1, Confluence planned for v2. */
export interface DocsProvider {
  kind: string;
  createPage(
    parentId: string,
    title: string,
    sections: { heading: string; body: string }[],
  ): Promise<DocPage>;
  getPage(id: string): Promise<DocPage>;
  searchPages(query: string): Promise<DocPage[]>;
  setStatus(id: string, status: string): Promise<DocPage>;
  health(): Promise<HealthResult>;
}

export interface TandemContext {
  config: import("../config.js").TandemConfig;
  pm: ProjectManagementProvider;
  vc: VersionControlProvider;
  docs: DocsProvider;
  /** Observability (PostHog + Sentry). No-op when unconfigured. */
  obs: import("../observability.js").Observability;
}
