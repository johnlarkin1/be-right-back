/**
 * Generates the "How It's Built" article registry from article frontmatter.
 *
 * Frontmatter is the only source of article metadata. This script reads it and
 * writes src/lib/articles.generated.ts, which src/lib/articles.ts re-exports as
 * `ARTICLES` for the nav, header dropdown, index page, routing, and sitemap.
 * Client components import that module, so the metadata has to be resolved at
 * build time rather than read from disk at runtime.
 *
 *   content/how-its-built/technical/*.md  articles with technical + simple modes
 *   content/how-its-built/shared/*.md     single-mode articles
 *   content/how-its-built/simple/*.md     simple-mode bodies; frontmatter is only
 *                                         `slug`, which must match a technical article
 *
 * Files are read through `readArticleFiles()` in src/lib/content, the same walk
 * the pages and search index use. It is uncached and keeps files with malformed
 * frontmatter in its result, so every file gets validated on every run.
 *
 * The generated file is committed, so tsc, eslint, editors, and `next dev` work
 * from any checkout without running this first. Two entry points keep it honest:
 *
 *   npm run generate:articles   rewrite the file (also runs as `predev`)
 *   npm run check:articles      fail if the committed file is stale (runs as `prebuild`)
 *
 * Invalid frontmatter fails both modes with a non-zero exit and every problem listed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readArticleFiles, type ArticleFrontmatter, type ArticleVariant } from "../src/lib/content";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const ROUTE_DIR = path.join(ROOT, "src", "app", "how-its-built");
const OUTPUT = path.join(ROOT, "src", "lib", "articles.generated.ts");

// The fields of `ArticleFrontmatter`. tsc checks the generated file against
// `ArticleMeta` in src/lib/articles.ts.
const STRING_FIELDS: readonly (keyof ArticleFrontmatter)[] = ["slug", "title", "shortTitle", "description"];
const ALLOWED_FIELDS = new Set<string>([...STRING_FIELDS, "order"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SourceFile {
  variant: ArticleVariant;
  /** Repo-relative path from apps/website, for error messages. */
  rel: string;
  /** Frontmatter as written, typed loosely because this is what gets validated. */
  data: Record<string, unknown>;
}

const errors: string[] = [];

function fail(file: SourceFile, message: string) {
  errors.push(`${file.rel}: ${message}`);
}

function relPath(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join(path.posix.sep);
}

/** One variant's files, after reporting any whose frontmatter didn't parse. */
function filesIn(
  variant: ArticleVariant,
  { files, unparsed }: ReturnType<typeof readArticleFiles>,
): SourceFile[] {
  for (const file of unparsed) {
    if (file.variant === variant) {
      errors.push(`${relPath(file.path)}: could not parse frontmatter (${file.error.message})`);
    }
  }
  return files
    .filter((file) => file.variant === variant)
    .map((file) => ({
      variant,
      rel: relPath(file.path),
      data: file.frontmatter as Record<string, unknown>,
    }));
}

function parseArticle(file: SourceFile): ArticleFrontmatter | null {
  const { data } = file;
  let ok = true;

  const unknown = Object.keys(data).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length > 0) {
    fail(
      file,
      `unknown field(s) ${unknown.map((k) => `\`${k}\``).join(", ")}; ` +
        `allowed: ${[...ALLOWED_FIELDS].map((k) => `\`${k}\``).join(", ")}`,
    );
    ok = false;
  }

  for (const key of STRING_FIELDS) {
    const value = data[key];
    if (value === undefined) {
      fail(file, `missing required field \`${key}\``);
      ok = false;
    } else if (typeof value !== "string" || value.trim() === "") {
      fail(file, `\`${key}\` must be a non-empty string (got ${JSON.stringify(value)})`);
      ok = false;
    }
  }

  if (data.order === undefined) {
    fail(file, "missing required field `order`");
    ok = false;
  } else if (typeof data.order !== "number" || !Number.isInteger(data.order) || data.order < 0) {
    fail(file, `\`order\` must be a non-negative integer (got ${JSON.stringify(data.order)})`);
    ok = false;
  }

  if (typeof data.slug === "string" && data.slug.trim() !== "") {
    if (!SLUG_PATTERN.test(data.slug)) {
      fail(file, `slug \`${data.slug}\` must be lowercase kebab-case`);
      ok = false;
    } else if (fs.existsSync(path.join(ROUTE_DIR, data.slug))) {
      // A static sibling route (e.g. /how-its-built/resources) wins over [slug],
      // so an article with that slug would be unreachable.
      fail(file, `slug \`${data.slug}\` collides with the static route src/app/how-its-built/${data.slug}/`);
      ok = false;
    }
  }

  if (!ok) return null;
  return {
    slug: data.slug as string,
    title: data.title as string,
    shortTitle: data.shortTitle as string,
    description: data.description as string,
    order: data.order as number,
  };
}

