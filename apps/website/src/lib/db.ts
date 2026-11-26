import { neon } from "@neondatabase/serverless";

/** Returns null when DATABASE_URL is unset, so local dev works without a database. */
export function getDb() {
  const url = process.env.DATABASE_URL;
  return url ? neon(url) : null;
}
