/**
 * Parser utilities for structured analysis sections
 */
import type { LucideIcon } from "lucide-react";
import {
  Lightbulb,
  Volume2,
  MessagesSquare,
  Sparkles,
  Compass,
  Users,
  Quote,
  HelpCircle,
} from "lucide-react";

export interface AnalysisSection {
  id: string; // kebab-case slug for anchor links
  title: string; // Display title
  icon: LucideIcon; // Lucide icon component
  content: string; // Raw markdown content for this section
}

// Section metadata with Lucide icons
// Updated for two-phase analysis with consolidated sections
const SECTION_ICONS: Record<string, LucideIcon> = {
  // New consolidated sections (6 total)
  insights: Lightbulb,
  "communication-emotional-style": MessagesSquare,
  "personality-traits": Sparkles,
  "common-topics-and-interests": Compass,
  "relationship-context": Users,
  "notable-quotes": Quote,

  // "You" self-analysis sections (use "Your ..." titles)
  "your-insights": Lightbulb,
  "your-communication-style": MessagesSquare,
  "your-personality-traits": Sparkles,
  "what-you-talk-about": Compass,
  "how-you-show-up-in-relationships": Users,
  "your-notable-quotes": Quote,

  // Legacy section mappings (for backward compatibility)
  "tone-and-attitude": Volume2,
  "tone-emotional-style": Volume2,
  "communication-style": MessagesSquare,
  "communication-patterns": MessagesSquare,
  "emotional-style": Volume2,
  "language-and-expression-mechanics": MessagesSquare,
  "notable-quotes-collection": Quote,
};

/**
 * Convert title to kebab-case slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Parse markdown into structured sections
 * @param markdown - Raw markdown string from LLM
 * @returns Array of parsed sections
 */
export function parseAnalysisSections(markdown: string): AnalysisSection[] {
  // Only match ### headers (h3) - these are the analysis sections
  // Ignore # and ## headers which might be titles/preamble from LLM
  const sectionRegex = /^###\s+(.+?)$/gm;
  const sections: AnalysisSection[] = [];

  console.log("[Parser] Input length:", markdown.length);
  console.log(
    "[Parser] First 100 chars:",
    JSON.stringify(markdown.slice(0, 100)),
  );

  let lastIndex = 0;
  let lastTitle = "";
  let match: RegExpExecArray | null;

  // Reset regex state
  sectionRegex.lastIndex = 0;

  // Test if regex matches at all
  const testMatch = markdown.match(/^###\s+(.+?)$/m);
  console.log("[Parser] Test match:", testMatch);

  while ((match = sectionRegex.exec(markdown)) !== null) {
    console.log("[Parser] Found match:", match[1], "at index", match.index);
    // Save previous section content
    if (lastTitle) {
      const content = markdown.slice(lastIndex, match.index).trim();
      const id = slugify(lastTitle);
      sections.push({
        id,
        title: lastTitle,
        icon: SECTION_ICONS[id] || HelpCircle,
        content,
      });
    }

    lastTitle = match[1].trim();
    lastIndex = match.index + match[0].length;
  }

  // Add final section
  if (lastTitle) {
    const content = markdown.slice(lastIndex).trim();
    const id = slugify(lastTitle);
    sections.push({
      id,
      title: lastTitle,
      icon: SECTION_ICONS[id] || HelpCircle,
      content,
    });
  }

  return sections;
}

/**
 * Clean preamble from LLM output (frontend fallback)
 * This is a safety net if Python cleanup misses something
 */
export function cleanAnalysisMarkdown(markdown: string): string {
  // Find first ### header (skip any # or ## preamble/title headers)
  const headerMatch = markdown.match(/^###\s/m);
  if (headerMatch?.index && headerMatch.index > 0) {
    console.log(
      "[Parser] Stripping preamble, skipping to first ### at index",
      headerMatch.index,
    );
    return markdown.slice(headerMatch.index);
  }
  return markdown;
}
