import type { Metadata } from "next";

// Re-export Metadata type for use by page.tsx
export type { Metadata };

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://berightback.xyz";

const UNFURL_PATHS = {
  gif: "/unfurls/main.gif",
  mp4: "/unfurls/main.mp4",
  static: "/unfurls/main-static.png",
};

export function getPlatformSpecificImage(userAgent?: string): {
  url: string;
  type: string;
} {
  // i love gifs and we should prefer them
  let imageUrl = `${BASE_URL}${UNFURL_PATHS.gif}`;
  let mimeType = "image/gif";

  if (userAgent) {
    const ua = userAgent.toLowerCase();

    // discord - gif
    if (ua.includes("discordbot") || ua.includes("discord")) {
      return { url: `${BASE_URL}${UNFURL_PATHS.gif}`, type: "image/gif" };
    }

    // slack - gif
    if (ua.includes("slackbot")) {
      return { url: `${BASE_URL}${UNFURL_PATHS.gif}`, type: "image/gif" };
    }

    // linkedin - gif
    if (ua.includes("linkedin")) {
      return { url: `${BASE_URL}${UNFURL_PATHS.gif}`, type: "image/gif" };
    }

    // twitter, facebook, whatsapp - static
    if (
      ua.includes("twitterbot") ||
      ua.includes("facebookexternalhit") ||
      ua.includes("whatsapp")
    ) {
      imageUrl = `${BASE_URL}${UNFURL_PATHS.static}`;
      mimeType = "image/png";
    }

    // iMessage/iOS - static (video handled separately)
    if (
      ua.includes("iphone") ||
      ua.includes("ipad") ||
      (ua.includes("applewebkit") &&
        (ua.includes("mobile") ||
          (ua.includes("safari") && !ua.includes("chrome"))))
    ) {
      imageUrl = `${BASE_URL}${UNFURL_PATHS.static}`;
      mimeType = "image/png";
    }
  }

  return { url: imageUrl, type: mimeType };
}

export function isIMessageUserAgent(userAgent?: string): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    (ua.includes("applewebkit") &&
      (ua.includes("mobile") ||
        (ua.includes("safari") && !ua.includes("chrome"))))
  );
}
