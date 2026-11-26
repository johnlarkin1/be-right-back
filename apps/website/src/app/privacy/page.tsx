import { Metadata } from "next";
import { Header } from "@/components/shared/header";
import { SiteFooter } from "@/components/shared/site-footer";

export const metadata: Metadata = {
  title: "Privacy - Be Right Back",
  description:
    "Be Right Back keeps your messages on your Mac. What the app and this website collect, and how to delete it.",
};

const LAST_UPDATED = "November 26, 2026";
const CONTACT = "john@berightback.xyz";

const CARD = "rounded-[14px] border border-border-subtle bg-surface p-[22px] md:p-8";
const EYEBROW = "font-jetbrains text-[11px] tracking-[1px] text-crt-accent md:text-xs";
const H2 = "mt-1.5 mb-3 font-inter text-xl font-semibold text-text-primary md:mt-2 md:mb-4 md:text-[22px]";
const BODY = "flex flex-col gap-3 font-inter text-[15px] leading-relaxed text-text-secondary md:text-base";
const LIST = "flex list-disc flex-col gap-2 pl-5 marker:text-crt-accent";
const CODE = "font-jetbrains text-[13px] text-text-primary md:text-sm";

type Section = { id: string; eyebrow: string; title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    id: "app",
    eyebrow: "[THE APP]",
    title: "Your messages stay on your Mac",
    body: (
      <>
        <p>
          The app reads your iMessage database (<code className={CODE}>chat.db</code>) read-only. It
          copies what it needs to <code className={CODE}>~/.be-right-back/</code> on your Mac.
        </p>
        <p>
          Search, Insights, Casper, training, and chat all run on your Mac with Apple Silicon. Your
          messages, contacts, embeddings, and trained persona never leave it.
        </p>
        <ul className={LIST}>
          <li>No account or sign-in.</li>
          <li>No analytics, telemetry, or crash reports in the app.</li>
          <li>No server of ours receives anything from the app.</li>
        </ul>
      </>
    ),
  },
  {
    id: "downloads",
    eyebrow: "[DOWNLOADS]",
    title: "What the app downloads",
    body: (
      <>
        <p>On first run, and when you pick a new model, the app downloads:</p>
        <ul className={LIST}>
          <li>Python packages from PyPI (pypi.org).</li>
          <li>Language and embedding models from Hugging Face (huggingface.co).</li>
        </ul>
        <p>
          These requests send your IP address and a client version string to those services, like
          any download. They never include your messages. After the downloads, the app works
          offline.
        </p>
      </>
    ),
  },
  {
    id: "others",
    eyebrow: "[OTHER PEOPLE]",
    title: "The people you text",
    body: (
      <>
        <p>
          Your messages include other people. The app trains a persona of one person only: you, from
          the messages you sent. It has no way to train a persona of anyone else.
        </p>
        <p>
          Their messages appear in training only as the texts you replied to. Search and Insights
          read every conversation, but only to answer your questions about your own history.
        </p>
      </>
    ),
  },
  {
    id: "delete",
    eyebrow: "[DELETE]",
    title: "Deleting your data",
    body: (
      <ul className={LIST}>
        <li>
          To delete everything the app made, delete <code className={CODE}>~/.be-right-back/</code>.
        </li>
        <li>To uninstall, also move Be Right Back from Applications to the Trash.</li>
        <li>
          To stop the app reading your messages, turn it off in System Settings, Privacy &amp;
          Security, Full Disk Access.
        </li>
      </ul>
    ),
  },
  {
    id: "website",
    eyebrow: "[THIS WEBSITE]",
    title: "What this website collects",
    body: (
      <>
        <ul className={LIST}>
          <li>
            Vercel hosts the site. Its server logs record your IP address and browser for each
            request.
          </li>
          <li>
            PostHog measures page views and clicks on links and buttons. It stores an anonymous ID
            in a cookie and in local storage.
          </li>
          <li>The download button adds one to a download count. The count stores nothing about you.</li>
          <li>
            The homepage shares your pointer position with other visitors on the page, as a ghost.
            The server relays it live and does not store it.
          </li>
        </ul>
        <p>We do not sell data or show ads. To block analytics, use a content blocker.</p>
      </>
    ),
  },
  {
    id: "contact",
    eyebrow: "[CONTACT]",
    title: "Questions",
    body: (
      <p>
        Email{" "}
        <a href={`mailto:${CONTACT}`} className="text-crt-accent underline-offset-4 hover:underline">
          {CONTACT}
        </a>
        . If this page changes, the date at the top changes too.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <Header />

      <main className="min-h-screen bg-crt-bg pt-16">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-5 pt-10 pb-14 md:gap-6 md:px-8 md:pt-20 md:pb-[120px]">
          <div className="mb-2 flex flex-col gap-4 md:mb-6">
            <p className="font-jetbrains text-[13px] text-crt-text md:text-sm">
              <span className="text-crt-accent">$</span> cat PRIVACY.md
            </p>
            <h1 className="font-inter text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-text-primary md:text-[56px] md:leading-[1.05]">
              Privacy
            </h1>
            <p className="font-inter text-base leading-relaxed text-text-secondary md:text-[19px]">
              Be Right Back is local-first. Your messages stay on your Mac.
            </p>
            <p className="font-jetbrains text-xs text-text-secondary">Last updated {LAST_UPDATED}</p>
          </div>

          {SECTIONS.map((s) => (
            <section key={s.id} aria-labelledby={s.id} className={CARD}>
              <span className={EYEBROW}>{s.eyebrow}</span>
              <h2 id={s.id} className={H2}>
                {s.title}
              </h2>
              <div className={BODY}>{s.body}</div>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
