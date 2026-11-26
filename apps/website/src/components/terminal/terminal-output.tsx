"use client";

import { useEffect, useRef } from "react";
import type { OutputLine } from "./terminal-commands";

export interface HistoryEntry {
  command: string;
  output: OutputLine[];
  prompt: string;
}

interface TerminalOutputProps {
  history: HistoryEntry[];
}

export function TerminalOutput({ history }: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 font-jetbrains text-sm leading-relaxed">
      {history.map((entry, i) => (
        <div key={i} className="mb-2">
          {/* The command that was typed */}
          <div className="flex">
            <span className="text-crt-accent mr-1 shrink-0">{entry.prompt}</span>
            <span className="text-crt-body">{entry.command}</span>
          </div>
          {/* Output lines */}
          {entry.output.map((line, j) => (
            <div
              key={j}
              className={`whitespace-pre-wrap ${line.className ?? "text-crt-body/80"}`}
            >
              {line.text || "\u00A0"}
            </div>
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
