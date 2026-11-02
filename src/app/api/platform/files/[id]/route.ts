// ADR 0044 — a problem report's screenshot, for the operator's inbox. Report
// screenshots only (getReportScreenshotLogic); not an admin → 404, like the pages.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { getObject, thumbKeyOf } from "@/lib/storage";
import { getReportScreenshotLogic } from "@/server/platform";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("not found", { status: 404 });
  const actor = await requirePlatformAdmin();
  const file = await getReportScreenshotLogic(actor, id);
  if (!file) return new Response("not found", { status: 404 });

  const wantThumb = new URL(req.url).searchParams.get("thumb") === "1" && file.contentType.startsWith("image/");
  const thumb = wantThumb ? await getObject(thumbKeyOf(file.storageKey)) : null;
  const bytes = thumb ?? (await getObject(file.storageKey));
  if (!bytes) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": thumb ? "image/jpeg" : file.contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
