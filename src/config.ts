/**
 * Configuration for Tandem.
 *
 * All secrets come from the environment — never from files or defaults.
 * When DEMO_MODE is on (or no provider tokens are configured at all),
 * Tandem runs against in-memory fixtures so it can be exercised and
 * demoed without any real accounts.
 */

export interface TandemConfig {
  /** Force the in-memory demo providers. */
  demoMode: boolean;
  githubToken?: string;
  /** "owner/repo", e.g. "lalolalo1999/tandem-demo". */
  githubRepo: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  /** Jira project key, e.g. "TAN". */
  jiraProject: string;
  notionApiKey?: string;
  /** Notion page under which Tandem creates work docs. */
  notionParentPageId?: string;
  /** Name of the Notion status property on work docs. */
  notionStatusProperty: string;
  /** PostHog product analytics. Optional — off unless set. */
  posthogApiKey?: string;
  posthogHost: string;
  /** Sentry error tracking. Optional — off unless set. */
  sentryDsn?: string;
  port: number;
  host: string;
}

export type EnvLike = Record<string, string | undefined>;

export function loadConfig(env: EnvLike = process.env): TandemConfig {
  const demoFlag = env.DEMO_MODE;
  const hasAnyToken =
    Boolean(env.GITHUB_TOKEN) ||
    Boolean(env.JIRA_API_TOKEN) ||
    Boolean(env.NOTION_API_KEY);
  return {
    demoMode:
      demoFlag === "true" ||
      demoFlag === "1" ||
      (demoFlag === undefined && !hasAnyToken),
    githubToken: env.GITHUB_TOKEN || undefined,
    githubRepo: env.GITHUB_REPO || "lalolalo1999/tandem-demo",
    jiraBaseUrl: env.JIRA_BASE_URL || undefined,
    jiraEmail: env.JIRA_EMAIL || undefined,
    jiraApiToken: env.JIRA_API_TOKEN || undefined,
    jiraProject: env.JIRA_PROJECT || "TAN",
    notionApiKey: env.NOTION_API_KEY || undefined,
    notionParentPageId: env.NOTION_PARENT_PAGE_ID || undefined,
    notionStatusProperty: env.NOTION_STATUS_PROPERTY || "Status",
    posthogApiKey: env.POSTHOG_API_KEY || undefined,
    posthogHost: env.POSTHOG_HOST || "https://us.i.posthog.com",
    sentryDsn: env.SENTRY_DSN || undefined,
    port: Number(env.PORT || 3000),
    host: env.HOST || "127.0.0.1",
  };
}
