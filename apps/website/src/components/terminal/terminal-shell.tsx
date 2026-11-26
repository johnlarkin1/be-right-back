"use client";

import { TerminalProvider } from "./terminal-provider";
import { TerminalDrawer } from "./terminal-drawer";
import { TerminalTrigger } from "./terminal-trigger";

export function TerminalShell({ children }: { children: React.ReactNode }) {
  return (
    <TerminalProvider>
      {children}
      <TerminalTrigger />
      <TerminalDrawer />
    </TerminalProvider>
  );
}
