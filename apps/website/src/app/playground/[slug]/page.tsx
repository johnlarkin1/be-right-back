import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/shared/header";
import { DEMOS, getDemoBySlug } from "@/lib/demos";
import { getArticleMeta } from "@/lib/articles";

export function generateStaticParams() {
  return DEMOS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: DemoPageProps): Promise<Metadata> {
  const { slug } = await params;
  const demo = getDemoBySlug(slug);
  if (!demo) {
    return { title: "Playground Not Found - Be Right Back" };
  }
  return {
    title: `${demo.title} - Be Right Back`,
    description: demo.description,
  };
}

interface DemoPageProps {
  params: Promise<{ slug: string }>;
}

export default async function DemoPage({ params }: DemoPageProps) {
  const { slug } = await params;
  const demo = getDemoBySlug(slug);
  if (!demo) notFound();

  const article = getArticleMeta(demo.fromArticle);
  const backHref = article
    ? `/how-its-built/${demo.fromArticle}`
    : "/how-its-built";
  const backLabel = article ? article.shortTitle : "How It's Built";

  return (
    <div className="min-h-screen bg-crt-bg">
      <Header />

      {/* Demo chrome: back link + title */}
      <div className="pt-16 border-b border-border-subtle bg-crt-bg/95">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-8 py-4 flex items-center justify-between gap-4">
          <Link
            href={backHref}
            className="group flex items-center gap-2 font-inter text-sm text-text-secondary hover:text-crt-accent transition-colors"
          >
            <span className="text-lg leading-none">←</span>
            <span>
              <span className="text-xs text-text-muted block leading-tight">Back to</span>
              <span className="leading-tight">{backLabel}</span>
            </span>
          </Link>
          <div className="text-right">
            <div className="font-jetbrains text-xs text-crt-accent uppercase tracking-wider">
              playground
            </div>
            <div className="font-inter text-sm md:text-base text-text-primary font-semibold">
              {demo.title}
            </div>
          </div>
        </div>
      </div>

      {/* Iframe fills the rest of the viewport */}
      <div className="w-full" style={{ height: "calc(100vh - 8.5rem)" }}>
        <iframe
          src={demo.htmlPath}
          title={demo.title}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}
