import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";

export const DMG_URL =
  "https://github.com/johnlarkin1/be-right-back/releases/latest/download/BeRightBack.dmg";

const COUNTER = "dmg_downloads";

/** Adds one download. Never throws: a database outage must not block the download. */
export async function recordDownload(): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO counters (name, value) VALUES (${COUNTER}, 1)
      ON CONFLICT (name) DO UPDATE SET value = counters.value + 1`;
  } catch (err) {
    console.error("recordDownload failed", err);
  }
}

async function readDownloadCount(): Promise<number | null> {
  const sql = getDb();
  if (!sql) return null;
  try {
    const rows = await sql`SELECT value FROM counters WHERE name = ${COUNTER}`;
    return rows.length ? Number(rows[0].value) : 0;
  } catch {
    return null;
  }
}

// ponytail: 60s cache, so the shown count lags. Drop it if live counts matter.
export const getDownloadCount = unstable_cache(readDownloadCount, [COUNTER], {
  revalidate: 60,
});
