import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import { remarkExcalidraw } from "./remark-excalidraw";
import { remarkDbdiagram } from "./remark-dbdiagram";
import { remarkTerm } from "./remark-term";
import { remarkAlert } from "./remark-alert";
import { remarkDisplayMath } from "./remark-display-math";
import { remarkUnfurl } from "./remark-unfurl";
import { remarkPlayground } from "./remark-playground";
import { remarkSystem3d } from "./remark-system3d";
import { getArticleIndex, loadGlossary, splitHeadingSections, type ArticleFrontmatter } from "./content";
import rehypeStringify from "rehype-stringify";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

export type { ArticleFrontmatter };

export interface ArticleContent {
  frontmatter: ArticleFrontmatter;
  content: string;
  htmlContent: string;
  headings: TableOfContentsItem[];
}

export interface TableOfContentsItem {
  id: string;
  text: string;
  level: number;
}

/**
 * Check if an article slug lives in the shared directory (no simple/technical split)
 */
export function isSharedArticle(slug: string): boolean {
  return getArticleIndex().bySlug.get(slug)?.shared !== undefined;
}

/**
 * Get article content by slug and mode (technical or simple). The mode's own
 * file wins; shared articles serve both modes.
 */
export async function getArticleBySlug(
  slug: string,
  mode: "technical" | "simple" = "technical"
): Promise<ArticleContent | null> {
  const files = getArticleIndex().bySlug.get(slug);
  const file = files?.[mode] ?? files?.shared;
  if (!file) return null;

  return {
    frontmatter: file.frontmatter as ArticleFrontmatter,
    content: file.body,
    htmlContent: await processMarkdown(file.body),
    headings: extractHeadings(file.body),
  };
}

/**
 * Render an arbitrary markdown string to HTML using the same pipeline as
 * articles (term tooltips, math, alerts, syntax highlighting, slugged headings).
 * Used by standalone pages like /how-its-built/resources that aren't backed by
 * a slug in the ARTICLES registry.
 */
export async function renderMarkdownToHtml(content: string): Promise<string> {
  return processMarkdown(content);
}

/**
 * Process markdown to HTML
 */
async function processMarkdown(content: string): Promise<string> {
  const result = await remark()
    .use(remarkDirective)
    .use(remarkExcalidraw)
    .use(remarkDbdiagram)
    .use(remarkUnfurl)
    .use(remarkPlayground)
    .use(remarkSystem3d)
    .use(remarkTerm, { glossary: loadGlossary() })
    .use(remarkAlert)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDisplayMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "wrap",
      properties: {
        className: ["anchor-link"],
      },
    })
    .use(rehypeKatex, {
      strict: "ignore",
    })
    .use(rehypeHighlight, {
      detect: true,
      ignoreMissing: true,
    })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content);

  return result.toString();
}

/**
 * Extract h1-h4 headings from markdown content for the table of contents.
 * The section splitter assigns ids the way rehype-slug does, so each id
 * matches the one rendered into the article HTML.
 */
function extractHeadings(content: string): TableOfContentsItem[] {
  return splitHeadingSections(content)
    .sections.filter((section) => section.level <= 4)
    .map(({ id, text, level }) => ({ id, text, level }));
}
