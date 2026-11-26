import { describe, it, expect } from "vitest";
import { parseAnalysisSections, cleanAnalysisMarkdown } from "./analysisParser";
import {
  Lightbulb,
  Quote,
  HelpCircle,
  MessagesSquare,
  Compass,
  Users,
} from "lucide-react";

// ── parseAnalysisSections ────────────────────────────────────

describe("parseAnalysisSections", () => {
  it("parses ### sections correctly", () => {
    const markdown = [
      "### Insights",
      "Some insight content here.",
      "",
      "### Notable Quotes",
      "A quote from someone.",
    ].join("\n");

    const sections = parseAnalysisSections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Insights");
    expect(sections[0].content).toContain("Some insight content here.");
    expect(sections[1].title).toBe("Notable Quotes");
    expect(sections[1].content).toContain("A quote from someone.");
  });

  it("returns correct icons for known sections", () => {
    const markdown = [
      "### Insights",
      "content",
      "### Notable Quotes",
      "content",
      "### Communication Emotional Style",
      "content",
      "### Common Topics and Interests",
      "content",
      "### Relationship Context",
      "content",
    ].join("\n");

    const sections = parseAnalysisSections(markdown);
    expect(sections[0].icon).toBe(Lightbulb);
    expect(sections[1].icon).toBe(Quote);
    expect(sections[2].icon).toBe(MessagesSquare);
    expect(sections[3].icon).toBe(Compass);
    expect(sections[4].icon).toBe(Users);
  });

  it("falls back to HelpCircle for unknown sections", () => {
    const markdown = "### Some Random Section\nContent here.";
    const sections = parseAnalysisSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0].icon).toBe(HelpCircle);
  });

  it("returns empty array for empty input", () => {
    const sections = parseAnalysisSections("");
    expect(sections).toEqual([]);
  });

  it("returns empty array when there are no ### headers", () => {
    const markdown = "Just some plain text without any headers.";
    const sections = parseAnalysisSections(markdown);
    expect(sections).toEqual([]);
  });

  it("ignores # and ## headers", () => {
    const markdown = [
      "# Big Title",
      "## Subtitle",
      "Some preamble text.",
      "### Actual Section",
      "This is the real content.",
    ].join("\n");

    const sections = parseAnalysisSections(markdown);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Actual Section");
    expect(sections[0].content).toContain("This is the real content.");
  });
});

// ── cleanAnalysisMarkdown ────────────────────────────────────

describe("cleanAnalysisMarkdown", () => {
  it("strips preamble before first ###", () => {
    const markdown = [
      "# Analysis Report",
      "Here is some preamble the LLM added.",
      "",
      "### Insights",
      "The actual content.",
    ].join("\n");

    const cleaned = cleanAnalysisMarkdown(markdown);
    expect(cleaned).toMatch(/^### Insights/);
    expect(cleaned).not.toContain("Analysis Report");
    expect(cleaned).not.toContain("preamble");
  });

  it("returns unchanged if starts with ###", () => {
    const markdown = "### Insights\nContent here.";
    const cleaned = cleanAnalysisMarkdown(markdown);
    expect(cleaned).toBe(markdown);
  });

  it("returns unchanged if no ### headers exist", () => {
    const markdown = "Just plain text with no headers at all.";
    const cleaned = cleanAnalysisMarkdown(markdown);
    expect(cleaned).toBe(markdown);
  });
});
