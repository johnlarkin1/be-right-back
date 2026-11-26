import { visit } from "unist-util-visit";
import type { Root } from "mdast";

/**
 * Remark plugin that transforms ::unfurl[<url>]{title="..." site="..." preview="..." icon="..."}
 * directives into an iMessage-style link bubble.
 *
 * Attributes (all optional except url, which is the bracketed value):
 *   title    — bold title shown in the dark footer (defaults to URL)
 *   site     — site/hostname shown below the title (defaults to URL's hostname)
 *   preview  — large text shown inside the yellow bubble
 *   icon     — single character/emoji shown in the icon square (defaults to first letter of site)
 *
 * Example:
 *   ::unfurl[https://duckdb.org/2025/06/13/text-analytics]{
 *     title="Lightweight Text Analytics Workflows with DuckDB"
 *     site="duckdb.org"
 *     preview="Text analytics"
 *     icon="D"
 *   }
 *
 * Requires remark-directive to run first in the pipeline.
 */
export function remarkUnfurl() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (
        node.type !== "leafDirective" &&
        node.type !== "containerDirective" &&
        node.type !== "textDirective"
      ) {
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const directive = node as any;
      if (directive.name !== "unfurl") return;

      const url = collectText(directive.children).trim();
      if (!url) return;

      const attrs = directive.attributes ?? {};
      const title = (attrs.title || url).trim();
      const site = (attrs.site || hostnameOf(url)).trim();
      const icon = (attrs.icon || site.charAt(0).toUpperCase() || "•").trim();

      directive.type = "html";
      directive.value = renderUnfurl({ url, title, site, icon });
      delete directive.children;
      delete directive.attributes;
    });
  };
}

interface UnfurlData {
  url: string;
  title: string;
  site: string;
  icon: string;
}

function renderUnfurl({ url, title, site, icon }: UnfurlData): string {
  return [
    `<a class="unfurl-card" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">`,
    `<span class="unfurl-icon">${escapeHtml(icon)}</span>`,
    `<span class="unfurl-title">${escapeHtml(title)}</span>`,
    `<span class="unfurl-site">${escapeHtml(site)}</span>`,
    `</a>`,
  ].join("");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function collectText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[] | undefined,
): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (typeof node?.value === "string") {
      out += node.value;
    } else if (node?.type === "link" && typeof node?.url === "string") {
      out += node.url;
    } else if (Array.isArray(node?.children)) {
      out += collectText(node.children);
    }
  }
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
