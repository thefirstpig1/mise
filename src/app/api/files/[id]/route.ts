// ============================================================
// คิดครัว — read one bill photo or slip (ADR 0037 Q5–Q6)
// ============================================================
// GET /api/files/<id>            the full original, shown in the browser
// GET /api/files/<id>?thumb=1    the small copy (falls back to the original)
// GET /api/files/<id>?download=1 the full original as a download — Kong: the
//                                accountant keeps the whole photo, not a preview
//
// The bucket is private; this is the only way out, and stored-file.ts decides
// who may see what. Someone who may not gets 404, not 403 — a 403 would
// confirm the id exists.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { getObject, thumbKeyOf } from "@/lib/storage";
import { getReadableFileLogic } from "@/server/stored-file";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
const KIND_TH = { BILL: "บิล", PAYMENT_SLIP: "สลิป", REFUND_SLIP: "สลิปคืนเงิน" } as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("not found", { status: 404 });
  const { tenantId, user, reach, can } = await requireTenant("any:member");
  const file = await getReadableFileLogic(tenantId, id, {
    userId: user.id!,
    reach,
    seesSpending: can("expense:view") || can("refund:pay"),
  });
  if (!file) return new Response("not found", { status: 404 });

  const url = new URL(req.url);
  const wantThumb = url.searchParams.get("thumb") === "1" && file.contentType.startsWith("image/");
  const thumb = wantThumb ? await getObject(thumbKeyOf(file.storageKey)) : null;
  const bytes = thumb ?? (await getObject(file.storageKey));
  if (!bytes) return new Response("not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": thumb ? "image/jpeg" : file.contentType,
    "Content-Length": String(bytes.byteLength),
    // Private to this browser; a photo never changes once stored.
    "Cache-Control": "private, max-age=86400, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (url.searchParams.get("download") === "1") {
    const name = `${KIND_TH[file.kind]}-${file.createdAt.toISOString().slice(0, 10)}-${id.slice(0, 8)}.${EXT[file.contentType] ?? "bin"}`;
    headers["Content-Disposition"] = `attachment; filename="${id.slice(0, 8)}.${EXT[file.contentType] ?? "bin"}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }
  return new Response(new Uint8Array(bytes), { headers });
}
