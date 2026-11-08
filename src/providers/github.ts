/**
 * Real GitHub provider (REST API v3).
 * Auth: GITHUB_TOKEN (classic PAT or fine-grained token with
 * contents + pull_requests read/write).
 */

import type {
  Branch,
  CheckRun,
  HealthResult,
  PullRequest,
  VersionControlProvider,
} from "./types.js";

const API = "https://api.github.com";

async function gh<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub API ${res.status} on ${path}: ${body.slice(0, 300)}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface GhRef {
  object: { sha: string };
}
interface GhBranch {
  name: string;
  commit: { sha: string };
}
interface GhPr {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  merged_at: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string };
}
interface GhCheckRuns {
  check_runs: {
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
  }[];
}

function toPr(p: GhPr): PullRequest {
  return {
    number: p.number,
    title: p.title,
    body: p.body,
    url: p.html_url,
    state: p.state,
    merged: p.merged_at !== null,
    mergedAt: p.merged_at,
    head: p.head.ref,
    headSha: p.head.sha,
    base: p.base.ref,
    author: p.user.login,
  };
}

export class GitHubProvider implements VersionControlProvider {
  readonly kind = "github";
  constructor(private token: string) {}

  async createBranch(
    repo: string,
    base: string,
    name: string,
  ): Promise<Branch> {
    const existing = await this.getBranch(repo, name);
    if (existing) return existing;
    const ref = await gh<GhRef>(
      this.token,
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
    );
    await gh(this.token, `/repos/${repo}/git/refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }),
    });
    return {
      name,
      url: `https://github.com/${repo}/tree/${encodeURIComponent(name)}`,
      sha: ref.object.sha,
    };
  }

  async getBranch(repo: string, name: string): Promise<Branch | null> {
    try {
      const b = await gh<GhBranch>(
        this.token,
        `/repos/${repo}/branches/${encodeURIComponent(name)}`,
      );
      return {
        name: b.name,
        url: `https://github.com/${repo}/tree/${encodeURIComponent(b.name)}`,
        sha: b.commit.sha,
      };
    } catch {
      return null;
    }
  }

  async listBranches(repo: string): Promise<Branch[]> {
    const branches = await gh<GhBranch[]>(
      this.token,
      `/repos/${repo}/branches?per_page=100`,
    );
    return branches.map((b) => ({
      name: b.name,
      url: `https://github.com/${repo}/tree/${encodeURIComponent(b.name)}`,
      sha: b.commit.sha,
    }));
  }

  async openPullRequest(
    repo: string,
    opts: { title: string; body: string; head: string; base: string },
  ): Promise<PullRequest> {
    const pr = await gh<GhPr>(this.token, `/repos/${repo}/pulls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return toPr(pr);
  }

  async getPullRequest(repo: string, number: number): Promise<PullRequest> {
    const pr = await gh<GhPr>(this.token, `/repos/${repo}/pulls/${number}`);
    return toPr(pr);
  }

  async listPullRequests(
    repo: string,
    opts?: { state?: "open" | "closed" | "all"; head?: string },
  ): Promise<PullRequest[]> {
    const params = new URLSearchParams({
      state: opts?.state ?? "all",
      per_page: "100",
    });
    if (opts?.head) params.set("head", opts.head);
    const prs = await gh<GhPr[]>(
      this.token,
      `/repos/${repo}/pulls?${params}`,
    );
    return prs.map(toPr);
  }

  async getChecks(repo: string, ref: string): Promise<CheckRun[]> {
    const runs = await gh<GhCheckRuns>(
      this.token,
      `/repos/${repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
    );
    return runs.check_runs.map((c) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      url: c.html_url,
    }));
  }

  async health(): Promise<HealthResult> {
    try {
      await gh(this.token, "/rate_limit");
      return {
        configured: true,
        reachable: true,
        detail: "GitHub API reachable",
      };
    } catch (err) {
      return {
        configured: true,
        reachable: false,
        detail: `GitHub API error: ${(err as Error).message.slice(0, 200)}`,
      };
    }
  }
}
