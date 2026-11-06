// ============================================================
// คิดครัว — หน้าควบคุม part B: requests, closing, announcements, answers
// ============================================================
// The words and the input rules of ADR 0045 part B, shared by the platform
// screens, their actions and the tests. A plain module — no database.
// ============================================================

import { z } from "zod";

// ---------- data requests (Q8, privacy draft §8, terms §10) ----------

export const REQUEST_KINDS = ["export", "delete", "personal"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_LABEL: Record<RequestKind, { title: string; short: string }> = {
  export: { title: "ขอข้อมูลร้านคืน", short: "ขอข้อมูลคืน" },
  delete: { title: "ขอลบข้อมูลร้าน", short: "ขอลบข้อมูล" },
  personal: { title: "ขอดู แก้ หรือลบข้อมูลของตัวเอง", short: "ข้อมูลของตัวเอง" },
};

/** Every kind is answered within 30 days of the request (terms §10, privacy §8). */
export const REQUEST_DAYS = 30;

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** YYYY-MM-DD + 30 days. */
export function requestDue(requestedOn: string): string {
  return ymd(new Date(Date.parse(`${requestedOn}T00:00:00Z`) + REQUEST_DAYS * DAY));
}

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "เลือกวันที่")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "วันที่ไม่ถูกต้อง");

export const recordRequestSchema = z
  .object({
    kind: z.enum(REQUEST_KINDS),
    shopId: z.string().uuid().nullable(),
    requester: z.string().trim().min(1, "กรอกว่าใครเป็นคนขอ").max(200, "ยาวเกิน 200 ตัวอักษร"),
    requestedOn: isoDay,
    note: z.string().trim().max(500, "ยาวเกิน 500 ตัวอักษร").nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "personal" && !v.shopId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["shopId"], message: "เลือกร้านที่ขอ" });
  });
export type RecordRequestInput = z.infer<typeof recordRequestSchema>;

// ---------- closing and erasing a shop (Q10) ----------

/** Days between closing a shop and the day it may be erased. */
export const PURGE_AFTER_DAYS = 30;

export function purgeDate(closedOn: string): string {
  return ymd(new Date(Date.parse(`${closedOn}T00:00:00Z`) + PURGE_AFTER_DAYS * DAY));
}

/** The shop's name, typed to confirm — spaces at the ends do not count, case does not matter for Latin letters. */
export function nameConfirmed(typed: string, name: string): boolean {
  return typed.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase();
}

export const shopConfirmSchema = z.object({ tenantId: z.string().uuid(), confirmName: z.string() });

// ---------- owner e-mail ----------

export const changeEmailSchema = z.object({
  userId: z.string().min(1),
  newEmail: z.string().trim().toLowerCase().email("อีเมลไม่ถูกต้อง").max(200),
});

// ---------- announcements ----------

export const ANNOUNCE_TONES = ["info", "important"] as const;
export const announceSchema = z
  .object({
    message: z.string().trim().min(1, "พิมพ์ข้อความ").max(300, "ยาวเกิน 300 ตัวอักษร"),
    tone: z.enum(ANNOUNCE_TONES),
    startsAt: z.string().min(1, "เลือกเวลาเริ่ม"),
    endsAt: z.string().min(1, "เลือกเวลาหยุด"),
  })
  .superRefine((v, ctx) => {
    const s = Date.parse(v.startsAt);
    const e = Date.parse(v.endsAt);
    if (Number.isNaN(s)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startsAt"], message: "เวลาเริ่มไม่ถูกต้อง" });
    if (Number.isNaN(e)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "เวลาหยุดไม่ถูกต้อง" });
    if (!Number.isNaN(s) && !Number.isNaN(e) && e <= s) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "เวลาหยุดต้องหลังเวลาเริ่ม" });
  });

// ---------- the setup card's three questions (Q14) ----------

export const SHOP_TYPES = ["อาหารตามสั่ง", "ร้านอาหารนั่งทาน", "คาเฟ่ / เครื่องดื่ม", "บุฟเฟต์ / ชาบู", "เบเกอรี่", "อื่น ๆ"] as const;
export const HEARD_FROM = ["เพื่อนแนะนำ", "Facebook", "Google", "LINE", "TikTok", "อื่น ๆ"] as const;
export const PROVINCES = [
  "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร", "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท",
  "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง", "ตราด", "ตาก", "นครนายก", "นครปฐม", "นครพนม",
  "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี", "นราธิวาส", "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์",
  "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา", "พังงา", "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์",
  "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน", "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง",
  "ราชบุรี", "ลพบุรี", "ลำปาง", "ลำพูน", "เลย", "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
  "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี", "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย",
  "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์", "อุทัยธานี", "อุบลราชธานี",
] as const;

const optionalOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(values).nullable());

export const shopAnswersSchema = z.object({
  shopType: optionalOf(SHOP_TYPES),
  province: optionalOf(PROVINCES),
  heardFrom: optionalOf(HEARD_FROM),
});
export type ShopAnswers = z.infer<typeof shopAnswersSchema>;
