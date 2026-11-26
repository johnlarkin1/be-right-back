import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { PostHogProvider } from "@/components/posthog-provider";
import { TerminalShell } from "@/components/terminal/terminal-shell";
import { SearchProvider } from "@/components/search/search-provider";
import { getPlatformSpecificImage, isIMessageUserAgent } from "./metadata";

// Fonts are self-hosted (latin subset, from Google Fonts, all SIL OFL 1.1).
// next/font/google downloads them during the build, and Turbopack fails the
// whole build when that download fails on the build machine.
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
});

const vt323 = localFont({
  src: "./fonts/vt323-latin.woff2",
  weight: "400",
  variable: "--font-vt323",
});

const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-latin-600.woff2", weight: "600" },
  ],
  variable: "--font-ibm-plex-mono",
});

// Modern-retro hybrid fonts
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  weight: "100 800",
  variable: "--font-jetbrains-mono",
});

const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
});

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://berightback.xyz";

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const userAgent = headersList.get("user-agent") || "";
  const image = getPlatformSpecificImage(userAgent);
  const isIMessage = isIMessageUserAgent(userAgent);

  return {
    metadataBase: new URL(BASE_URL),
    title: "Be Right Back",
    description:
      "A local-first macOS app that creates AI personas from your iMessage history. All processing on-device with Apple Silicon.",
    openGraph: {
      title: "Be Right Back",
      description:
        "Search and analyze your iMessage history. Everything stays on your Mac.",
      url: BASE_URL,
      siteName: "Be Right Back",
      images: [
        {
          url: image.url,
          width: 1200,
          height: 630,
          alt: "Be Right Back",
          type: image.type,
        },
      ],
      locale: "en_US",
      type: isIMessage ? "video.other" : "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Be Right Back",
      description:
        "A local-first macOS app that creates AI personas from your iMessage history. All processing on-device with Apple Silicon.",
      images: [`${BASE_URL}/unfurls/main-static.png`],
      creator: "@johnlarkin1",
    },
    other: {
      // imessage - mp4
      ...(isIMessage
        ? {
            "og:video": `${BASE_URL}/unfurls/main.mp4`,
            "og:video:secure_url": `${BASE_URL}/unfurls/main.mp4`,
            "og:video:type": "video/mp4",
            "og:video:width": "1200",
            "og:video:height": "630",
          }
        : {}),
      // discord - gif
      ...(userAgent.includes("discord") || userAgent.includes("Discord")
        ? {
            "og:video": `${BASE_URL}/unfurls/main.gif`,
            "og:video:type": "image/gif",
            "og:video:width": "1200",
            "og:video:height": "630",
            "og:video:secure_url": `${BASE_URL}/unfurls/main.gif`,
          }
        : {}),
      // linkedin - gif
      "linkedin:image": `${BASE_URL}/unfurls/main.gif`,
      "linkedin:image:type": "image/gif",
      "linkedin:image:width": "1200",
      "linkedin:image:height": "630",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${vt323.variable} ${ibmPlexMono.variable} ${jetbrainsMono.variable} ${inter.variable} antialiased`}
      >
        <PostHogProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <SearchProvider>
              <TerminalShell>
                {children}
              </TerminalShell>
            </SearchProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
