import { visit } from "unist-util-visit";
import type { Root } from "mdast";

/**
 * Remark plugin that transforms ::playground[<slug>]{label="..." preview="..."}
 * directives into a placeholder <div> that ArticleContent hydrates into a
 * <PlaygroundButton /> client component.
 *
 * The bracketed value is the demo slug — it must match an entry in lib/demos.ts.
 * The button navigates the user (SPA) to /playground/<slug>, where a Next.js wrapper
 * page renders the demo's HTML inside an iframe.
 *
 * Attributes:
 *   label    (required) — primary button text, e.g. "Try the inverted-index demo"
 *   preview  (optional) — secondary descriptive line
 *
 * Example:
 *   ::playground[inverted-index]{
 *     label="Try the inverted-index demo"
 *     preview="Click terms to highlight docs. Type queries to see AND/OR intersection."
 *   }
 *
 * Requires remark-directive to run first in the pipeline.
 */
export function remarkPlayground() {
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
      if (directive.name !== "playground") return;

      const slug = collectText(directive.children).trim();
      if (!slug) return;

      const attrs = directive.attributes ?? {};
      const label = (attrs.label || slug).trim();
      const preview = (attrs.preview || "").trim();

      directive.type = "html";
      directive.value = renderPlaceholder({ slug, label, preview });
      delete directive.children;
      delete directive.attributes;
    });
  };
}

interface PlaygroundData {
  slug: string;
  label: string;
  preview: string;
}

function renderPlaceholder({ slug, label, preview }: PlaygroundData): string {
  const attrs = [
    `data-playground-slug="${escapeAttr(slug)}"`,
    `data-playground-label="${escapeAttr(label)}"`,
  ];
  if (preview) {
    attrs.push(`data-playground-preview="${escapeAttr(preview)}"`);
  }
  return `<div ${attrs.join(" ")}></div>`;
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
