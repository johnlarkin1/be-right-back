import fs from "fs";
import path from "path";
import { Metadata } from "next";
import Link from "next/link";
import { BookMarked, BookOpen, FileText, PlayCircle, type LucideIcon } from "lucide-react";
import { renderMarkdownToHtml } from "@/lib/markdown";
import { RESOURCES_NAV } from "@/lib/articles";
import { ArticleContent } from "@/components/how-its-built";

export const metadata: Metadata = {
  title: "Resources & References - Be Right Back",
  description:
    "The running bibliography for the How It's Built series — videos, papers, articles, and a full glossary of terms.",
};

// Lucide icon per section key (keys come from the <!--SECTION:key:Title--> markers).
const SECTION_ICONS: Record<string, LucideIcon> = {
  videos: PlayCircle,
  papers: FileText,
  articles: BookOpen,
  glossary: BookMarked,
};

interface Section {
  key: string;
  title: string;
  bodyHtml: string;
}

/**
 * Split the curated resources markdown into an intro + titled sections using
 * the `<!--SECTION:key:Title-->` markers. Each section body is rendered to HTML
 * independently so its headings get icons via JSX rather than emoji.
 */
async function parseResources(raw: string): Promise<{ introHtml: string; sections: Section[] }> {
  const parts = raw.split(/<!--SECTION:([a-z]+):([^>]*?)-->\n?/);
  const introHtml = await renderMarkdownToHtml(parts[0].trim());

  const sections: Section[] = [];
  for (let i = 1; i < parts.length; i += 3) {
    const key = parts[i];
    const title = parts[i + 1].trim();
    const bodyHtml = await renderMarkdownToHtml((parts[i + 2] ?? "").trim());
    sections.push({ key, title, bodyHtml });
  }
  return { introHtml, sections };
}

export default async function ResourcesPage() {
  const resourcesMd = fs.readFileSync(
    path.join(process.cwd(), "content", "how-its-built", "resources.md"),
    "utf-8"
  );
  const glossaryMd = fs.readFileSync(
    path.join(process.cwd(), "content", "glossary.md"),
    "utf-8"
  );

  const { introHtml, sections } = await parseResources(resourcesMd);
  // The full glossary, rendered from the same glossary.md that powers the inline
  // tooltips — single source of truth, no duplication.
  const glossaryHtml = await renderMarkdownToHtml(glossaryMd);

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
        <span className="text-crt-accent">{RESOURCES_NAV.slug}</span>
      </div>

      {/* Header (unnumbered — this is a standalone reference page, not a sequential article) */}
      <div className="mb-8">
        <h1 className="mb-4 font-inter text-3xl md:text-4xl text-text-primary font-semibold tracking-tight">
          {RESOURCES_NAV.title}
        </h1>
        <p className="font-inter text-text-secondary leading-relaxed">
          {RESOURCES_NAV.description}
        </p>
      </div>

      {/* Intro */}
      <ArticleContent htmlContent={introHtml} />

      {/* Curated sections, each with a Lucide icon heading */}
      {sections.map(({ key, title, bodyHtml }) => {
        const Icon = SECTION_ICONS[key] ?? BookOpen;
        return (
          <section key={key} className="mt-12">
            <h2
              id={key}
              className="scroll-mt-24 mb-4 flex items-center gap-2.5 font-inter text-2xl font-semibold text-text-primary tracking-tight"
            >
              <Icon className="h-6 w-6 text-crt-accent" aria-hidden />
              {title}
            </h2>
            <ArticleContent htmlContent={bodyHtml} />
            {key === "glossary" && <ArticleContent htmlContent={glossaryHtml} className="mt-2" />}
          </section>
        );
      })}

      {/* Navigation */}
      <div className="mt-16 flex justify-end items-center border-t border-border-subtle pt-8">
        <Link
          href="/how-its-built"
          className="font-inter text-sm text-text-secondary hover:text-crt-accent transition-colors text-right"
        >
          Back to Overview →
        </Link>
      </div>
    </div>
  );
}
