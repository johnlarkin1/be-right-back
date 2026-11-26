import { visit } from "unist-util-visit";
import type { Root } from "mdast";

/**
 * Build a `math` (flow/display) mdast node, mirroring the structure
 * `mdast-util-math` produces for fenced block math so rehype-katex renders it
 * in display mode (centered via `.katex-display`).
 */
function displayMathNode(value: string) {
  return {
    type: "math",
    meta: null,
    value,
    data: {
      hName: "pre",
      hChildren: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-math", "math-display"] },
          children: [{ type: "text", value }],
        },
      ],
    },
  };
}

/**
 * Remark plugin that promotes math-only paragraphs to display (block) math.
 *
 * `micromark-extension-math` only treats `$$...$$` as block math when the
 * fence spans multiple lines. A single-line `$$ equation $$` is parsed as
 * inline math — rendered small and left-aligned. This plugin detects a
 * paragraph whose only content is one or more math expressions (separated by
 * line breaks) and replaces it with display `math` nodes, one per expression,
 * so each renders centered.
 */
export function remarkDisplayMath() {
  return (tree: Root) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, "paragraph", (node: any, index, parent: any) => {
      if (!parent || index === undefined) return;

      const significant = node.children.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (child: any) =>
          child.type !== "break" &&
          !(child.type === "text" && child.value.trim() === ""),
      );

      if (
        significant.length === 0 ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        significant.some((child: any) => child.type !== "inlineMath")
      ) {
        return;
      }

      parent.children.splice(
        index,
        1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...significant.map((child: any) => displayMathNode(child.value)),
      );
    });
  };
}
