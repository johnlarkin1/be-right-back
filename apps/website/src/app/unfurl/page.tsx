"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { UnfurlCanvas } from "@/components/unfurl/unfurl-canvas";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Unfurl Preview Page
 *
 * This page is used for recording the animated GIF for social media unfurls.
 * It renders the UnfurlCanvas component at exactly 1200x630 pixels.
 *
 * To record:
 * 1. Run `npm run dev` and navigate to http://localhost:3000/unfurl
 * 2. Use a screen recording tool (Kap on macOS, ScreenToGif on Windows)
 * 3. Record a 3-5 second loop
 * 4. Export as GIF and MP4
 * 5. Place files in public/unfurls/
 *
 * Hidden in production to avoid cluttering the site.
 */
export default function UnfurlPreviewPage() {
  // Hide cursor for clean recording
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "unfurl-cursor-hide";
    style.textContent = `
      * { cursor: none !important; }
      body { overflow: hidden; }
    `;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById("unfurl-cursor-hide");
      if (el) document.head.removeChild(el);
    };
  }, []);

  if (isProduction) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-crt-bg">
        <div className="text-center font-ibm-plex-mono text-crt-text">
          <p className="text-xl">This page is only available in development.</p>
          <Link
            href="/"
            className="mt-4 inline-block text-crt-accent hover:underline"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-900 p-8">
      {/* Instructions */}
      <div className="max-w-xl text-center font-ibm-plex-mono text-sm text-gray-400">
        <h1 className="mb-4 text-xl text-white">Unfurl Preview</h1>
        <p className="mb-2">
          This canvas is exactly <strong>1200x630 pixels</strong> - the standard
          Open Graph size.
        </p>
        <p className="mb-2">
          Use a screen recorder to capture a 3-5 second loop, then export as GIF
          and MP4.
        </p>
        <p className="text-crt-accent">
          Place the files in <code>public/unfurls/</code>
        </p>
      </div>

      {/* The actual unfurl canvas */}
      <div
        className="overflow-hidden rounded-lg shadow-2xl"
        style={{
          width: "1200px",
          height: "630px",
          border: "2px solid #333",
        }}
      >
        <UnfurlCanvas />
      </div>

      {/* Size indicator */}
      <div className="font-mono text-xs text-gray-500">1200 × 630 px</div>
    </div>
  );
}
