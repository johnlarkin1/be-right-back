import { after } from "next/server";
import { DMG_URL, recordDownload } from "@/lib/downloads";

// ponytail: counts every request, including bots and link prefetchers. Add UA
// filtering or per-IP dedupe if the number looks inflated.
export function GET() {
  after(recordDownload);
  return Response.redirect(DMG_URL, 302);
}
