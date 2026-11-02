// ============================================================
// คิดครัว — the words of a problem report (ADR 0044)
// ============================================================
// A plain module (never "use client") so the reporter's form, their list, the
// platform tab and the e-mails all say the same thing (mise-ui-review §7).
//
// Two vocabularies for one status, on purpose (Kong 2026-11-03, mockup
// 2wtVT94pZjv1EX9xy8YVCp round 2): the operator reads the working words
// ("แก้แล้ว รอขึ้นเว็บ"), the shop reads plain ones ("แก้ไขแล้ว รอเปิดใช้") —
// "ขึ้นเว็บ" is our jargon, not theirs. And never "ทีมคิดครัว": there is no
// team to promise (no-unmeasured-promises).
// ============================================================

import { z } from "zod";

export const REPORT_KINDS = ["PROBLEM", "IDEA", "QUESTION"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_STATUSES = ["NEW", "LOOKING", "FIXED_PENDING", "FIXED_LIVE", "CONSIDERING", "CLOSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_MESSAGE_MAX = 4000;
export const REPORT_FILES_MAX = 3;

export const KIND_TH: Record<ReportKind, { label: string; sub: string; ask: string; example: string; hint: string }> = {
  PROBLEM: {
    label: "พบปัญหา",
    sub: "ใช้งานไม่ได้ หรือตัวเลขดูไม่ถูก",
    ask: "กำลังทำอะไรอยู่ และเกิดอะไรขึ้น",
    example: "เช่น กดยืนยันใบรับสินค้าแล้วหน้าค้าง ยอดไม่เข้าสต๊อก",
    hint: "เขียนสั้น ๆ ได้ · ถ้ารู้ว่าควรเป็นอย่างไร บอกมาด้วยได้",
  },
  IDEA: {
    label: "ข้อเสนอแนะ",
    sub: "อยากให้เพิ่มหรือปรับอะไร",
    ask: "อยากให้เพิ่มหรือปรับอะไร",
    example: "เช่น อยากให้ใบขอซื้อส่งเข้า LINE กลุ่มของร้านได้",
    hint: "เล่าด้วยได้ว่าตอนนี้ร้านทำเรื่องนี้อย่างไรอยู่",
  },
  QUESTION: {
    label: "สอบถามวิธีใช้",
    sub: "ไม่แน่ใจว่าต้องทำอย่างไร",
    ask: "อยากสอบถามเรื่องอะไร",
    example: "เช่น นับสต๊อกเปิดระบบ ต้องนับของแปรรูปด้วยไหม",
    hint: "ถามได้ทุกเรื่องเกี่ยวกับการใช้งาน",
  },
};

/** What the shop reads. */
export const STATUS_FOR_SHOP: Record<ReportStatus, string> = {
  NEW: "ได้รับเรื่องแล้ว",
  LOOKING: "กำลังตรวจสอบ",
  FIXED_PENDING: "แก้ไขแล้ว รอเปิดใช้",
  FIXED_LIVE: "แก้ไขเรียบร้อย",
  CONSIDERING: "รับไว้พิจารณา",
  CLOSED: "ปิดเรื่องแล้ว",
};

/** What the operator reads on the platform screens. */
export const STATUS_FOR_OPERATOR: Record<ReportStatus, string> = {
  NEW: "ใหม่",
  LOOKING: "กำลังดู",
  FIXED_PENDING: "แก้แล้ว รอขึ้นเว็บ",
  FIXED_LIVE: "ขึ้นเว็บแล้ว",
  CONSIDERING: "รับไว้พิจารณา",
  CLOSED: "ปิดเรื่อง",
};

/** R-0042 — the shop's own running number. */
export const reportNo = (n: number) => `R-${String(n).padStart(4, "0")}`;

/** "3 พ.ย. 69 · 14:32" (or without the time) — Bangkok time wherever the reader is. */
export function reportWhen(at: Date | string, withTime = true): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const day = d.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" });
  if (!withTime) return day;
  const time = d.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

/**
 * Open the report form from anywhere inside the app frame — the sidebar owns
 * the one form, so "แจ้งเรื่องใหม่" on /reports does not mount a second one.
 */
export const OPEN_REPORT_EVENT = "kitkrua:open-report";
export function openReportDialog(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_REPORT_EVENT));
}

const uuid = z.string().uuid();

/** What the form sends. Everything but the message is attached by the app. */
export const createReportSchema = z.object({
  kind: z.enum(REPORT_KINDS),
  message: z
    .string()
    .trim()
    .min(1, "กรุณาพิมพ์สิ่งที่อยากแจ้ง")
    .max(REPORT_MESSAGE_MAX, `ยาวได้ไม่เกิน ${REPORT_MESSAGE_MAX.toLocaleString("th-TH")} ตัวอักษร`),
  pagePath: z.string().trim().min(1).max(500),
  branchId: uuid.optional(),
  buildId: z.string().max(64).optional(),
  userAgent: z.string().max(500).optional(),
  viewport: z.string().max(40).optional(),
  errorDigest: z.string().max(64).optional(),
  fileIds: z.array(uuid).max(REPORT_FILES_MAX, `แนบรูปได้ไม่เกิน ${REPORT_FILES_MAX} รูป`).default([]),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

/** What the operator changes. */
export const updateReportSchema = z.object({
  id: uuid,
  status: z.enum(REPORT_STATUSES),
  reply: z.string().trim().max(REPORT_MESSAGE_MAX).optional(),
  internalNote: z.string().trim().max(REPORT_MESSAGE_MAX).optional(),
});
export type UpdateReportInput = z.infer<typeof updateReportSchema>;

/** "iPhone · Safari" from a user agent — enough to reproduce, nothing more. */
export function deviceOf(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "อื่น ๆ";
  const browser = /Edg\//.test(ua) ? "Edge" : /LINE\//.test(ua) ? "LINE" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "เบราว์เซอร์อื่น";
  return `${os} · ${browser}`;
}
