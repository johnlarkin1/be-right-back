import { Metadata } from "next";
import Link from "next/link";
import { ARTICLES } from "@/lib/articles";
import { ReadingModeTip } from "@/components/how-its-built";

export const metadata: Metadata = {
  title: "How It's Built - Be Right Back",
  description:
    "Technical deep dive into building a local-first AI app with Rust, MLX, and Tauri.",
};

const START_SLUG = "preface";

function articleNumber(order: number) {
  return String(order).padStart(2, "0");
}

export default function HowItsBuiltPage() {
  const start = ARTICLES.find((a) => a.slug === START_SLUG);
  const rest = ARTICLES.filter((a) => a.slug !== START_SLUG);

  return (
    <div className="flex flex-col gap-5 md:gap-8">
      <div className="flex flex-col gap-3 md:gap-3.5">
        <p className="font-jetbrains text-[13px] text-crt-text md:text-sm">
          <span className="text-crt-accent">$</span> cat ./how-its-built/README.md
        </p>
        <h1 className="font-inter text-[38px] font-semibold leading-[1.05] tracking-[-0.03em] text-text-primary md:text-[56px]">
          How It&apos;s Built
        </h1>
        <p className="max-w-[680px] font-inter text-base leading-relaxed text-text-secondary md:text-[19px]">
          A walk through of some of the design decisions and architecture behind
          Be Right Back.
        </p>
      </div>

      <ReadingModeTip />

      {start && (
        <Link
          href={`/how-its-built/${start.slug}`}
          className="group flex flex-wrap items-center justify-between gap-5 rounded-[14px] border border-crt-accent/30 bg-surface p-[22px] transition-colors hover:border-crt-accent/35 hover:bg-surface-elevated md:p-8"
        >
          <span className="flex flex-[1_1_360px] flex-col gap-2">
            <span className="font-jetbrains text-[11px] tracking-[1px] text-crt-accent md:text-xs">
              [{articleNumber(start.order)}] START HERE
            </span>
            <span className="font-inter text-2xl font-semibold tracking-[-0.02em] text-text-primary md:text-[28px]">
              {start.title}
            </span>
            <span className="font-inter text-[15px] leading-relaxed text-text-secondary md:text-base">
              {start.description}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="hidden font-jetbrains text-[22px] text-text-secondary transition-colors group-hover:text-crt-accent md:inline"
          >
            -&gt;
          </span>
        </Link>
      )}

      <div className="flex flex-col gap-3">
        <p className="mt-2 mb-1 font-jetbrains text-xs text-text-secondary md:mt-0 md:text-[13px]">
          <span className="text-crt-accent">$</span> ls ./articles/
        </p>
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-border-subtle md:grid md:grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] md:gap-3 md:overflow-visible md:rounded-none md:border-0">
          {rest.map((article) => (
            <Link
              key={article.slug}
              href={`/how-its-built/${article.slug}`}
              className="group flex gap-3.5 border-b border-border-subtle bg-surface p-[18px] transition-colors last:border-b-0 hover:bg-surface-elevated md:gap-4 md:rounded-[10px] md:border md:p-[22px] md:last:border-b md:hover:border-crt-accent/35"
            >
              <span className="pt-[3px] font-jetbrains text-xs text-crt-accent md:text-[13px]">
                [{articleNumber(article.order)}]
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1 md:gap-1.5">
                <span className="font-inter text-base font-semibold text-text-primary md:text-[17px] md:tracking-[-0.01em]">
                  {article.title}
                </span>
                <span className="font-inter text-[13.5px] leading-normal text-text-secondary md:text-sm md:leading-[1.55]">
                  {article.description}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="hidden font-jetbrains text-text-secondary transition-colors group-hover:text-crt-accent md:inline"
              >
                -&gt;
              </span>
            </Link>
          ))}
        </div>
      </div>

      <p className="rounded-[10px] border border-dashed border-crt-accent/30 p-3.5 text-center font-jetbrains text-xs leading-normal text-text-secondary md:px-5 md:py-4 md:text-[13px]">
        <span className="text-crt-accent">&gt;</span> Content is being written.
        Check back for updates as articles are completed.
      </p>
    </div>
  );
}
