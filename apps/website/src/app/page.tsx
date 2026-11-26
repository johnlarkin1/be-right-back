import { Landing } from "@/components/pages/landing";
import { ComingSoon } from "@/components/pages/coming-soon";
import { shouldShowHoldingPage } from "@/lib/feature-flags";
import { getDownloadCount } from "@/lib/downloads";

export default async function Home() {
  if (await shouldShowHoldingPage()) return <ComingSoon />;
  return <Landing downloadCount={await getDownloadCount()} />;
}
