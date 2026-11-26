"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { IntroSequence } from "@/components/landing/intro-sequence";
import { CursorSpotlight } from "@/components/landing/cursor-spotlight";
import { Download, Play } from "lucide-react";
import { Header } from "@/components/shared/header";
import { GhostMark } from "@/components/shared/ghost-mark";
import { SiteFooter } from "@/components/shared/site-footer";
import { PipelineList } from "@/components/landing/pipeline-list";
import { trackEvent } from "@/lib/analytics";

export function Landing({ downloadCount }: { downloadCount: number | null }) {
  const [showContent, setShowContent] = useState(false);
  const [skipIntro, setSkipIntro] = useState(false);

  // Check for reduced motion preference - sync with browser API on mount
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) {
      /* eslint-disable react-hooks/set-state-in-effect -- sync with browser prefers-reduced-motion API */
      setSkipIntro(true);
      setShowContent(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, []);

  return (
    <>
      <CursorSpotlight />
      <Header animate />
      <IntroSequence
        onComplete={() => setShowContent(true)}
        skipIntro={skipIntro}
        downloadCount={downloadCount}
      />

      <AnimatePresence>
        {showContent && (
          <motion.div
            className="relative z-30 min-h-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5 }}
          >
            <main className="bg-crt-bg">
              <ReadmeSection />
              <HighlightsSection />
              <FeaturesSection />
              <DemoSection />
              <TechnicalOverviewSection />
              <CtaSection />
            </main>
            <SiteFooter variant="full" />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const SECTION = "mx-auto w-full max-w-[1200px] px-5 md:px-8";
const PROMPT = "m-0 font-jetbrains text-[13px] text-crt-text md:text-sm";
const H2 = "m-0 font-inter text-[32px] font-semibold tracking-[-0.025em] text-text-primary md:text-[44px]";
const CARD = "rounded-[14px] border border-border-subtle bg-surface";
const INSET = "rounded-[10px] border border-[rgba(232,228,210,0.06)] bg-crt-bg";

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <p className={PROMPT}>
      <span className="text-crt-accent">$</span> {children}
    </p>
  );
}

function BlinkBlock() {
  return (
    <span
      aria-hidden="true"
      className="ml-1.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-crt-text motion-safe:animate-[cursor-blink_1s_steps(1)_infinite] md:h-4 md:w-2"
    />
  );
}

function ReadmeSection() {
  return (
    <section id="download" className="border-t border-border-subtle">
      <div className={`${SECTION} grid items-center gap-12 pt-12 pb-10 md:gap-16 md:pt-[104px] md:pb-24 lg:grid-cols-2`}>
        <div className="flex flex-col gap-5 md:gap-6">
          <p className={PROMPT}>
            <span className="text-crt-accent">$</span> cat README.md
            <BlinkBlock />
          </p>
          <h1 className="m-0 font-inter text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary md:text-[44px] md:leading-[1.12] md:tracking-[-0.025em]">
            Ask your iMessage history <span className="text-crt-accent">anything.</span>
          </h1>
          <p className="m-0 max-w-[520px] font-inter text-[17px] leading-relaxed text-text-primary md:text-[19px]">
            Be Right Back reads your Messages database, finds the patterns, and answers questions about your own conversations. Every model runs on your Apple chip.
          </p>
          <p className="m-0 max-w-[520px] font-inter text-[17px] leading-relaxed text-text-secondary md:text-[19px]">
            I started this in September 2025 on Phi-4. Then Qwen3 landed, then Qwen3.5. The Karpathy quote up top already feels dated, which says a lot about how fast this space moves. It&apos;s been a fun way to learn and grow as an engineer.
          </p>
          <div className="mt-1 flex flex-col gap-2.5 font-jetbrains md:mt-2 md:flex-row md:flex-wrap md:gap-3">
            <Link
              href="/download"
              className="inline-flex h-[52px] items-center justify-center gap-2.5 rounded-lg bg-crt-accent px-6 text-[15px] font-semibold text-[#09090b] transition-colors hover:bg-[#ffc233]"
              onClick={() => trackEvent("cta_clicked", { label: "download_page", location: "readme" })}
            >
              <Download className="h-[18px] w-[18px]" aria-hidden />
              Download for macOS
            </Link>
            <span className="text-center text-xs text-text-secondary md:hidden">Heads up, this is a Mac app.</span>
            <a
              href="https://github.com/johnlarkin1/be-right-back"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-[rgba(232,228,210,0.2)] px-[22px] text-[15px] text-text-primary transition-colors hover:border-crt-accent hover:text-crt-accent md:h-[52px]"
            >
              $ ./view_source
            </a>
          </div>
          <p className="m-0 text-center font-jetbrains text-xs text-text-secondary md:mt-1 md:text-left md:text-[13px]">
            macOS 14+ <span className="text-crt-accent">·</span> Apple Silicon <span className="text-crt-accent">·</span> free
          </p>
        </div>
        <CasperPreview />
      </div>
    </section>
  );
}

/** A static illustration of the Ask Casper tab. */
function CasperPreview() {
  return (
    <figure className="m-0 overflow-hidden rounded-[14px] border border-[rgba(232,228,210,0.1)] bg-surface shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
      <figcaption className="sr-only">An illustration of Ask Casper in the Be Right Back app.</figcaption>
      <div aria-hidden="true" className="hidden items-center gap-2 border-b border-border-subtle bg-surface-elevated px-4 py-3 md:flex">
        <span className="h-[11px] w-[11px] rounded-full bg-[#3a3f37]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#3a3f37]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#3a3f37]" />
        <span className="mr-[45px] flex-1 text-center font-vt323 text-lg text-crt-accent">&gt; Be Right Back</span>
      </div>
      <div aria-hidden="true" className="flex gap-1 border-b border-border-subtle px-3 py-2.5 font-vt323 text-[17px] md:gap-1.5 md:px-4 md:text-lg">
        <span className="px-2 py-0.5 text-text-secondary md:px-2.5">insights</span>
        <span className="rounded-md bg-crt-accent/10 px-2 py-0.5 text-crt-accent md:px-2.5">ask casper</span>
        <span className="px-2 py-0.5 text-text-secondary md:px-2.5">personas</span>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-3 p-4 font-jetbrains text-[12.5px] leading-[1.55] md:gap-3.5 md:p-5 md:text-[13.5px] md:leading-relaxed">
        <div className="max-w-[85%] self-end rounded-[10px] border border-crt-text/20 bg-crt-text/[0.08] px-3 py-2.5 text-crt-text md:max-w-[82%] md:px-3.5">
          &gt; what did we talk about last spring?
        </div>
        <div className="flex items-center gap-2 text-xs text-[#ff69b4]">
          <GhostMark size={16} color="#ff69b4" eyeColor="var(--surface)" />
          [CASPER]
          <span className="text-text-secondary md:hidden">◈ search_messages</span>
        </div>
        <div className="hidden rounded-lg border border-[rgba(232,228,210,0.1)] bg-crt-bg px-3 py-2.5 text-[12.5px] text-text-secondary md:block">
          <span className="text-crt-accent">◈ search_messages</span>  period: &quot;last spring&quot;
          <br />
          <span className="text-crt-accent">◈ get_topics</span>  range: Mar–May
        </div>
        <div className="max-w-[92%] rounded-[10px] border border-border-subtle bg-surface-elevated px-3 py-2.5 text-text-primary md:px-3.5">
          &lt; Mostly trip planning, a long thread about the new apartment, and the usual debate over where to get dinner.
        </div>
        <div className="mt-1 hidden items-center gap-2.5 rounded-lg border border-crt-accent/30 px-3 py-2.5 md:flex">
          <span className="flex-1 text-text-secondary">
            &gt; ask casper anything
            <span className="text-crt-accent motion-safe:animate-[cursor-blink_1s_steps(1)_infinite]">_</span>
          </span>
          <span className="text-crt-accent">[SEND]</span>
        </div>
      </div>
      <div className="flex justify-between gap-3 border-t border-border-subtle px-4 py-2.5 font-jetbrains text-[11px] text-text-secondary md:text-[11.5px]">
        <span>
          <span className="text-crt-text">[LOCK]</span> running locally
        </span>
        <span className="hidden md:inline">Qwen3.5-9B-4bit · MLX</span>
      </div>
    </figure>
  );
}

const HIGHLIGHTS = [
  {
    tag: "insights",
    body: "Get insights into your iMessage history and conversations. See analytics about texting patterns, clustering in 2D/3D space, and more.",
  },
  {
    tag: "on-device",
    body: "All processing happens on-device using your Apple chip.",
    aside: "Yeah... it's macOS only. There are good reasons for this too.",
  },
  {
    tag: "privacy-first",
    body: "No data ever leaves your device!",
    aside:
      "The only network connection you need is for the initial app download and then for downloading local models (respects your unified memory constraints).",
  },
];

function HighlightsSection() {
  return (
    <section aria-label="Privacy" className={`${SECTION} pt-10 md:pt-16`}>
      <div className="grid gap-px overflow-hidden rounded-[14px] border border-border-subtle bg-border-subtle md:grid-cols-3">
        {HIGHLIGHTS.map((h) => (
          <div key={h.tag} className="flex flex-col gap-1.5 bg-crt-bg p-5 md:gap-2.5 md:p-7">
            <span className="font-jetbrains text-[11px] tracking-[1px] text-crt-accent md:text-xs">▸ {h.tag}</span>
            <p className="m-0 font-inter text-[15px] leading-[1.55] text-text-primary md:text-base">{h.body}</p>
            {h.aside && (
              <p className="m-0 font-inter text-[13px] leading-[1.55] text-text-secondary md:text-sm">
                <span className="font-jetbrains text-crt-accent">-</span> {h.aside}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Deterministic heatmap shades, 26 weeks × 7 days. Mobile shows 18 weeks. */
const HEATMAP_SHADES = [
  "var(--surface-elevated)",
  "rgba(255,176,0,0.22)",
  "rgba(255,176,0,0.45)",
  "rgba(255,176,0,0.7)",
  "var(--crt-accent)",
];
const HEATMAP_CELLS = Array.from({ length: 182 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  const w = v * (0.6 + 0.4 * Math.sin((i % 26) / 4));
  const k = w < 0.25 ? 0 : w < 0.45 ? 1 : w < 0.62 ? 2 : w < 0.8 ? 3 : 4;
  return HEATMAP_SHADES[k];
});
const MOBILE_HEATMAP_CELLS = 18 * 7;

/** Deterministic you/them bar heights for the stats card. */
const STAT_BARS = Array.from({ length: 16 }, (_, j) => ({
  you: 20 + Math.round(Math.abs(Math.sin(j * 1.7)) * 30),
  them: 15 + Math.round(Math.abs(Math.cos(j * 1.3)) * 28),
}));

function FeatureCard({
  tag,
  tagClassName = "text-crt-accent",
  title,
  large = false,
  children,
  visual,
}: {
  tag: string;
  tagClassName?: string;
  title: string;
  large?: boolean;
  children: React.ReactNode;
  visual?: React.ReactNode;
}) {
  return (
    <article className={`${CARD} flex flex-col gap-2.5 p-[22px] transition-colors hover:border-crt-accent/30 md:gap-3.5 md:p-7`}>
      <span className={`font-jetbrains text-xs md:text-[13px] ${tagClassName}`}>{tag}</span>
      <h3
        className={`m-0 font-inter text-xl font-semibold tracking-[-0.015em] text-text-primary ${
          large ? "md:text-2xl" : "md:text-[22px]"
        }`}
      >
        {title}
      </h3>
      <p className="m-0 font-inter text-[15px] leading-relaxed text-text-secondary md:text-base">{children}</p>
      {visual}
    </article>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className={`${SECTION} scroll-mt-20 pt-[72px] md:pt-[120px]`}>
      <Prompt>./brb --features</Prompt>
      <h2 className={`${H2} mt-3 mb-6 md:mt-4 md:mb-12`}>What Can You Do?</h2>

      <div className="mb-3 grid gap-3 md:mb-4 md:gap-4 lg:grid-cols-2">
        <FeatureCard
          tag="[01] insights"
          title="Explore Your iMessage Analytics"
          large
          visual={
            <div
              aria-hidden="true"
              className={`${INSET} mt-1.5 grid grid-cols-[repeat(18,minmax(0,1fr))] gap-0.5 p-3 md:mt-2.5 md:grid-cols-[repeat(26,minmax(0,1fr))] md:gap-[3px] md:p-4`}
            >
              {HEATMAP_CELLS.map((bg, i) => (
                <span
                  key={i}
                  className={`aspect-square rounded-[2px] ${i >= MOBILE_HEATMAP_CELLS ? "max-md:hidden" : ""}`}
                  style={{ background: bg }}
                />
              ))}
            </div>
          }
        >
          Activity heatmaps (obvs GitHub inspired), message timelines, word clouds, and a 2D/3D map of your conversations clustered by topic.
        </FeatureCard>
        <FeatureCard
          tag="[02] ask casper"
          tagClassName="text-[#ff69b4]"
          title="Ask Your Messages Questions"
          large
          visual={
            <div aria-hidden="true" className={`${INSET} mt-2.5 hidden flex-col gap-2.5 p-4 font-jetbrains text-[13px] md:flex`}>
              <span className="self-end rounded-lg border border-crt-text/20 bg-crt-text/[0.08] px-3 py-2 text-crt-text">
                &gt; when is sam&apos;s birthday?
              </span>
              <span className="text-text-secondary">
                <span className="text-[#ff69b4]">[CASPER]</span> ◈ search_messages &quot;birthday sam&quot;
              </span>
              <span className="self-start rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-text-primary">
                &lt; You wished Sam happy birthday on June 14 three years running.
              </span>
            </div>
          }
        >
          Ask Casper (yeah I know, what a cliche) things like when a friend&apos;s birthday is or what you talked about last spring.
        </FeatureCard>
      </div>

      <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
        <FeatureCard
          tag="[03] stats"
          title="Dig Into Convo Stats"
          visual={
            <div className="mt-auto hidden flex-col gap-3.5 md:flex">
              <div aria-hidden="true" className={`${INSET} flex h-[84px] items-end gap-1 p-3`}>
                {STAT_BARS.map((b, i) => (
                  <span key={i} className="flex h-full flex-1 flex-col justify-end gap-0.5">
                    <span className="rounded-[2px] bg-[#00d4ff] opacity-80" style={{ height: `${b.them}%` }} />
                    <span className="rounded-[2px] bg-crt-text opacity-85" style={{ height: `${b.you}%` }} />
                  </span>
                ))}
              </div>
              <span className="font-jetbrains text-xs text-text-secondary">
                <span className="text-crt-text">■</span> you{"   "}
                <span className="text-[#00d4ff]">■</span> them
              </span>
            </div>
          }
        >
          Message counts, average response times, active days, and most-used words. Drag across the timeline to zoom in on any stretch of time.
        </FeatureCard>
        <FeatureCard
          tag="[04] digital you"
          title="Build a Digital Clone of Yourself"
          visual={
            <div aria-hidden="true" className={`${INSET} mt-auto flex flex-col gap-1.5 p-3 font-jetbrains text-xs md:gap-2 md:text-[12.5px]`}>
              <span className="text-crt-text">[USER] &gt; you around tonight?</span>
              <span className="text-crt-accent">[DIGITAL-YOU] &lt; ya, brb</span>
            </div>
          }
        >
          Fine-tune a model on your own sent messages, then chat with it to see how you text. Only yourself, though... Consent is prioritized and I don&apos;t have a smooth way to verify peers&apos; consent to create digital clones.
        </FeatureCard>
        <FeatureCard
          tag="[05] private"
          title="Complete Privacy & Security"
          visual={
            <ul className={`${INSET} mt-auto hidden list-none flex-col gap-1.5 p-3 font-jetbrains text-[12.5px] text-text-secondary md:flex`}>
              <li><span className="text-crt-text">[OK]</span> no cloud inference</li>
              <li><span className="text-crt-text">[OK]</span> no account</li>
              <li><span className="text-crt-text">[OK]</span> data lives in ~/.be-right-back</li>
            </ul>
          }
        >
          Everything runs locally on your Mac. Besides meaning it&apos;s private, it also means it&apos;s free. Won&apos;t matter in the post-ASI world / permanent underclass world, but still.
        </FeatureCard>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section id="demo" className={`${SECTION} scroll-mt-20 pt-[72px] md:pt-[120px]`}>
      <Prompt>./play_demo.sh</Prompt>
      <h2 className={`${H2} mt-3 mb-6 md:mt-4 md:mb-10`}>See It In Action</h2>
      <div className={`${CARD} flex aspect-[16/10] flex-col items-center justify-center gap-3 text-center md:aspect-video md:gap-4`}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-crt-accent/40 bg-crt-accent/[0.08] md:h-[72px] md:w-[72px]">
          <Play className="h-5 w-5 fill-crt-accent text-crt-accent md:h-[26px] md:w-[26px]" aria-hidden />
        </span>
        <p className="m-0 font-jetbrains text-sm text-text-primary md:text-base">Demo coming soon</p>
        <p className="m-0 hidden font-inter text-sm text-text-secondary md:block">
          Persona creation, conversation analysis, and local inference
        </p>
      </div>
    </section>
  );
}

const FLOW = [
  { label: "~/Library/Messages/chat.db", accent: true },
  { label: "chunks" },
  { label: "ModernBERT · 768-dim" },
  { label: "brb.duckdb", accent: true },
];

function TechnicalOverviewSection() {
  return (
    <section id="how" className={`${SECTION} pt-[72px] md:pt-[120px]`}>
      <Prompt>cat docs/how-it-works.txt</Prompt>
      <h2 className={`${H2} mt-3 mb-3 md:mt-4`}>Technical Overview</h2>
      <div className="mb-5 flex max-w-[760px] flex-col gap-4 font-inter text-[15px] leading-relaxed text-text-secondary md:mb-7 md:text-lg">
        <p className="m-0">
          The source of everything is the existing macOS iMessage database (
          <code className="font-jetbrains text-[0.9em] text-text-primary">~/Library/Messages/chat.db</code>
          ). I split, chunk, and embed with ModernBERT into a local DuckDB file. There are then ~three pipelines that build on top of that, all running on your Mac&apos;s GPU through Apple&apos;s MLX.
        </p>
        <p className="m-0 hidden md:block">
          The one thing to note is that I&apos;d recommend running through the{" "}
          <Link
            href="/how-its-built"
            className="font-jetbrains text-[0.9em] text-crt-accent underline underline-offset-4 hover:text-[#ffc94d]"
          >
            How It&apos;s Built
          </Link>{" "}
          blog / explainer. I spent a long time writing all that out and learning about all of those concepts. It&apos;s pretty fun and should be decently interactive and dynamic.
        </p>
      </div>
      <div className="mb-10 hidden flex-wrap items-center gap-2.5 font-jetbrains text-[13px] md:flex">
        {FLOW.map((step, i) => (
          <span key={step.label} className="contents">
            {i > 0 && <span className="text-crt-accent">-&gt;</span>}
            <span
              className={`rounded-md border border-[rgba(232,228,210,0.1)] bg-surface px-3 py-2 ${
                step.accent ? "text-crt-text" : "text-text-primary"
              }`}
            >
              {step.label}
            </span>
          </span>
        ))}
      </div>
      <PipelineList />
      <Link
        href="/how-its-built"
        className="mt-2 inline-flex min-h-11 items-center gap-2 font-jetbrains text-sm text-crt-accent hover:text-[#ffc94d] md:mt-6 md:text-[15px]"
      >
        Read How It&apos;s Built <span aria-hidden="true">-&gt;</span>
      </Link>
    </section>
  );
}

function CtaSection() {
  return (
    <section className={`${SECTION} pt-14 pb-16 md:py-[120px]`}>
      <div className="flex flex-col items-center gap-3.5 rounded-[14px] border border-crt-accent/30 bg-surface px-5 py-9 text-center md:gap-5 md:px-8 md:py-16">
        <div className="hidden gap-3.5 md:flex">
          <GhostMark size={30} eyeColor="var(--surface)" />
          <GhostMark size={30} color="#ff69b4" eyeColor="var(--surface)" />
          <GhostMark size={30} color="var(--crt-accent)" eyeColor="var(--surface)" />
        </div>
        <h2 className="m-0 font-jetbrains text-[22px] font-medium text-crt-text md:text-[28px]">
          <span className="text-crt-accent">$</span> ready to try it?
        </h2>
        <div className="flex w-full flex-col items-center gap-3 font-jetbrains text-[15px] md:mt-2 md:w-auto md:flex-row md:flex-wrap md:justify-center">
          <Link
            href="/download"
            className="inline-flex h-[52px] w-full items-center justify-center rounded-lg bg-crt-accent px-6 font-semibold text-[#09090b] transition-colors hover:bg-[#ffc233] md:w-auto"
            onClick={() => trackEvent("cta_clicked", { label: "download_page", location: "cta" })}
          >
            $ ./download
          </Link>
          <a
            href="https://github.com/johnlarkin1/be-right-back"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-[52px] items-center rounded-lg border border-[rgba(232,228,210,0.2)] px-[22px] text-text-primary transition-colors hover:border-crt-accent hover:text-crt-accent md:inline-flex"
          >
            $ ./view_source
          </a>
          <a
            href="mailto:john@berightback.xyz"
            className="inline-flex min-h-11 items-center rounded-lg text-sm text-text-secondary transition-colors hover:text-crt-accent md:h-[52px] md:border md:border-[rgba(232,228,210,0.1)] md:px-[22px] md:text-[15px] md:hover:border-crt-accent"
          >
            $ ./get_in_touch
          </a>
        </div>
      </div>
    </section>
  );
}
