import { visit } from "unist-util-visit";
import type { Root } from "mdast";

/**
 * Remark plugin that transforms ::dbdiagram[<embed-token-or-url>]{title="..."}
 * directives into placeholder <div> elements for client-side hydration.
 *
 * The bracketed value is either a full dbdiagram.io embed URL or just the
 * embed token; DbDiagramViewer resolves either form.
 *
 * Requires remark-directive to run first in the pipeline.
 */
export function remarkDbdiagram() {
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
      if (directive.name !== "dbdiagram") return;

      // Extract the embed token/URL from the directive's [bracketed] content.
      // remark-gfm's autolink-literal extension runs at parse time and turns a
      // bare URL inside the label into a `link` node (whose href is `.url`)
      // rather than a plain `text` node, so we must read both.
      const src = collectText(directive.children).trim();

      if (!src) return;

      // Extract optional title and height from attributes
      // {title="..." height="800"}
      const title = directive.attributes?.title || "";
      const height = directive.attributes?.height || "";

      const attrs = [`data-dbdiagram-src="${escapeAttr(src)}"`];
      if (title) {
        attrs.push(`data-dbdiagram-title="${escapeAttr(title)}"`);
      }
      if (height) {
        attrs.push(`data-dbdiagram-height="${escapeAttr(height)}"`);
      }

      // Replace with raw HTML placeholder
      directive.type = "html";
      directive.value = `<div ${attrs.join(" ")}></div>`;
      delete directive.children;
      delete directive.attributes;
    });
  };
}

/**
 * Recursively collect the textual content of a directive's label children.
 * Handles `text` nodes (`.value`) and `link` nodes — which remark-gfm
 * produces when the label is a bare URL — by reading the link's href.
 */
function collectText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[] | undefined
): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (typeof node?.value === "string") {
      out += node.value;
    } else if (node?.type === "link" && typeof node.url === "string") {
      out += node.url;
    } else if (Array.isArray(node?.children)) {
      out += collectText(node.children);
    }
  }
  return out;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
