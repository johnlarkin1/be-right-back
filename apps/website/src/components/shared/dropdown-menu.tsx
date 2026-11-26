"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { HeaderDropdownItem } from "@/lib/articles";

interface DropdownMenuProps {
  label: string;
  /** Where the trigger links. The menu counts as active under this path. */
  href: string;
  items: HeaderDropdownItem[];
  /** Footer text when no item is under the pointer. */
  defaultHint: string;
  /** Headings for the `intro` and `deep` groups. */
  headings?: { intro: string; deep: string };
  /** Columns for the grouped item grids. Long titles read better in one. */
  columns?: 1 | 2;
  /** Extra classes for the trigger when idle (e.g. ghost-button styling). */
  triggerClassName?: string;
  /** Extra classes applied to the trigger when the section is active. */
  triggerActiveClassName?: string;
}

/**
 * A header section menu (How It's Built, Playground). Items show titles only.
 * The footer shows the description of the item under the pointer or focus.
 */
export function DropdownMenu({
  label,
  href,
  items,
  defaultHint,
  headings = { intro: "Start here", deep: "Deep dives" },
  columns = 2,
  triggerClassName = "hover:text-crt-text hover:[text-shadow:0_0_6px_currentColor]",
  triggerActiveClassName = "text-crt-text [text-shadow:0_0_6px_currentColor]",
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hint, setHint] = useState(defaultHint);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);
  const grid = columns === 2 ? "grid grid-cols-2" : "grid grid-cols-1";

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const top = items.filter((i) => i.group === "top");
  const intro = items.filter((i) => i.group === "intro");
  const deep = items.filter((i) => i.group === "deep");

  const item = (it: HeaderDropdownItem, pill = false) => {
    const current = pathname === it.href;
    const show = () => setHint(it.description);
    return (
      <Link
        key={it.href}
        href={it.href}
        onClick={() => setIsOpen(false)}
        onMouseEnter={show}
        onFocus={show}
        aria-current={current ? "page" : undefined}
        className={
          pill
            ? `border px-3 py-1.5 font-sans text-sm transition-all hover:border-crt-accent hover:bg-crt-text/10 ${
                current
                  ? "border-crt-accent text-crt-accent"
                  : "border-crt-text/25 text-crt-accent"
              }`
            : `block truncate px-3 py-1.5 font-sans text-sm transition-all hover:bg-crt-text/10 ${
                current ? "bg-crt-text/10 text-crt-text" : "text-crt-accent"
              }`
        }
      >
        {it.label}
      </Link>
    );
  };

  const heading = (text: string) => (
    <div className="px-3 pb-1 pt-3 font-ibm-plex-mono text-[11px] uppercase tracking-[0.14em] text-crt-body-muted/70">
      {text}
    </div>
  );

  return (
    <div
      className="relative"
      ref={dropdownRef}
      onMouseLeave={() => {
        setIsOpen(false);
        setHint(defaultHint);
      }}
    >
      <Link
        href={href}
        onMouseEnter={() => setIsOpen(true)}
        className={`flex items-center gap-1 transition-colors ${triggerClassName} ${
          isActive ? triggerActiveClassName : ""
        }`}
      >
        {label}
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </Link>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            // pt-2 bridges the gap to the trigger, so the pointer stays
            // inside the wrapper on its way down and the menu stays open.
            className="absolute top-full left-0 pt-2 w-[min(520px,calc(100vw-2rem))] whitespace-normal"
          >
            <div className="rounded-[10px] border border-border-subtle bg-surface/98 p-2 backdrop-blur-md shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
              {/* Header */}
              <div className="px-3 py-2 border-b border-crt-text/20">
                <span className="font-ibm-plex-mono text-xs text-crt-accent">
                  $ ls .{href}/
                </span>
              </div>

              {/* Pinned links */}
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {top.map((it) => item(it, true))}
              </div>

              {intro.length > 0 && (
                <>
                  {heading(headings.intro)}
                  <div className={grid}>
                    {intro.map((it) => item(it))}
                  </div>
                </>
              )}

              {deep.length > 0 && (
                <>
                  {heading(headings.deep)}
                  <div className={grid}>
                    {deep.map((it) => item(it))}
                  </div>
                </>
              )}

              {/* Description of the item under the pointer */}
              <div className="mt-2 min-h-[2.75rem] border-t border-crt-text/20 px-3 py-2">
                <span
                  aria-hidden="true"
                  className="font-sans text-xs leading-snug text-crt-body-muted"
                >
                  {hint}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
