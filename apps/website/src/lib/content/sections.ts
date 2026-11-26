import GithubSlugger from "github-slugger";
import { headingText } from "./plain-text";

/** A line starting with ``` (indent allowed) opens or closes a fenced code block. */
const FENCE = /^\s*```/;
/** A line starting with `<!--` (indent allowed) opens an HTML comment block. */
const COMMENT_OPEN = /^\s*<!--/;
/** The first line containing `-->` closes an HTML comment block. */
const COMMENT_CLOSE = "-->";
/** An ATX heading: 1-6 `#`, whitespace, then the heading text. */
const HEADING = /^(#{1,6})\s+(.+)$/;

interface Line {
  line: string;
  /** Set when the line is a heading outside fenced code blocks and HTML comments. */
  heading?: { level: number; source: string };
}

/**
 * Split markdown into lines, marking the headings. `#` lines inside code fences
 * or HTML comments are not headings: markdown renders neither as a heading, so
 * rehype-slug never gives them an id.
 *
 * A comment runs from a line starting with `<!--` to the first line containing
 * `-->`, which can be the same line. Blank lines don't end it. Inside a
 * comment, ``` doesn't open a fence, and inside a fence, `<!--` doesn't open a
 * comment.
 */
function scanLines(md: string): Line[] {
  let block: "fence" | "comment" | null = null;
  return md.split("\n").map((line): Line => {
    if (block === "fence") {
      if (FENCE.test(line)) block = null;
      return { line };
    }
    if (block === "comment") {
      if (line.includes(COMMENT_CLOSE)) block = null;
      return { line };
    }
    if (FENCE.test(line)) {
      block = "fence";
      return { line };
    }
    const open = line.match(COMMENT_OPEN);
    if (open) {
      // Search from the opener's first `-`: like micromark, `<!-->` and `<!--->` are complete comments.
      if (!line.includes(COMMENT_CLOSE, open[0].length - 2)) block = "comment";
      return { line };
    }
    const m = line.match(HEADING);
    return m ? { line, heading: { level: m[1].length, source: m[2].trim() } } : { line };
  });
}

export interface HeadingSection {
  /** Heading source as written, e.g. "Why `Be Right Back`?". */
  heading: string;
  /** The heading as plain text (see `headingText`). */
  text: string;
  /** Anchor id: the one rehype-slug gives this heading when the whole document is rendered. */
  id: string;
  level: number;
  /** Markdown between this heading and the next section heading (untrimmed). */
  body: string;
}

export interface SplitMarkdown {
  /** Markdown before the first section heading (untrimmed). */
  intro: string;
  sections: HeadingSection[];
}

/**
 * Split markdown into sections at its headings. `#` lines inside fenced code
 * blocks or HTML comments are not headings.
 *
 * With `level`, only headings of exactly that level start a section; the rest
 * stay in the body. Every heading still goes through one GithubSlugger in
 * document order, so ids get the same `-1`, `-2` dedupe suffixes rehype-slug
 * gives the rendered page.
 */
export function splitHeadingSections(md: string, level?: number): SplitMarkdown {
  const slugger = new GithubSlugger();
  const intro: string[] = [];
  const sections: (Omit<HeadingSection, "body"> & { lines: string[] })[] = [];

  for (const { line, heading } of scanLines(md)) {
    if (heading) {
      const text = headingText(heading.source);
      const id = slugger.slug(text);
      if (level === undefined || heading.level === level) {
        sections.push({ heading: heading.source, text, id, level: heading.level, lines: [] });
        continue;
      }
    }
    (sections.at(-1)?.lines ?? intro).push(line);
  }

  return {
    intro: intro.join("\n"),
    sections: sections.map(({ lines, ...section }) => ({ ...section, body: lines.join("\n") })),
  };
}
