/**
 * Centralized tooltip content definitions
 * Non-technical explanations for technical terms in the UI
 */

export const tooltipContent = {
  // CompactStatsBar - Data stats
  chunks: "Text segments that help AI understand and search your conversations",

  // CompactStatsBar - Storage stats
  snapshot: "A copy of your Messages database stored locally for searching",
  vectors: "Numbers that represent meaning, enabling smart search",
  total: "Combined storage used by snapshots and search data",

  // StatsRow - Insight cards
  response: "Average time between receiving a message and replying",
  active: "Days when you exchanged at least one message",
  topics: "Themes and subjects detected by AI in your conversations",

  // Buttons
  reanalyze: "Run AI analysis again to discover new conversation patterns",
  syncNewMessages: "Check your Mac for new messages and add them to search",
} as const;
