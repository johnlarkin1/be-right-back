"use client";

import { CursorSpotlight } from "@/components/landing/cursor-spotlight";

export function ComingSoon() {
  return (
    <>
      <CursorSpotlight />

      <div className="min-h-screen bg-crt-bg flex flex-col items-center justify-center px-4">
        {/* CRT scanline overlay effect */}
        <div
          className="pointer-events-none fixed inset-0 z-50"
          style={{
            background: `repeating-linear-gradient(
              0deg,
              rgba(0, 0, 0, 0.15) 0px,
              rgba(0, 0, 0, 0.15) 1px,
              transparent 1px,
              transparent 2px
            )`,
          }}
        />

        {/* Main content */}
        <div className="relative z-10 text-center">
          {/* Terminal prompt */}
          <div className="mb-8 font-ibm-plex-mono text-base text-crt-text/60">
            <span className="text-crt-accent">$</span> ./be-right-back
          </div>

          {/* Main title */}
          <h1
            className="font-vt323 text-4xl sm:text-6xl md:text-8xl text-crt-text mb-6"
            style={{ textShadow: "0 0 20px var(--crt-glow)" }}
          >
            Be Right Back
          </h1>

          {/* Coming soon message */}
          <div className="font-ibm-plex-mono text-xl md:text-2xl text-crt-text/80">
            <span className="text-crt-accent">&gt;</span> Coming soon
            <span className="cursor-blink text-crt-accent">_</span>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-8 font-ibm-plex-mono text-sm text-crt-text/30">
          <span className="text-crt-accent/50">$</span> echo &quot;© 2026&quot;
        </div>
      </div>
    </>
  );
}