function collectArticles(): ArticleFrontmatter[] {
  const read = readArticleFiles(ROOT);
  const articles: { article: ArticleFrontmatter; file: SourceFile }[] = [];
  const bySlug = new Map<string, SourceFile>();
  const byOrder = new Map<number, SourceFile>();
  // Every canonical slug, valid or not, so a broken technical file doesn't also
  // report its simple counterpart as orphaned.
  const anySlug = new Map<string, SourceFile>();

  for (const variant of ["technical", "shared"] as const) {
    for (const file of filesIn(variant, read)) {
      if (typeof file.data.slug === "string" && !anySlug.has(file.data.slug)) {
        anySlug.set(file.data.slug, file);
      }
      const article = parseArticle(file);
      if (!article) continue;

      const slugOwner = bySlug.get(article.slug);
      if (slugOwner) {
        fail(file, `duplicate slug \`${article.slug}\` (also used by ${slugOwner.rel})`);
        continue;
      }
      const orderOwner = byOrder.get(article.order);
      if (orderOwner) {
        fail(file, `duplicate order ${article.order} (also used by ${orderOwner.rel})`);
        continue;
      }
      bySlug.set(article.slug, file);
      byOrder.set(article.order, file);
      articles.push({ article, file });
    }
  }

  if (articles.length === 0 && errors.length === 0) {
    errors.push("no articles found under content/how-its-built/{technical,shared}");
  }

  validateSimpleFiles(filesIn("simple", read), anySlug);
  return articles.map(({ article }) => article).sort((a, b) => a.order - b.order);
}

/**
 * Simple-mode files only supply an alternate body. Their metadata comes from the
 * technical file with the same slug, so any other frontmatter would be a second
 * copy that silently drifts.
 */
function validateSimpleFiles(simpleFiles: SourceFile[], canonicalBySlug: Map<string, SourceFile>) {
  const seen = new Map<string, SourceFile>();

  for (const file of simpleFiles) {
    const { slug, ...rest } = file.data;
    const extra = Object.keys(rest);
    if (extra.length > 0) {
      fail(
        file,
        `simple-mode frontmatter may only contain \`slug\` (found ${extra.map((k) => `\`${k}\``).join(", ")}); ` +
          "title, shortTitle, order, and description come from the technical article, so delete them here",
      );
    }

    if (typeof slug !== "string" || slug.trim() === "") {
      fail(file, "missing required field `slug`");
      continue;
    }

    const dupe = seen.get(slug);
    if (dupe) {
      fail(file, `duplicate simple-mode slug \`${slug}\` (also used by ${dupe.rel})`);
      continue;
    }
    seen.set(slug, file);

    const canonical = canonicalBySlug.get(slug);
    if (!canonical) {
      fail(file, `slug \`${slug}\` has no matching article in content/how-its-built/technical/`);
    } else if (canonical.variant !== "technical") {
      fail(file, `slug \`${slug}\` belongs to ${canonical.rel}; shared articles have no simple mode`);
    }
  }
}

function render(articles: ArticleFrontmatter[]): string {
  const entries = articles
    .map((a) =>
      [
        "  {",
        `    slug: ${JSON.stringify(a.slug)},`,
        `    title: ${JSON.stringify(a.title)},`,
        `    shortTitle: ${JSON.stringify(a.shortTitle)},`,
        `    description: ${JSON.stringify(a.description)},`,
        `    order: ${a.order},`,
        "  },",
      ].join("\n"),
    )
    .join("\n");

  return `// GENERATED FILE - DO NOT EDIT.
// Built by scripts/generate-articles.mts from the frontmatter in
// content/how-its-built/{technical,shared}/*.md. Edit the frontmatter, then run
// \`npm run generate:articles\` and commit the result.

import type { ArticleMeta } from "./articles";

export const GENERATED_ARTICLES: ArticleMeta[] = [
${entries}
];
`;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const outputRel = path.relative(ROOT, OUTPUT);

  const articles = collectArticles();
  if (errors.length > 0) {
    console.error("[articles] article frontmatter is invalid:");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`[articles] fix the frontmatter above; ${outputRel} was not updated.`);
    process.exit(1);
  }

  const next = render(articles);
  const current = fs.existsSync(OUTPUT)
    ? fs.readFileSync(OUTPUT, "utf-8").replace(/\r\n/g, "\n")
    : null;

  if (current === next) {
    console.log(`[articles] ${outputRel} is up to date (${articles.length} articles)`);
    return;
  }

  if (checkOnly) {
    console.error(
      `[articles] ${outputRel} is ${current === null ? "missing" : "out of date with the article frontmatter"}.\n` +
        "[articles] run `npm run generate:articles` in apps/website and commit the result.",
    );
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT, next);
  console.log(`[articles] wrote ${outputRel} (${articles.length} articles)`);
}

main();
