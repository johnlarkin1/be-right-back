"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Header } from "@/components/shared/header";
import { GhostMark } from "@/components/shared/ghost-mark";
import { SiteFooter } from "@/components/shared/site-footer";
import { CursorSpotlight } from "@/components/landing/cursor-spotlight";
import { trackEvent } from "@/lib/analytics";

const DMG_PATH = "/download/dmg";

const REQUIREMENTS = [
  { label: "OS", value: "macOS 14.0 (Sonoma) or later", short: "macOS 14 or later" },
  { label: "Chip", value: "Apple Silicon (M1/M2/M3/M4)", short: "Apple Silicon" },
  {
    label: "RAM",
    value: "8GB minimum, 16GB recommended, 48GB would be lovely",
    short: "8GB min, 16GB rec., 48GB lovely",
  },
  { label: "Storage", value: "5GB+ available space", short: "5GB+ available" },
  { label: "Permission", value: "Full Disk Access required", short: "Full Disk Access" },
  { label: "Network", value: "For initial download only", short: "Initial download only" },
];

/** Mirrors `crates/common/src/model_tiers.rs`. Bar width is relative model size. */
const MODEL_TIERS = [
  { mem: "24GB+", model: "9B", width: "100%", opacity: 1 },
  { mem: "16GB+", model: "4B", width: "70%", opacity: 0.8 },
  { mem: "12GB+", model: "2B", width: "45%", opacity: 0.65 },
  { mem: "under 12GB", model: "0.8B", width: "22%", opacity: 0.5 },
];

const STEPS: { text: string; hint?: string }[] = [
  { text: "Download the .dmg file" },
  { text: "Open the downloaded file and drag Be Right Back to Applications" },
  { text: "Launch the app from Applications folder" },
  {
    text: "Grant Full Disk Access in System Settings",
    hint: "System Settings -> Privacy & Security -> Full Disk Access",
  },
  { text: "Start exploring your messages and creating AI personas" },
];

const CARD = "rounded-[14px] border border-border-subtle bg-surface p-[22px] md:p-8";
const EYEBROW = "font-jetbrains text-[11px] tracking-[1px] text-crt-accent md:text-xs";
const H2 = "font-inter text-xl font-semibold text-text-primary md:text-[22px]";
const ROW = "border-t border-border-subtle py-2.5 md:py-3";

