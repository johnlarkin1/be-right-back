import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleBySlug, isSharedArticle } from "@/lib/markdown";
import { getArticleMeta, getAdjacentArticlesMeta, ARTICLES } from "@/lib/articles";
import { ArticlePageClient } from "./client";

// Generate static params for all article slugs. The standalone /resources page
// is intentionally not in ARTICLES, so it won't collide with this dynamic route.
export function generateStaticParams() {
  return ARTICLES.map((article) => ({
    slug: article.slug,
  }));
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const meta = getArticleMeta(slug);
  if (!meta) {
    return { title: "Article Not Found - Be Right Back" };
  }
  return {
    title: `${meta.title} - Be Right Back`,
    description: meta.description,
  };
}

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;

  // Get article metadata
  const articleMeta = getArticleMeta(slug);
  if (!articleMeta) {
    notFound();
  }

  // Get article content for both modes
  const shared = isSharedArticle(slug);
  const technicalContent = await getArticleBySlug(slug, "technical");
  const simpleContent = shared ? null : await getArticleBySlug(slug, "simple");

  // Get adjacent articles for navigation
  const { prev, next } = getAdjacentArticlesMeta(slug);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 font-jetbrains text-sm text-text-secondary">
        <Link
          href="/how-its-built"
          className="hover:text-crt-accent transition-colors"
        >
          ./how-its-built
        </Link>
        <span className="mx-2 text-text-muted">/</span>
        <span className="text-crt-accent">{slug}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="mb-2 font-jetbrains text-sm text-crt-accent">
          [{String(articleMeta.order).padStart(2, "0")}]
        </div>
        <h1 className="mb-4 font-inter text-3xl md:text-4xl text-text-primary font-semibold tracking-tight">
          {articleMeta.title}
        </h1>
        <p className="font-inter text-text-secondary leading-relaxed">
          {articleMeta.description}
        </p>
      </div>

      {/* Client-side article content with toggle */}
      <ArticlePageClient
        technicalContent={technicalContent}
        simpleContent={simpleContent}
        articleTitle={articleMeta.title}
        isShared={shared}
      />

      {/* Navigation */}
      <div className="mt-16 flex justify-between items-center border-t border-border-subtle pt-8">
        {prev ? (
          <Link
            href={`/how-its-built/${prev.slug}`}
            className="group flex items-center gap-2 font-inter text-sm text-text-secondary hover:text-crt-accent transition-colors"
          >
            <span className="text-lg">←</span>
            <div>
              <div className="text-xs text-text-muted">Previous</div>
              <div>{prev.shortTitle}</div>
            </div>
          </Link>
        ) : (
          <div />
        )}

        {next ? (
          <Link
            href={`/how-its-built/${next.slug}`}
            className="group flex items-center gap-2 font-inter text-sm text-text-secondary hover:text-crt-accent transition-colors text-right"
          >
            <div>
              <div className="text-xs text-text-muted">Next</div>
              <div>{next.shortTitle}</div>
            </div>
            <span className="text-lg">→</span>
          </Link>
        ) : (
          <Link
            href="/how-its-built"
            className="font-inter text-sm text-text-secondary hover:text-crt-accent transition-colors"
          >
            Back to Overview →
          </Link>
        )}
      </div>
    </div>
  );
}
