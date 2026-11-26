import Link from "next/link";

const COPYRIGHT = "© 2026 Be Right Back · Educational Project";

const linkClass = "text-text-secondary transition-colors hover:text-text-primary";

/**
 * Site footer. `full` is the landing footer with link columns. `compact` is
 * the one-line footer on inner pages, with a `cd ..` link home.
 */
export function SiteFooter({ variant = "compact" }: { variant?: "full" | "compact" }) {
  if (variant === "compact") {
    return (
      <footer className="border-t border-border-subtle bg-crt-bg">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-5 py-6 font-jetbrains md:px-8 md:py-8">
          <div className="flex items-center gap-6">
            <Link href="/" className={`flex min-h-11 items-center text-sm ${linkClass}`}>
              <span className="text-crt-accent">$</span>&nbsp;cd ..
            </Link>
            <Link href="/privacy" className={`flex min-h-11 items-center text-sm ${linkClass}`}>
              ./privacy
            </Link>
          </div>
          <p className="text-xs text-text-secondary">
            <span className="hidden md:inline">
              <span className="text-crt-accent">$</span> echo &quot;{COPYRIGHT}&quot;
            </span>
            <span className="md:hidden">© 2026 Be Right Back</span>
          </p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-border-subtle bg-crt-bg">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-8 px-5 py-7 md:flex-row md:flex-wrap md:items-start md:justify-between md:px-8 md:py-12">
        <div className="flex max-w-xs flex-col items-center gap-2.5 md:items-start">
          <span className="font-vt323 text-[26px] leading-none text-crt-accent">&gt; Be Right Back</span>
          <p className="hidden font-inter text-sm italic leading-relaxed text-text-secondary md:block">
            &quot;we&apos;re summoning ghosts, not building animals&quot; - Andrej Karpathy, 2025
          </p>
        </div>
        <nav aria-label="Footer" className="hidden gap-14 font-jetbrains text-[13px] md:flex">
          <div className="flex flex-col gap-2.5">
            <span className="text-text-primary">product</span>
            <Link href="/download" className={linkClass}>./download</Link>
            <Link href="/how-its-built" className={linkClass}>./how-its-built</Link>
            <Link href="/playground" className={linkClass}>./playground</Link>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="text-text-primary">project</span>
            <a
              href="https://github.com/johnlarkin1/be-right-back"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              ./github
            </a>
            <a href="mailto:john@berightback.xyz" className={linkClass}>./contact</a>
            <Link href="/privacy" className={linkClass}>./privacy</Link>
          </div>
        </nav>
      </div>
      <p className="border-border-subtle px-5 pb-7 text-center font-jetbrains text-xs text-text-secondary md:border-t md:px-8 md:py-5">
        <span className="text-crt-accent">$</span> echo &quot;{COPYRIGHT}&quot;
      </p>
    </footer>
  );
}
