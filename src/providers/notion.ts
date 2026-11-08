/**
 * Real Notion provider (Notion API 2022-06-28).
 * Auth: NOTION_API_KEY (internal integration token).
 * Work docs are pages under NOTION_PARENT_PAGE_ID, with a status
 * property named NOTION_STATUS_PROPERTY (default "Status").
 */

import type {
  DocPage,
  DocsProvider,
  HealthResult,
} from "./types.js";

const API = "https://api.notion.com/v1";

interface NotionRichText {
  plain_text: string;
}
interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  status?: { name: string } | null;
  select?: { name: string } | null;
}
interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, NotionProperty>;
}
interface NotionBlocks {
  results: {
    type: string;
    [k: string]: unknown;
    paragraph?: { rich_text: NotionRichText[] };
    heading_1?: { rich_text: NotionRichText[] };
    heading_2?: { rich_text: NotionRichText[] };
    heading_3?: { rich_text: NotionRichText[] };
    bulleted_list_item?: { rich_text: NotionRichText[] };
    numbered_list_item?: { rich_text: NotionRichText[] };
    to_do?: { rich_text: NotionRichText[] };
  }[];
}
interface NotionSearch {
  results: NotionPage[];
}

function blockText(b: NotionBlocks["results"][number]): string {
  const rich =
    b.paragraph?.rich_text ??
    b.heading_1?.rich_text ??
    b.heading_2?.rich_text ??
    b.heading_3?.rich_text ??
    b.bulleted_list_item?.rich_text ??
    b.numbered_list_item?.rich_text ??
    b.to_do?.rich_text ??
    [];
  return rich.map((t) => t.plain_text).join("");
}

export class NotionProvider implements DocsProvider {
  readonly kind = "notion";
  private headers: Record<string, string>;

  constructor(
    private apiKey: string,
    private statusProperty = "Status",
  ) {
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    };
  }

  private async notion<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Notion API ${res.status} on ${path}: ${body.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }

  private pageTitle(page: NotionPage): string {
    for (const prop of Object.values(page.properties)) {
      if (prop.type === "title" && prop.title) {
        return prop.title.map((t) => t.plain_text).join("") || "(untitled)";
      }
    }
    return "(untitled)";
  }

  private pageStatus(page: NotionPage): string | null {
    const prop = page.properties[this.statusProperty];
    if (!prop) return null;
    if (prop.type === "status") return prop.status?.name ?? null;
    if (prop.type === "select") return prop.select?.name ?? null;
    return null;
  }

  private async pageContent(id: string): Promise<string> {
    const blocks = await this.notion<NotionBlocks>(
      `/blocks/${encodeURIComponent(id)}/children?page_size=50`,
    );
    return blocks.results
      .map(blockText)
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
  }

  async createPage(
    parentId: string,
    title: string,
    sections: { heading: string; body: string }[],
  ): Promise<DocPage> {
    const children = sections.flatMap((s) => [
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: s.heading } }] },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: s.body } }] },
      },
    ]);
    const page = await this.notion<NotionPage>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { page_id: parentId },
        properties: {
          title: { title: [{ text: { content: title } }] },
        },
        children,
      }),
    });
    return {
      id: page.id,
      title: this.pageTitle(page),
      url: page.url,
      status: "Draft",
    };
  }

  async getPage(id: string): Promise<DocPage> {
    const page = await this.notion<NotionPage>(
      `/pages/${encodeURIComponent(id)}`,
    );
    return {
      id: page.id,
      title: this.pageTitle(page),
      url: page.url,
      status: this.pageStatus(page),
      content: await this.pageContent(id),
    };
  }

  async searchPages(query: string): Promise<DocPage[]> {
    const res = await this.notion<NotionSearch>("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        filter: { value: "page", property: "object" },
        page_size: 10,
      }),
    });
    return res.results.map((p) => ({
      id: p.id,
      title: this.pageTitle(p),
      url: p.url,
      status: this.pageStatus(p),
    }));
  }

  async setStatus(id: string, status: string): Promise<DocPage> {
    // Try a "status" property first, fall back to "select".
    for (const kind of ["status", "select"] as const) {
      try {
        await this.notion(`/pages/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            properties: { [this.statusProperty]: { [kind]: { name: status } } },
          }),
        });
        return this.getPage(id);
      } catch (err) {
        if (kind === "select") throw err;
      }
    }
    throw new Error("unreachable");
  }

  async health(): Promise<HealthResult> {
    try {
      await this.notion("/users/me");
      return {
        configured: true,
        reachable: true,
        detail: "Notion API reachable",
      };
    } catch (err) {
      return {
        configured: true,
        reachable: false,
        detail: `Notion API error: ${(err as Error).message.slice(0, 200)}`,
      };
    }
  }
}
