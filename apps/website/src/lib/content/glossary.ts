import fs from "fs";
import path from "path";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { cachedByRoot } from "./cache";
import { splitHeadingSections, type HeadingSection } from "./sections";

export interface GlossaryTerm {
  term: string;
  definitionHtml: string;
}

/**
 * content/glossary.md split into one section per `## term`. A section's
 * `heading` is the term and its `id` is the term's anchor on
 * /how-its-built/resources. Empty if the file is missing.
 */
export const getGlossarySections = cachedByRoot((root): HeadingSection[] => {
  const file = path.join(root, "content", "glossary.md");
  if (!fs.existsSync(file)) return [];
  return splitHeadingSections(fs.readFileSync(file, "utf-8"), 2).sections;
});

/**
 * The glossary as a map keyed by lowercased term name, for the `:term[...]`
 * tooltips. Each term's body is rendered to HTML as its definition.
 */
export const loadGlossary = cachedByRoot((root): Record<string, GlossaryTerm> => {
  const result: Record<string, GlossaryTerm> = {};

  for (const { heading: term, body: rawBody } of getGlossarySections(root)) {
    const body = rawBody.trim();
    if (!term || !body) continue;

    const definitionHtml = String(
      remark()
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .processSync(body)
    );

    result[term.toLowerCase()] = { term, definitionHtml };
  }

  return result;
});
