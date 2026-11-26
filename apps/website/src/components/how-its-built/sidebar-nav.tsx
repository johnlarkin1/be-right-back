"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ARTICLES, RESOURCES_NAV } from "@/lib/articles";

interface SidebarNavProps {
  className?: string;
}

export function SidebarNav({ className = "" }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Articles"
      className={`flex flex-col gap-0.5 font-jetbrains text-[13px] ${className}`}
    >
      <span className="px-2.5 pb-3 text-[11px] tracking-[1px] text-text-secondary">
        ARTICLES
      </span>

      <NavItem
        href="/how-its-built"
        label="Overview"
        isActive={pathname === "/how-its-built"}
        order={0}
        showOrder={false}
      />

      {ARTICLES.map((article) => (
        <NavItem
          key={article.slug}
          href={`/how-its-built/${article.slug}`}
          label={article.shortTitle}
          isActive={pathname === `/how-its-built/${article.slug}`}
          order={article.order}
        />
      ))}

      {/* Resources: the standalone reference page, unnumbered */}
      <div className="mt-3 border-t border-border-subtle pt-1">
        <NavItem
          href={`/how-its-built/${RESOURCES_NAV.slug}`}
          label={RESOURCES_NAV.shortTitle}
          isActive={pathname === `/how-its-built/${RESOURCES_NAV.slug}`}
          order={0}
          showOrder={false}
        />
      </div>
    </nav>
  );
}

function NavItem({
  href,
  label,
  isActive,
  order,
  showOrder = true,
}: {
  href: string;
  label: string;
  isActive: boolean;
  order: number;
  showOrder?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex gap-2.5 rounded-md px-2.5 py-2 transition-colors ${
        isActive
          ? "bg-crt-accent/10 text-crt-accent"
          : "text-text-secondary hover:bg-crt-accent/5 hover:text-text-primary"
      }`}
    >
      {showOrder && (
        <span className="tabular-nums text-crt-accent">
          {String(order).padStart(2, "0")}
        </span>
      )}
      <span>{label}</span>
    </Link>
  );
}
