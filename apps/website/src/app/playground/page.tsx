import { Metadata } from "next";
import Link from "next/link";
import { PlayCircle, ArrowRight, Bot } from "lucide-react";
import { Header } from "@/components/shared/header";
import { DEMOS } from "@/lib/demos";
import { getArticleMeta } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Playground - Be Right Back",
  description:
    "Hands-on, interactive explainers for the technology behind Be Right Back — inverted indexes, BM25 scoring, sliding-window chunking, attributedBody decoding, and more.",
};

/** Sort demos by the order of the article they accompany (unknown → last). */
function orderForArticle(slug: string): number {
  return getArticleMeta(slug)?.order ?? Number.MAX_SAFE_INTEGER;
}

export default function DemoIndexPage() {
  const demos = [...DEMOS].sort(
    (a, b) => orderForArticle(a.fromArticle) - orderForArticle(b.fromArticle),
  );

  return (
    <div className="min-h-screen bg-crt-bg">
      <Header />

      <div className="pt-24 pb-20 px-4 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Header section */}
          <div className="mb-10">
            <div className="mb-3 font-jetbrains text-sm text-text-secondary">
              <span className="text-crt-accent">$</span> ls ./playground/
            </div>

            <h1 className="mb-4 font-inter text-4xl md:text-5xl text-text-primary font-semibold tracking-tight">
              Playground
            </h1>

            <p className="font-inter text-lg text-text-secondary leading-relaxed max-w-3xl">
              These are some helpful demos for the underlying tech behind Be
              Right Back. They&apos;re not perfect, but they&apos;re a good
              starting point for getting a feel. All of these will be referenced
              by the blog articles as well.
            </p>

            <aside
              role="note"
              className="mt-6 flex max-w-3xl items-start gap-3 rounded-lg border border-crt-accent/40 bg-surface p-4"
            >
              <Bot
                size={20}
                className="mt-0.5 shrink-0 text-crt-accent"
                aria-hidden="true"
              />
              <p className="font-inter text-sm text-text-secondary leading-relaxed">
                <strong className="mb-1 block text-crt-accent">Important!</strong>Please
                note that these playgrounds were heavily generated with Claude.
                The &quot;How It&apos;s Built&quot; articles were painfully
                handwritten (so apologies about the writing).
              </p>
            </aside>
          </div>

          {/* Demo list */}
          <div className="space-y-4">
            <div className="mb-4 font-jetbrains text-sm text-text-secondary">
              <span className="text-crt-accent">$</span> ls -1 ./playground/ | wc -l{" "}
              <span className="text-text-muted">
                # {demos.length} playground
                {demos.length === 1 ? "" : "s"} available
              </span>
            </div>

            {demos.map((demo) => {
              const article = getArticleMeta(demo.fromArticle);
              return (
                <Link
                  key={demo.slug}
                  href={`/playground/${demo.slug}`}
                  className="block group"
                >
                  <div className="border border-border-subtle bg-surface rounded-lg p-5 transition-all duration-200 hover:border-crt-accent/50 hover:bg-surface-elevated">
                    <div className="flex items-start gap-4">
                      <span
                        className="text-crt-accent pt-0.5"
                        aria-hidden="true"
                      >
                        <PlayCircle size={20} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <h2 className="mb-1.5 font-inter text-lg text-crt-accent transition-colors font-medium">
                          {demo.title}
                        </h2>
                        <p className="font-inter text-sm text-text-secondary leading-relaxed">
                          {demo.description}
                        </p>
                        {article ? (
                          <div className="mt-2.5 font-jetbrains text-xs text-text-muted">
                            from{" "}
                            <span className="text-text-secondary">
                              {article.shortTitle}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <span
                        className="font-jetbrains text-text-muted group-hover:text-crt-accent transition-colors pt-0.5"
                        aria-hidden="true"
                      >
                        <ArrowRight size={18} />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
