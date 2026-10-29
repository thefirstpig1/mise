// ============================================================
// คิดครัว — upload a bill photo or a slip (ADR 0037 Q5–Q6)
// ============================================================
// POST multipart: file (required), thumb (a small JPEG the phone made, for
// images), kind = BILL | PAYMENT_SLIP | REFUND_SLIP.
//
// A route, not a Server Action: an action's body is capped at 1 MB and a
// phone photo is 2–6 MB. The full original is kept (Kong: the accountant
// files it), up to MAX_FILE_BYTES.
//
// Who may upload which kind:
//   BILL, PAYMENT_SLIP — purchase:self (your own purchase) or expense:write
//   REFUND_SLIP        — refund:pay
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { ALLOWED_CONTENT_TYPES, MAX_FILE_BYTES, StorageNotConfiguredError, storageReady } from "@/lib/storage";
import { recordUploadLogic } from "@/server/stored-file";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (formError: string, status = 400) => json({ ok: false, formError }, status);

const KINDS = ["BILL", "PAYMENT_SLIP", "REFUND_SLIP"] as const;
type Kind = (typeof KINDS)[number];
const MAX_THUMB_BYTES = 512 * 1024;

export async function POST(req: Request) {
  const { tenantId, user, can } = await requireTenant("any:member");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse("อัปโหลดไม่สำเร็จ กรุณาลองใหม่");
  }
  const kind = form.get("kind");
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return refuse("คำขอไม่ถูกต้อง");
  const allowed = kind === "REFUND_SLIP" ? can("refund:pay") : can("purchase:self") || can("expense:write");
  if (!allowed) return refuse("บัญชีนี้ไม่มีสิทธิ์แนบรูปประเภทนี้", 403);

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return refuse("ไม่พบไฟล์รูป");
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) return refuse("รองรับเฉพาะรูปภาพ (JPG, PNG, HEIC) และ PDF");
  if (file.size > MAX_FILE_BYTES) return refuse(`ไฟล์ใหญ่เกิน ${MAX_FILE_BYTES / 1024 / 1024} MB`);

  const thumbField = form.get("thumb");
  const thumb =
    thumbField instanceof File && thumbField.size > 0 && thumbField.size <= MAX_THUMB_BYTES && thumbField.type === "image/jpeg"
      ? new Uint8Array(await thumbField.arrayBuffer())
      : null;

  if (!storageReady()) return refuse("ระบบเก็บรูปยังไม่พร้อม กรุณาแจ้งทีมคิดครัว", 503);
  try {
    const result = await recordUploadLogic(tenantId, user.id!, {
      kind: kind as Kind,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      thumb,
      originalName: file.name || null,
    });
    return json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) return refuse("ระบบเก็บรูปยังไม่พร้อม กรุณาแจ้งทีมคิดครัว", 503);
    console.error("[files] upload failed", e);
    return refuse("อัปโหลดไม่สำเร็จ กรุณาลองใหม่", 500);
  }
}
