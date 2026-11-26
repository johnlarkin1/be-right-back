"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, Search, X } from "lucide-react";
import { GhostMark } from "./ghost-mark";
import { DropdownMenu } from "./dropdown-menu";
import { getHeaderDropdownItems } from "@/lib/articles";
import { getPlaygroundDropdownItems } from "@/lib/demos";
import { useCommandPalette } from "@/components/search/search-provider";
import { trackEvent } from "@/lib/analytics";

interface HeaderProps {
  animate?: boolean;
}

// Get the dropdown items from the centralized article config
const howItsBuiltChapters = getHeaderDropdownItems();
const playgrounds = getPlaygroundDropdownItems();

export function Header({ animate = false }: HeaderProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { openSearch } = useCommandPalette();

  const navLinks = [{ href: "/how-its-built/preface", label: "./about" }];

  const isDownloadPage = pathname === "/download";
  const linkIdle = "text-text-secondary hover:text-text-primary transition-colors";
  const linkActive = "text-crt-accent";

  const allNavLinks = [
    { href: "/how-its-built", label: "./how-its-built" },
    { href: "/playground", label: "./playground" },
    ...navLinks,
  ];

  const headerContent = (
    <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5 md:px-8">
      <Link
        href="/"
        aria-label="Be Right Back home"
        className="flex items-center gap-2.5 whitespace-nowrap font-vt323 text-[26px] leading-none text-crt-accent transition-colors hover:text-[#ffc94d] md:text-[28px]"
        onClick={() => trackEvent("nav_clicked", { label: "> BRB", destination: "/" })}
      >
        <GhostMark size={22} />
        &gt; BRB
      </Link>

      {/* Desktop navigation */}
      <nav
        aria-label="Main"
        className="hidden md:flex items-center gap-5 lg:gap-7 whitespace-nowrap font-jetbrains text-sm"
      >
        <DropdownMenu
          label="./how-its-built"
          href="/how-its-built"
          items={howItsBuiltChapters}
          defaultHint="Technical deep dives into the project"
          triggerClassName={
            pathname.startsWith("/how-its-built") ? linkActive : linkIdle
          }
          triggerActiveClassName=""
        />

        <DropdownMenu
          label="./playground"
          href="/playground"
          items={playgrounds}
          defaultHint="Hands-on demos of the tech behind Be Right Back"
          headings={{ intro: "", deep: "Demos" }}
          columns={1}
          triggerClassName={
            pathname.startsWith("/playground") ? linkActive : linkIdle
          }
          triggerActiveClassName=""
        />

        {navLinks.map((link) => {
          const isActive =
            link.href === pathname || pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={isActive ? linkActive : linkIdle}
              onClick={() => trackEvent("nav_clicked", { label: link.label, destination: link.href })}
            >
              {link.label}
            </Link>
          );
        })}

        {/* Search trigger (Cmd+K) */}
        <button
          type="button"
          onClick={() => {
            trackEvent("search_opened", { source: "header" });
            openSearch();
          }}
          aria-label="Search the site (Command K)"
          className="flex h-9 items-center gap-2.5 rounded-md border border-border-subtle bg-surface px-3 text-[13px] text-text-secondary transition-colors hover:border-crt-accent/40 hover:text-text-primary"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          search
          <span className="hidden rounded border border-[rgba(232,228,210,0.12)] px-1.5 py-px text-[11px] lg:inline">
            ⌘K
          </span>
        </button>

        <Link
          href="/download"
          aria-current={isDownloadPage ? "page" : undefined}
          className={`inline-flex h-9 items-center rounded-md border border-crt-accent px-3.5 transition-colors ${
            isDownloadPage
              ? "bg-crt-accent text-[#09090b]"
              : "bg-crt-accent/10 text-crt-accent hover:bg-crt-accent/20"
          }`}
          onClick={() => trackEvent("nav_clicked", { label: "./download", destination: "/download" })}
        >
          ./download
        </Link>
      </nav>

      {/* Mobile menu button */}
      <button
        type="button"
        className="md:hidden flex h-11 w-11 items-center justify-center rounded-lg border border-[rgba(232,228,210,0.12)] bg-surface text-text-primary"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-expanded={mobileMenuOpen}
        aria-label="Menu"
      >
        {mobileMenuOpen ? (
          <X className="h-[18px] w-[18px]" aria-hidden />
        ) : (
          <Menu className="h-[18px] w-[18px]" aria-hidden />
        )}
      </button>
    </div>
  );

  const mobileMenu = (
    <AnimatePresence>
      {mobileMenuOpen && (
        <>
          {/* Backdrop - tap to close */}
          <motion.div
            className="md:hidden fixed inset-0 bg-black/60 z-30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileMenuOpen(false)}
          />
          <motion.nav
            aria-label="Main"
            className="md:hidden fixed left-0 right-0 top-16 z-40 overflow-hidden border-b border-border-subtle bg-crt-bg"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex flex-col gap-1 px-5 pt-2 pb-5 font-jetbrains text-[15px]">
              <button
                type="button"
                onClick={() => {
                  trackEvent("search_opened", { source: "mobile-menu" });
                  setMobileMenuOpen(false);
                  openSearch();
                }}
                className="flex items-center gap-2 border-b border-border-subtle py-3 text-left text-text-primary"
              >
                <Search className="h-4 w-4" aria-hidden />
                search
              </button>
              {allNavLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={link.href === pathname ? "page" : undefined}
                  onClick={() => { trackEvent("nav_clicked", { label: link.label, destination: link.href }); setMobileMenuOpen(false); }}
                  className={`border-b border-border-subtle py-3 ${
                    link.href === pathname ? "text-crt-accent" : "text-text-primary"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/download"
                onClick={() => { trackEvent("nav_clicked", { label: "./download", destination: "/download" }); setMobileMenuOpen(false); }}
                className="mt-3 flex h-12 items-center justify-center rounded-lg border border-crt-accent bg-crt-accent/10 text-crt-accent"
              >
                ./download
              </Link>
            </div>
          </motion.nav>
        </>
      )}
    </AnimatePresence>
  );

  if (animate) {
    return (
      <>
        <motion.header
          className="fixed top-0 left-0 right-0 z-40 border-b border-border-subtle bg-crt-bg/92 backdrop-blur-sm"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
        >
          {headerContent}
        </motion.header>
        {mobileMenu}
      </>
    );
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-border-subtle bg-crt-bg/92 backdrop-blur-sm">
        {headerContent}
      </header>
      {mobileMenu}
    </>
  );
}
