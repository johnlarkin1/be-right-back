import { visit } from "unist-util-visit";
import type { Root } from "mdast";

/**
 * Remark plugin that turns ::system3d{title="..." height="540"} into a
 * placeholder <div>. ArticleContent mounts <System3D /> into it.
 *
 * Requires remark-directive to run first in the pipeline.
 */
export function remarkSystem3d() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type !== "leafDirective" && node.type !== "containerDirective") return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const directive = node as any;
      if (directive.name !== "system3d") return;

      const attrs = ["data-system3d"];
      const title = directive.attributes?.title;
      if (title) attrs.push(`data-system3d-title="${escapeAttr(title)}"`);
      const height = directive.attributes?.height;
      if (height && /^\d+$/.test(height)) attrs.push(`data-system3d-height="${height}"`);

      directive.type = "html";
      directive.value = `<div ${attrs.join(" ")}></div>`;
      delete directive.children;
      delete directive.attributes;
    });
  };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
