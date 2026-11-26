"use client";

import { useEffect, useState } from "react";
import type { TableOfContentsItem } from "@/lib/markdown";

interface TableOfContentsProps {
  headings: TableOfContentsItem[];
  className?: string;
}

export function TableOfContents({ headings, className = "" }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      {
        rootMargin: "-80px 0% -80% 0%",
        threshold: 0,
      }
    );

    // Observe all heading elements
    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => {
      headings.forEach((heading) => {
        const element = document.getElementById(heading.id);
        if (element) {
          observer.unobserve(element);
        }
      });
    };
  }, [headings]);

  if (headings.length === 0) {
    return null;
  }

  // Filter to h2, h3, and h4 for the TOC
  const filteredHeadings = headings.filter(
    (h) => h.level === 2 || h.level === 3 || h.level === 4
  );

  return (
    <nav className={`space-y-1 ${className}`}>
      <div className="font-jetbrains text-xs text-text-muted uppercase tracking-wider mb-3">
        On this page
      </div>
      {filteredHeadings.map((heading, index) => (
        <a
          key={`${heading.id}-${index}`}
          href={`#${heading.id}`}
          onClick={(e) => {
            e.preventDefault();
            const element = document.getElementById(heading.id);
            if (element) {
              element.scrollIntoView({ behavior: "smooth" });
              // Update URL without scroll
              window.history.pushState(null, "", `#${heading.id}`);
            }
          }}
          className={`
            block py-1 transition-colors duration-150
            ${heading.level === 4 ? "pl-8 text-xs" : "text-sm"}
            ${heading.level === 3 ? "pl-4" : ""}
            ${
              activeId === heading.id
                ? "text-crt-accent"
                : "text-text-secondary hover:text-text-primary"
            }
          `}
        >
          {heading.text}
        </a>
      ))}
    </nav>
  );
}