export default function DownloadClient() {
  return (
    <>
      <CursorSpotlight />
      <Header />

      <main className="min-h-screen bg-crt-bg pt-16">
        <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-4 px-5 pt-10 pb-14 md:gap-6 md:px-8 md:pt-20 md:pb-[120px]">
          <div className="mb-2 flex flex-col gap-4 md:mb-6">
            <p className="font-jetbrains text-[13px] text-crt-text md:text-sm">
              <span className="text-crt-accent">$</span> cat downloads/README.md
            </p>
            <h1 className="font-inter text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-text-primary md:text-[56px] md:leading-[1.05]">
              Download Be Right Back
            </h1>
            <p className="max-w-[640px] font-inter text-base leading-relaxed text-text-secondary md:text-[19px]">
              Be Right Back requires macOS with Apple Silicon (M1/M2/M3/M4) and at least 8GB of RAM.
            </p>
          </div>

          <ReleaseCard />

          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <section aria-labelledby="req" className={CARD}>
              <span className={EYEBROW}>[SYSTEM REQUIREMENTS]</span>
              <h2 id="req" className={`${H2} mt-1.5 mb-3.5 md:mt-2 md:mb-5`}>
                System Requirements
              </h2>
              <dl className="grid grid-cols-[96px_minmax(0,1fr)] font-jetbrains text-[13px] md:grid-cols-[120px_minmax(0,1fr)] md:text-sm">
                {REQUIREMENTS.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className={`${ROW} text-crt-accent`}>{r.label}</dt>
                    <dd className={`${ROW} text-text-primary`}>
                      <span className="hidden md:inline">{r.value}</span>
                      <span className="md:hidden">{r.short}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="tiers" className={CARD}>
              <span className={EYEBROW}>[MODEL SIZE]</span>
              <h2 id="tiers" className={`${H2} mt-1.5 mb-2 md:mt-2`}>
                Which Model You Get
              </h2>
              <p className="mb-4 font-inter text-sm leading-relaxed text-text-secondary md:mb-5 md:text-[15px]">
                Picks the 0.8B, 2B, 4B, or 9B Qwen3.5 model to fit your unified memory.
              </p>
              <ul className="flex flex-col gap-2.5">
                {MODEL_TIERS.map((t) => (
                  <li
                    key={t.model}
                    className="grid grid-cols-[88px_minmax(0,1fr)_40px] items-center gap-2.5 font-jetbrains text-xs md:grid-cols-[96px_minmax(0,1fr)_64px] md:gap-3.5 md:text-[13px]"
                  >
                    <span className="text-text-primary">{t.mem}</span>
                    <span
                      aria-hidden="true"
                      className="h-2 overflow-hidden rounded-[3px] border border-border-subtle bg-crt-bg md:h-2.5"
                    >
                      <span
                        className="block h-full bg-crt-accent"
                        style={{ width: t.width, opacity: t.opacity }}
                      />
                    </span>
                    <span className="text-right text-crt-accent">{t.model}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 hidden font-jetbrains text-xs text-text-secondary md:block">
                4-bit across the board, running through MLX.
              </p>
            </section>
          </div>

          <section aria-labelledby="install" className={CARD}>
            <span className={EYEBROW}>[INSTALLATION]</span>
            <h2 id="install" className={`${H2} mt-1.5 mb-4 md:mt-2 md:mb-7`}>
              Installation Steps
            </h2>
            <ol className="grid list-none gap-0 md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] md:gap-4">
              {STEPS.map((step, i) => (
                <li
                  key={step.text}
                  className={`flex gap-3.5 font-inter text-[15px] leading-normal text-text-primary md:flex-col md:gap-2.5 md:rounded-[10px] md:border md:p-[18px] ${
                    step.hint
                      ? "-mx-3.5 my-1 rounded-[10px] border border-crt-accent/40 bg-crt-accent/[0.06] p-3.5 md:mx-0 md:my-0"
                      : "border-t border-border-subtle py-3 md:border-border-subtle md:bg-crt-bg"
                  }`}
                >
                  <span className="font-jetbrains text-[13px] leading-6 text-crt-accent md:leading-normal">
                    [{i + 1}]
                  </span>
                  <span className="flex flex-col gap-1.5 md:gap-2.5">
                    {step.text}
                    {step.hint && (
                      <span className="font-jetbrains text-[11.5px] leading-normal text-text-secondary">
                        {step.hint}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="privacy"
            className="flex flex-col gap-3 rounded-[14px] border border-crt-text/20 bg-crt-text/[0.03] p-[22px] md:flex-row md:flex-wrap md:gap-x-12 md:gap-y-6 md:p-8"
          >
            <div className="flex flex-col gap-2 md:flex-[1_1_260px]">
              <span className="font-jetbrains text-[11px] tracking-[1px] text-crt-text md:text-xs">[PRIVACY NOTICE]</span>
              <h2 id="privacy" className={H2}>
                Privacy Notice
              </h2>
            </div>
            <ul className="flex list-none flex-col gap-2.5 font-inter text-sm leading-relaxed text-crt-body md:flex-[2_1_420px] md:gap-3 md:text-[15px]">
              <li>
                <span className="font-jetbrains text-crt-text">&gt;</span> Be Right Back processes{" "}
                <strong className="text-text-primary">all data locally</strong> on your device. Your messages never leave
                your Mac.
              </li>
              <li>
                <span className="font-jetbrains text-crt-text">&gt;</span> The app requires Full Disk Access to read the
                Messages database, but <strong className="text-text-primary">no data is sent to external servers</strong>.
              </li>
              <li>
                <span className="font-jetbrains text-crt-text">&gt;</span> Network access is only needed for initial model
                downloads from Hugging Face.
              </li>
            </ul>
          </section>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

function ReleaseCard() {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    trackEvent("cta_clicked", { label: "copy_download_link", location: "download_page" });
    try {
      await navigator.clipboard.writeText(new URL(DMG_PATH, window.location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied. The plain link below still works.
    }
  };

  return (
    <section
      aria-labelledby="release"
      className="flex flex-col gap-3.5 rounded-[14px] border border-crt-accent/35 bg-surface p-[22px] md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-7 md:p-9"
    >
      <div className="flex min-w-0 items-center gap-5">
        <span className="hidden h-[72px] w-[72px] flex-none items-center justify-center rounded-2xl border border-[rgba(232,228,210,0.1)] bg-crt-bg md:flex">
          <GhostMark size={38} />
        </span>
        <div className="flex flex-col gap-1.5">
          <span className={EYEBROW}>[LATEST RELEASE]</span>
          <h2 id="release" className="font-inter text-[22px] font-semibold tracking-[-0.015em] text-text-primary md:text-[26px]">
            macOS Application
          </h2>
          <p className="font-jetbrains text-xs text-text-secondary md:text-[13px]">Signed and notarized for macOS.</p>
        </div>
      </div>

      {/* Phone: the app is Mac only, so offer the link to send to a Mac */}
      <div className="flex flex-col gap-3.5 md:hidden">
        <div className="rounded-lg border border-crt-text/20 bg-crt-text/[0.04] px-3.5 py-3 font-inter text-sm leading-normal text-crt-body">
          <span className="font-jetbrains text-crt-text">&gt;</span> Heads up, this is a Mac app. Grab the link and open
          it on your Mac.
        </div>
        <button
          type="button"
          onClick={copyLink}
          className="h-[52px] rounded-lg bg-crt-accent font-jetbrains text-[15px] font-semibold text-[#09090b]"
        >
          {copied ? "Link copied" : "Copy download link"}
        </button>
        <a
          href={DMG_PATH}
          className="flex min-h-11 items-center justify-center font-jetbrains text-[13px] text-crt-accent"
          onClick={() => trackEvent("cta_clicked", { label: "download_dmg", location: "download_page" })}
        >
          $ ./download BeRightBack.dmg
        </a>
      </div>

      <div className="hidden flex-col items-end gap-2.5 md:flex">
        <a
          href={DMG_PATH}
          className="inline-flex h-14 items-center gap-2.5 rounded-lg bg-crt-accent px-7 font-jetbrains text-[15px] font-semibold text-[#09090b] transition-colors hover:bg-[#ffc233]"
          onClick={() => trackEvent("cta_clicked", { label: "download_dmg", location: "download_page" })}
        >
          <Download className="h-[18px] w-[18px]" aria-hidden />
          ./download BeRightBack.dmg
        </a>
        <a
          href="https://github.com/johnlarkin1/be-right-back/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="font-jetbrains text-[13px] text-crt-accent hover:text-[#ffc94d]"
          onClick={() => trackEvent("cta_clicked", { label: "github_release", location: "download_page" })}
        >
          View release notes on GitHub
        </a>
      </div>
    </section>
  );
}
