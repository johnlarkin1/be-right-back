/**
 * Loading and parsing for the markdown under content/: heading sections,
 * plain-text helpers, the How It's Built article index, and the glossary.
 * Shared by the pages and `scripts/build-search-index.mts`, so it must not
 * import anything Next-specific.
 */
export { splitHeadingSections, type HeadingSection, type SplitMarkdown } from "./sections";
export { headingText, stripInline, toPlainText } from "./plain-text";
export {
  getArticleIndex,
  readArticleFiles,
  type ArticleFile,
  type ArticleFrontmatter,
  type ArticleIndex,
  type ArticleVariant,
  type UnparsedArticleFile,
} from "./article-index";
export { getGlossarySections, loadGlossary, type GlossaryTerm } from "./glossary";
