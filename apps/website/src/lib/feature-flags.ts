import { unstable_cache } from "next/cache";
import { PostHog } from "posthog-node";

let client: PostHog | undefined;

async function resolveHoldingPage(): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return false;

  client ??= new PostHog(apiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    enableLocalEvaluation: false,
  });

  try {
    const enabled = await client.isFeatureEnabled(
      "website-holding-page",
      "website-anonymous",
      { sendFeatureFlagEvents: false },
    );
    return enabled ?? false;
  } catch {
    return false;
  }
}

export const shouldShowHoldingPage = unstable_cache(
  resolveHoldingPage,
  ["website-holding-page"],
  { revalidate: 30 },
);
