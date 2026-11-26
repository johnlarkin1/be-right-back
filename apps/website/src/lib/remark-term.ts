import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import type { GlossaryTerm } from "./content";

interface RemarkTermOptions {
  glossary: Record<string, GlossaryTerm>;
}

/**
 * Remark plugin that transforms :term[plist]{key=plist} inline directives
 * into <span data-term="..." data-term-name="..." data-term-html="...">...</span>
 * placeholders for client-side hydration by TermTooltip.
 *
 * Requires remark-directive to run first in the pipeline.
 */
export function remarkTerm(options: RemarkTermOptions) {
  const glossary = options?.glossary ?? {};

  return (tree: Root) => {
    // Track which glossary keys we've already rendered in this document so the
    // first mention of a term can be styled prominently and later mentions
    // faintly. visit() walks the tree in document order, so the first key we
    // see is the first occurrence the reader encounters.
    const seen = new Set<string>();

    visit(tree, (node) => {
      if (node.type !== "textDirective") return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const directive = node as any;
      if (directive.name !== "term") return;

      const label =
        directive.children
          ?.map((child: { value?: string }) => child.value)
          .filter(Boolean)
          .join("") || "";

      if (!label) return;

      const key = (directive.attributes?.key || label).toLowerCase();
      const entry = glossary[key];

      if (!entry) {
        directive.type = "text";
        directive.value = label;
        delete directive.children;
        delete directive.attributes;
        return;
      }

      const isRepeat = seen.has(key);
      seen.add(key);

      directive.type = "html";
      directive.value = `<span data-term="${escapeAttr(key)}" data-term-name="${escapeAttr(entry.term)}" data-term-html="${escapeAttr(entry.definitionHtml)}"${isRepeat ? ' data-term-repeat="true"' : ""}>${escapeHtml(label)}</span>`;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
