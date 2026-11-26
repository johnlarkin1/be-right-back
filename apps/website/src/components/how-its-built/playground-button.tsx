"use client";

import Link from "next/link";
import { PlayCircle, ArrowRight } from "lucide-react";

interface PlaygroundButtonProps {
  slug: string;
  label: string;
  preview?: string;
}

/**
 * CTA card rendered inside articles by the ::playground directive.
 * Links (SPA) to /playground/<slug> where a wrapper page hosts the demo HTML in an iframe.
 */
export function PlaygroundButton({ slug, label, preview }: PlaygroundButtonProps) {
  return (
    <Link
      href={`/playground/${slug}`}
      className="playground-card"
      aria-label={`Open interactive playground: ${label}`}
    >
      <span className="playground-icon" aria-hidden="true">
        <PlayCircle size={20} />
      </span>
      <span className="playground-body">
        <span className="playground-label">{label}</span>
        {preview ? <span className="playground-preview">{preview}</span> : null}
      </span>
      <span className="playground-arrow" aria-hidden="true">
        <ArrowRight size={18} />
      </span>
    </Link>
  );
}
