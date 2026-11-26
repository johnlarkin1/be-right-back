/**
 * useTapbacks - Tapback summary, top people and monthly counts for a window.
 *
 * Refetches when the window changes. A stale response never overwrites a newer one.
 */
import { useEffect, useState } from "react";
import {
  getMostReactedMessages,
  getTapbackContacts,
  getTapbackEmojis,
  getTapbackMonthly,
  getTapbackSummary,
} from "@/services/tauri";
import type {
  ReactedMessage,
  TapbackContact,
  TapbackEmoji,
  TapbackMonth,
  TapbackSummary,
  TapbackWindow,
} from "@/bindings/ingestion";

/** People listed in "Who reacts to whom". */
export const TOP_PEOPLE = 8;
/** Messages listed in "Most-loved messages". */
export const TOP_MESSAGES = 5;
/** Emoji listed in "Emoji Tapbacks". */
export const TOP_EMOJIS = 12;

export interface TapbackData {
  summary: TapbackSummary | null;
  people: TapbackContact[];
  months: TapbackMonth[];
  loved: ReactedMessage[];
  emojis: TapbackEmoji[];
  isLoading: boolean;
  error: string | null;
}

export function useTapbacks(window: TapbackWindow): TapbackData {
  const [data, setData] = useState<TapbackData>({
    summary: null,
    people: [],
    months: [],
    loved: [],
    emojis: [],
    isLoading: true,
    error: null,
  });
  const { start, end } = window;

  useEffect(() => {
    let current = true;
    const w = { start, end };
    setData((d) => ({ ...d, isLoading: true, error: null }));
    Promise.all([
      getTapbackSummary(w),
      getTapbackContacts(w, TOP_PEOPLE),
      getTapbackMonthly(w),
      getMostReactedMessages(w, TOP_MESSAGES),
      getTapbackEmojis(w, TOP_EMOJIS),
    ])
      .then(([summary, people, months, loved, emojis]) => {
        if (current)
          setData({
            summary,
            people,
            months,
            loved,
            emojis,
            isLoading: false,
            error: null,
          });
      })
      .catch((err) => {
        if (current)
          setData((d) => ({ ...d, isLoading: false, error: String(err) }));
      });
    return () => {
      current = false;
    };
  }, [start, end]);

  return data;
}

/** Summary for one contact (or for everyone when `contactId` is null). */
export function useTapbackSummary(contactId: string | null): {
  summary: TapbackSummary | null;
  isLoading: boolean;
} {
  const [summary, setSummary] = useState<TapbackSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setIsLoading(true);
    getTapbackSummary({ start: null, end: null }, contactId)
      .then((s) => current && setSummary(s))
      .catch(() => current && setSummary(null))
      .finally(() => current && setIsLoading(false));
    return () => {
      current = false;
    };
  }, [contactId]);

  return { summary, isLoading };
}
