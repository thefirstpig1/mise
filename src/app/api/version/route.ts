// The build the server is running — compared by VersionBanner with the build
// the open tab came from (src/lib/stale-tab.ts). Public on purpose: it says
// nothing but an opaque id, and a signed-out tab is stale too.

import { CLIENT_BUILD_ID } from "@/lib/stale-tab";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ id: CLIENT_BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
