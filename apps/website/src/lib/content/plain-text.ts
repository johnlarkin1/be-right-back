/**
 * Markdown → plain text helpers shared by the page renderers and the search
 * indexer. They are regex-based, which is enough for the markdown in content/.
 */

/**
 * Heading source → plain text: trims, and unwraps `code` spans and
 * [links](…). Emphasis markers stay in (GithubSlugger drops `*` and `~` on its
 * own). This is the TOC label and the slug input, and for the headings in
 * content/ it slugs to the same id rehype-slug renders.
 */
export function headingText(s: string): string {
  return s
    .trim()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/** A single-backtick code span, or a run of one emphasis or strikethrough marker. */
const CODE_OR_MARKER_RUN = /`[^`\n]+`|\*+|_+|~+/g;

const isWhitespace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isPunctuation = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c);

/**
 * Whether a run of `*`, `_` or `~` can open or close emphasis or
 * strikethrough, going by CommonMark's flanking rules for the characters on
 * either side (`undefined` at the ends of the string).
 */
function isDelimiterRun(run: string, before: string | undefined, after: string | undefined): boolean {
  // GFM strikethrough takes one or two tildes.
  if (run[0] === "~" && run.length > 2) return false;
  const leftFlanking =
    !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
  const rightFlanking =
    !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
  if (run[0] !== "_") return leftFlanking || rightFlanking;
  // `_` can't open or close emphasis inside a word, so snake_case keeps its underscores.
  const canOpen = leftFlanking && (!rightFlanking || isPunctuation(before));
  const canClose = rightFlanking && (!leftFlanking || isPunctuation(after));
  return canOpen || canClose;
}

/**
 * Replace the `*`, `_` and `~` runs that act as emphasis or strikethrough
 * delimiters with `replacement`. Code spans are left as written, backticks
 * included. So are runs that can't be delimiters: an underscore inside a word
 * (snake_case), or a `*` with spaces on both sides. Delimiters aren't paired
 * up, so an unmatched `*foo` still loses its `*`.
 */
function stripEmphasis(s: string, replacement: string): string {
  return s.replace(CODE_OR_MARKER_RUN, (run: string, offset: number) => {
    if (run[0] === "`") return run;
    return isDelimiterRun(run, s[offset - 1], s[offset + run.length]) ? replacement : run;
  });
}

/**
 * `headingText` with emphasis and strikethrough markers removed too, for
 * display text that should carry no markdown at all. Code span contents are
 * kept as written (`search_messages` stays `search_messages`).
 */
export function stripInline(s: string): string {
  return headingText(stripEmphasis(s, "")).trim();
}

/** Convert a markdown body to readable plain text for embedding/snippets. */
export function toPlainText(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/^\s*:::.*$/gm, " ") // container directive fences (:::alert)
    .replace(/::[a-zA-Z]+\[([^\]]*)\][^\n]*/g, "$1") // leaf directives ::term[x]{...}
    .replace(/<!--[\s\S]*?-->/g, " ") // html comments
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading markers
    .replace(/^\s{0,3}>\s?/gm, "") // blockquote markers
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*\d+\.\s+/gm, ""); // ordered list markers
  return stripEmphasis(text, " ") // emphasis and strikethrough markers, outside code spans
    .replace(/[`|]/g, " ") // code span backticks, table pipes
    .replace(/\s+/g, " ")
    .trim();
}
