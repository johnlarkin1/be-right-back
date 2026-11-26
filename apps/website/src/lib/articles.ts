/**
 * Article configuration and metadata for "How It's Built" section
 */

import { GENERATED_ARTICLES } from "./articles.generated";

export interface ArticleMeta {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  order: number;
}

/**
 * Article metadata for navigation, routing, and the header dropdown, sorted by
 * `order`. Generated from the frontmatter in content/how-its-built/{technical,shared}/
 * by scripts/generate-articles.mts; edit the frontmatter, not this list.
 */
export const ARTICLES: ArticleMeta[] = GENERATED_ARTICLES;

/**
 * Standalone, non-sequential reference page. Lives in the top nav group next to
 * Overview (unnumbered) rather than in the numbered ARTICLES sequence, and has
 * its own dedicated route at /how-its-built/resources.
 */
export const RESOURCES_NAV = {
  slug: "resources",
  title: "Resources & References",
  shortTitle: "Resources",
  description:
    "The running bibliography — videos, papers, articles, and a full glossary of terms used across the series.",
} as const;

/**
 * Get article by slug
 */
export function getArticleMeta(slug: string): ArticleMeta | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

/**
 * Get adjacent articles for navigation
 */
export function getAdjacentArticlesMeta(slug: string): {
  prev: ArticleMeta | null;
  next: ArticleMeta | null;
} {
  const index = ARTICLES.findIndex((a) => a.slug === slug);
  return {
    prev: index > 0 ? ARTICLES[index - 1] : null,
    next: index < ARTICLES.length - 1 ? ARTICLES[index + 1] : null,
  };
}

/** Chapters that set up the series. The header menu lists them first. */
const INTRO_SLUGS = new Set(["preface", "problem-vision"]);

/** Pinned to the top row of the header menu, next to Overview. */
const PINNED_SLUG = "system-design";

export interface HeaderDropdownItem {
  href: string;
  label: string;
  description: string;
  group: "top" | "intro" | "deep";
}

/** Items for the header's How It's Built menu, in display order. */
export function getHeaderDropdownItems(): HeaderDropdownItem[] {
  const pinned = ARTICLES.find((a) => a.slug === PINNED_SLUG);
  return [
    {
      href: "/how-its-built",
      label: "Overview",
      description: "Introduction to the technical deep dive series",
      group: "top",
    },
    ...(pinned
      ? [
          {
            href: `/how-its-built/${pinned.slug}`,
            label: pinned.shortTitle,
            description: pinned.description,
            group: "top" as const,
          },
        ]
      : []),
    {
      href: `/how-its-built/${RESOURCES_NAV.slug}`,
      label: RESOURCES_NAV.shortTitle,
      description: RESOURCES_NAV.description,
      group: "top",
    },
    ...ARTICLES.filter((a) => a.slug !== PINNED_SLUG).map((article) => ({
      href: `/how-its-built/${article.slug}`,
      label: article.shortTitle,
      description: article.description,
      group: INTRO_SLUGS.has(article.slug)
        ? ("intro" as const)
        : ("deep" as const),
    })),
  ];
}
