// ============================================================
// คิดครัว — send a bill photo or slip from the phone (ADR 0037 Q5–Q6)
// ============================================================
// The full photo goes up as taken — the accountant keeps it (Kong 2026-10-29)
// — and the phone also makes a small copy for lists, because a 4 MB photo per
// row of a list over a shop's 4G is the slow screen nobody forgives. A PDF, or
// a photo the browser cannot draw (HEIC on Chrome), simply has no small copy;
// the server then serves the original for both.
// ============================================================

export type PhotoKind = "BILL" | "PAYMENT_SLIP" | "REFUND_SLIP";

export type UploadResult =
  | {
      ok: true;
      file: { id: string; kind: PhotoKind; contentType: string; byteSize: number };
      duplicates: { expenseId: string; billDate: string; total: number; who: string | null }[];
    }
  | { ok: false; formError: string };

const THUMB_EDGE = 480;

async function smallCopy(file: File): Promise<Blob | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72));
  } catch {
    return null;
  }
}

export async function uploadPhoto(file: File, kind: PhotoKind): Promise<UploadResult> {
  const body = new FormData();
  body.set("kind", kind);
  body.set("file", file);
  const thumb = await smallCopy(file);
  if (thumb) body.set("thumb", thumb, "thumb.jpg");
  try {
    const res = await fetch("/api/files", { method: "POST", body });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) return { ok: false, formError: "หมดเวลาเข้าสู่ระบบ กรุณารีเฟรชหน้า" };
    return (await res.json()) as UploadResult;
  } catch {
    return { ok: false, formError: "อัปโหลดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" };
  }
}

/** Where a stored photo is read from — never a bucket URL (the bucket is private). */
export const fileUrl = (id: string, opts: { thumb?: boolean; download?: boolean } = {}) =>
  `/api/files/${id}${opts.thumb ? "?thumb=1" : opts.download ? "?download=1" : ""}`;
