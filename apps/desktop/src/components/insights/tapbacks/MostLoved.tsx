/**
 * MostLoved - your messages with the most Tapbacks from others,
 * and the emoji you and others react with.
 */
import { memo } from "react";
import type { ReactedMessage, TapbackEmoji } from "@/bindings/ingestion";
import { formatDate } from "@/lib/format";
import { kindGlyph, kindLabel } from "./kinds";

/** Where the message was sent: a contact, or a group chat. */
function placeLabel(m: ReactedMessage): string {
  if (m.contact_name) return `to ${m.contact_name}`;
  if (m.contact_id) return `to ${m.contact_id}`;
  return "in a group chat";
}

export const MostLovedMessages = memo(function MostLovedMessages({
  messages,
}: {
  messages: ReactedMessage[];
}) {
  if (messages.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        No reactions to your messages in this range.
      </p>
    );
  }

  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-2">
      {messages.map((m) => (
        <li key={m.message_rowid} className="tapback-loved-item">
          <p className="tapback-loved-text">
            {m.text ?? (
              <span className="text-[var(--color-text-muted)]">
                No text (a photo or attachment)
              </span>
            )}
          </p>
          <div className="tapback-loved-meta">
            <span
              className="tapback-loved-kinds"
              title={m.kinds
                .map((k) => `${kindLabel(k.kind)} ${k.received}`)
                .join(", ")}
            >
              {m.kinds.map((k) => (
                <span key={k.kind}>
                  <span aria-hidden="true">{kindGlyph(k.kind)}</span>
                  {k.received > 1 ? ` ${k.received}` : ""}
                </span>
              ))}
            </span>
            <span>
              {m.tapbacks.toLocaleString()} Tapbacks from{" "}
              {m.people === 1 ? "1 person" : `${m.people} people`}
            </span>
            <span>
              {placeLabel(m)}
              {m.sent_at != null &&
                `, ${formatDate(new Date(m.sent_at * 1000).toISOString(), {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}`}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
});

export const EmojiTapbacks = memo(function EmojiTapbacks({
  emojis,
}: {
  emojis: TapbackEmoji[];
}) {
  if (emojis.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        No emoji Tapbacks yet. They arrived in iOS 18 and macOS 15.
      </p>
    );
  }

  return (
    <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
      {emojis.map((e) => (
        <li
          key={e.emoji}
          className="tapback-emoji-chip"
          title={`You gave ${e.given.toLocaleString()}, you got ${e.received.toLocaleString()}`}
        >
          <span className="text-base" aria-hidden="true">
            {e.emoji}
          </span>
          <span>{(e.given + e.received).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
});
