/**
 * Real Jira provider (Jira Cloud REST API v3).
 * Auth: JIRA_EMAIL + JIRA_API_TOKEN (Basic auth).
 */

import type {
  HealthResult,
  Issue,
  ProjectManagementProvider,
} from "./types.js";

interface JiraIssueFields {
  summary: string;
  issuetype: { name: string };
  status: { name: string };
  assignee?: { displayName: string } | null;
  description?: unknown;
  priority?: { name: string } | null;
}
interface JiraIssue {
  key: string;
  fields: JiraIssueFields;
  self: string;
}
interface JiraSearch {
  issues: JiraIssue[];
}
interface JiraTransitions {
  transitions: { id: string; to: { name: string } }[];
}

/** Flatten Atlassian Document Format to plain text (best effort). */
function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map(adfToText).join("");
  }
  return "";
}

export class JiraProvider implements ProjectManagementProvider {
  readonly kind = "jira";
  private headers: Record<string, string>;

  constructor(
    private baseUrl: string,
    email: string,
    apiToken: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
    };
  }

  private async jira<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Jira API ${res.status} on ${path}: ${body.slice(0, 300)}`,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private toIssue(raw: JiraIssue): Issue {
    const f = raw.fields;
    return {
      key: raw.key,
      summary: f.summary,
      type: f.issuetype.name,
      status: f.status.name,
      assignee: f.assignee?.displayName ?? null,
      url: `${this.baseUrl}/browse/${raw.key}`,
      description: f.description ? adfToText(f.description) : null,
      priority: f.priority?.name ?? null,
    };
  }

  private fieldsParam(): string {
    return "summary,issuetype,status,assignee,description,priority";
  }

  async getIssue(key: string): Promise<Issue> {
    const raw = await this.jira<JiraIssue>(
      `/rest/api/3/issue/${encodeURIComponent(key.toUpperCase())}?fields=${this.fieldsParam()}`,
    );
    return this.toIssue(raw);
  }

  async addComment(
    key: string,
    body: string,
  ): Promise<{ id: string; url: string }> {
    const created = await this.jira<{ id: string; self: string }>(
      `/rest/api/3/issue/${encodeURIComponent(key.toUpperCase())}/comment`,
      {
        method: "POST",
        body: JSON.stringify({
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: body }],
              },
            ],
          },
        }),
      },
    );
    return { id: created.id, url: `${this.baseUrl}/browse/${key.toUpperCase()}` };
  }

  async transitionIssue(key: string, targetStatus: string): Promise<Issue> {
    const upper = key.toUpperCase();
    const transitions = await this.jira<JiraTransitions>(
      `/rest/api/3/issue/${encodeURIComponent(upper)}/transitions`,
    );
    const match = transitions.transitions.find(
      (t) => t.to.name.toLowerCase() === targetStatus.toLowerCase(),
    );
    if (!match) {
      const available = transitions.transitions
        .map((t) => t.to.name)
        .join(", ");
      throw new Error(
        `No Jira transition to "${targetStatus}" for ${upper}. Available: ${available}`,
      );
    }
    await this.jira(`/rest/api/3/issue/${encodeURIComponent(upper)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    return this.getIssue(upper);
  }

  async searchIssues(jql: string): Promise<Issue[]> {
    const res = await this.jira<JiraSearch>("/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql,
        fields: this.fieldsParam().split(","),
        maxResults: 50,
      }),
    });
    return res.issues.map((i) => this.toIssue(i));
  }

  async health(): Promise<HealthResult> {
    try {
      await this.jira("/rest/api/3/myself");
      return { configured: true, reachable: true, detail: "Jira API reachable" };
    } catch (err) {
      return {
        configured: true,
        reachable: false,
        detail: `Jira API error: ${(err as Error).message.slice(0, 200)}`,
      };
    }
  }
}
