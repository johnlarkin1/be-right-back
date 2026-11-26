import { visit } from "unist-util-visit";
import type { Root } from "mdast";

/**
 * Remark plugin that transforms ::excalidraw[/path/to/file.excalidraw]{title="..."}
 * directives into placeholder <div> elements for client-side hydration.
 *
 * Optional attributes:
 *   fit     zoom the diagram to fit the frame on load (`{fit}` or `{fit="true"}`)
 *   height  frame height in px (`{height="640"}`)
 *
 * Requires remark-directive to run first in the pipeline.
 */
export function remarkExcalidraw() {
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
      if (directive.name !== "excalidraw") return;

      // Extract the path from the directive's children (the [bracketed] content)
      const src =
        directive.children
          ?.map((child: { value?: string }) => child.value)
          .filter(Boolean)
          .join("") || "";

      if (!src) return;

      // Extract optional title from attributes {title="..."}
      const title = directive.attributes?.title || "";

      // Build data attributes
      const attrs = [`data-excalidraw-diagram="${escapeAttr(src)}"`];
      if (title) {
        attrs.push(`data-excalidraw-title="${escapeAttr(title)}"`);
      }
      const fit = directive.attributes?.fit;
      if (fit !== undefined && fit !== "false") {
        attrs.push(`data-excalidraw-fit="true"`);
      }
      const height = directive.attributes?.height;
      if (height && /^\d+$/.test(height)) {
        attrs.push(`data-excalidraw-height="${height}"`);
      }

      // Replace with raw HTML placeholder
      directive.type = "html";
      directive.value = `<div ${attrs.join(" ")}></div>`;
      delete directive.children;
      delete directive.attributes;
    });
  };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
