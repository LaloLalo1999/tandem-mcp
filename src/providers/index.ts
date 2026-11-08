/**
 * Provider factory.
 *
 * DEMO_MODE (or no tokens at all) -> in-memory demo fixtures.
 * Otherwise -> real GitHub / Jira / Notion providers. A provider whose
 * credentials are missing still builds, but its health() reports
 * `configured: false` and its tools fail with a clear error telling
 * the operator which env var is missing.
 */

import type { TandemConfig } from "../config.js";
import { createObservability } from "../observability.js";
import { DemoGitHub, DemoJira, DemoNotion } from "./demo.js";
import { GitHubProvider } from "./github.js";
import { JiraProvider } from "./jira.js";
import { NotionProvider } from "./notion.js";
import type {
  DocsProvider,
  ProjectManagementProvider,
  TandemContext,
  VersionControlProvider,
} from "./types.js";

class UnconfiguredProvider {
  constructor(
    private name: string,
    private missing: string,
  ) {}
  protected notConfigured(): Error {
    return new Error(
      `${this.name} is not configured: set ${this.missing} (or run with DEMO_MODE=true)`,
    );
  }
  async health() {
    return {
      configured: false,
      reachable: false,
      detail: `missing env var(s): ${this.missing}`,
    };
  }
}

class UnconfiguredPM
  extends UnconfiguredProvider
  implements ProjectManagementProvider
{
  readonly kind = "unconfigured-pm";
  constructor() {
    super("Jira", "JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN");
  }
  getIssue() {
    return Promise.reject(this.notConfigured());
  }
  addComment() {
    return Promise.reject(this.notConfigured());
  }
  transitionIssue() {
    return Promise.reject(this.notConfigured());
  }
  searchIssues() {
    return Promise.reject(this.notConfigured());
  }
}

class UnconfiguredVC
  extends UnconfiguredProvider
  implements VersionControlProvider
{
  readonly kind = "unconfigured-vc";
  constructor() {
    super("GitHub", "GITHUB_TOKEN");
  }
  createBranch() {
    return Promise.reject(this.notConfigured());
  }
  getBranch() {
    return Promise.reject(this.notConfigured());
  }
  listBranches() {
    return Promise.reject(this.notConfigured());
  }
  openPullRequest() {
    return Promise.reject(this.notConfigured());
  }
  getPullRequest() {
    return Promise.reject(this.notConfigured());
  }
  listPullRequests() {
    return Promise.reject(this.notConfigured());
  }
  getChecks() {
    return Promise.reject(this.notConfigured());
  }
}

class UnconfiguredDocs
  extends UnconfiguredProvider
  implements DocsProvider
{
  readonly kind = "unconfigured-docs";
  constructor() {
    super("Notion", "NOTION_API_KEY, NOTION_PARENT_PAGE_ID");
  }
  createPage() {
    return Promise.reject(this.notConfigured());
  }
  getPage() {
    return Promise.reject(this.notConfigured());
  }
  searchPages() {
    return Promise.reject(this.notConfigured());
  }
  setStatus() {
    return Promise.reject(this.notConfigured());
  }
}

export function createContext(config: TandemConfig): TandemContext {
  const obs = createObservability({
    posthogApiKey: config.posthogApiKey,
    posthogHost: config.posthogHost,
    sentryDsn: config.sentryDsn,
  });

  if (config.demoMode) {
    return { config, pm: new DemoJira(), vc: new DemoGitHub(), docs: new DemoNotion(), obs };
  }

  const pm: ProjectManagementProvider =
    config.jiraBaseUrl && config.jiraEmail && config.jiraApiToken
      ? new JiraProvider(config.jiraBaseUrl, config.jiraEmail, config.jiraApiToken)
      : new UnconfiguredPM();

  const vc: VersionControlProvider = config.githubToken
    ? new GitHubProvider(config.githubToken)
    : new UnconfiguredVC();

  const docs: DocsProvider =
    config.notionApiKey && config.notionParentPageId
      ? new NotionProvider(config.notionApiKey, config.notionStatusProperty)
      : new UnconfiguredDocs();

  return { config, pm, vc, docs, obs };
}
