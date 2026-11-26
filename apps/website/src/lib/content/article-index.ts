import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { cachedByRoot } from "./cache";

/**
 * Article metadata as technical and shared files declare it in frontmatter
 * (simple files declare only `slug`). `scripts/generate-articles.mts`
 * validates these fields and writes them to `src/lib/articles.generated.ts`.
 */
export interface ArticleFrontmatter {
  title: string;
  shortTitle: string;
  slug: string;
  order: number;
  description: string;
}

/**
 * The directory under content/how-its-built/ a file lives in. Split articles
 * have a technical and a simple file; shared articles have one file for both
 * modes.
 */
export type ArticleVariant = "technical" | "simple" | "shared";

export interface ArticleFile {
  variant: ArticleVariant;
  path: string;
  /** Frontmatter as written. Not validated, so any field can be missing. */
  frontmatter: Partial<ArticleFrontmatter>;
  /** Markdown after the frontmatter. */
  body: string;
}

/** An article file whose frontmatter could not be read or parsed. */
export interface UnparsedArticleFile {
  variant: ArticleVariant;
  path: string;
  error: Error;
}

export interface ArticleIndex {
  /** Every article file: technical, then simple, then shared, sorted by filename within each. */
  files: ArticleFile[];
  /** Frontmatter slug → the first file with that slug in each variant directory. */
  bySlug: Map<string, Partial<Record<ArticleVariant, ArticleFile>>>;
}

const VARIANTS: ArticleVariant[] = ["technical", "simple", "shared"];

/**
 * Read and parse every How It's Built article file, uncached. A file that
 * fails to parse goes in `unparsed` rather than stopping the walk, so
 * `scripts/generate-articles.mts` can report every problem in one run.
 * Everything else should use `getArticleIndex()`.
 */
export function readArticleFiles(root: string): {
  files: ArticleFile[];
  unparsed: UnparsedArticleFile[];
} {
  const files: ArticleFile[] = [];
  const unparsed: UnparsedArticleFile[] = [];

  for (const variant of VARIANTS) {
    const dir = path.join(root, "content", "how-its-built", variant);
    if (!fs.existsSync(dir)) continue;

    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const filePath = path.join(dir, name);
      try {
        const { data, content } = matter(fs.readFileSync(filePath, "utf-8"));
        files.push({ variant, path: filePath, frontmatter: data, body: content });
      } catch (err) {
        unparsed.push({ variant, path: filePath, error: err as Error });
      }
    }
  }

  return { files, unparsed };
}

/**
 * Read and parse every How It's Built article once (see `cachedByRoot`).
 * Throws the parse error of the first file whose frontmatter is malformed.
 */
export const getArticleIndex = cachedByRoot((root): ArticleIndex => {
  const { files, unparsed } = readArticleFiles(root);
  if (unparsed.length > 0) throw unparsed[0].error;

  const bySlug: ArticleIndex["bySlug"] = new Map();
  for (const file of files) {
    const { slug } = file.frontmatter;
    if (!slug) continue;
    const entry = bySlug.get(slug) ?? {};
    entry[file.variant] ??= file;
    bySlug.set(slug, entry);
  }

  return { files, bySlug };
});
