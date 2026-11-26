/**
 * TapbackPeople - who reacts to whom: the people you trade the most Tapbacks
 * with, and which way the Tapbacks flow.
 */
import { memo } from "react";
import type { TapbackContact } from "@/bindings/ingestion";
import { kindGlyph, kindLabel } from "./kinds";

/** Who reacts more, e.g. "You 2.1×", "Them 1.5×" or "Even". */
export function balanceLabel(given: number, received: number): string {
  if (given === 0 && received === 0) return "None";
  if (received === 0) return "Only you";
  if (given === 0) return "Only them";
  const ratio = given / received;
  if (ratio >= 1.2) return `You ${ratio.toFixed(1)}×`;
  if (ratio <= 1 / 1.2) return `Them ${(1 / ratio).toFixed(1)}×`;
  return "Even";
}

interface TapbackPeopleProps {
  people: TapbackContact[];
}

export const TapbackPeople = memo(function TapbackPeople({
  people,
}: TapbackPeopleProps) {
  if (people.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        No Tapbacks in this range.
      </p>
    );
  }

  return (
    <table className="tapback-people">
      <thead>
        <tr>
          <th scope="col">Person</th>
          <th scope="col" className="num">
            You gave
          </th>
          <th scope="col" className="num">
            You got
          </th>
          <th scope="col" title="Who reacts more, and by how much">
            Reacts more
          </th>
        </tr>
      </thead>
      <tbody>
        {people.map((p) => (
          <tr key={p.contact_id}>
            <td className="truncate" title={p.contact_id}>
              {p.display_name || p.contact_id}
            </td>
            <td
              className="num"
              title={
                p.top_given_kind
                  ? `Mostly ${kindLabel(p.top_given_kind)}`
                  : undefined
              }
            >
              {p.given.toLocaleString()}{" "}
              {p.top_given_kind && (
                <span aria-hidden="true">{kindGlyph(p.top_given_kind)}</span>
              )}
            </td>
            <td
              className="num"
              title={
                p.top_received_kind
                  ? `Mostly ${kindLabel(p.top_received_kind)}`
                  : undefined
              }
            >
              {p.received.toLocaleString()}{" "}
              {p.top_received_kind && (
                <span aria-hidden="true">{kindGlyph(p.top_received_kind)}</span>
              )}
            </td>
            <td className="text-[var(--color-text-secondary)]">
              {balanceLabel(p.given, p.received)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

export default TapbackPeople;
