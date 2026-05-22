// ============================================================
// Mise — Supplier input validation (Sprint 1 Part 5, Q5b)
// ============================================================
// Single zod schema for BOTH create and update of a supplier.
// This is the FIRST zod schema in the project — it sets the
// validation convention for Sprint 1-7 master-data forms.
// Lives in lib/ (not server/) because zod schemas are isomorphic:
// the Step 7 form can reuse this for client-side validation too.
//
// Rules (per grill decision Q5b, docs/sprint-progress.md):
//   - nameFull: required, trimmed, max 200
//   - other optional free-text: blank ("" / whitespace) -> null
//   - contactEmail: validated as email only when present
//   - contactPhone: loose (TH phone formats vary — no pattern)
//   - taxId: exactly 13 digits when present (TH tax id)
//   - rates: 0-100, max 2 decimals, nullable
//   - conditional (superRefine):
//       VAT-registered -> defaultVatRatePercent required
//       subject-to-WHT -> defaultWhtRatePercent required
//
// `code` uniqueness is NOT enforced here — it is a per-tenant DB
// partial unique index (prisma/manual/supplier_code_unique.sql); the
// logic layer (Step 5) maps Prisma P2002 -> Thai error (Q5a).
//
// Error messages are Thai (shown to the user); code is English.
// ============================================================

import { z } from "zod";

/**
 * A missing/blank field means "not provided" -> null.
 * Covers undefined (absent key), null, and "" / whitespace-only strings,
 * so optional fields normalize to null whether or not the key was sent.
 */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** Optional trimmed free-text: blank -> null, otherwise the trimmed string. */
const optionalText = z.preprocess(blankToNull, z.string().trim().nullable());

/** Optional percentage rate: 0-100, max 2 decimals, blank -> null. */
const optionalRate = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") return null;
      const n = Number(t);
      // Non-numeric string: keep as-is so z.number() raises a type error.
      return Number.isNaN(n) ? t : n;
    }
    return v;
  },
  z
    .number({ invalid_type_error: "อัตราต้องเป็นตัวเลข" })
    .min(0, "อัตราต้องไม่ต่ำกว่า 0")
    .max(100, "อัตราต้องไม่เกิน 100")
    .refine((n) => Number(n.toFixed(2)) === n, "อัตรามีทศนิยมได้ไม่เกิน 2 ตำแหน่ง")
    .nullable()
);

export const supplierInputSchema = z
  .object({
    code: optionalText,
    nameFull: z.preprocess(
      (v) => v ?? "",
      z
        .string()
        .trim()
        .min(1, "กรุณากรอกชื่อซัพพลายเออร์")
        .max(200, "ชื่อต้องไม่เกิน 200 ตัวอักษร")
    ),
    nameShort: optionalText,
    contactName: optionalText,
    contactPhone: optionalText,
    contactEmail: z.preprocess(
      blankToNull,
      z.string().trim().email("อีเมลไม่ถูกต้อง").nullable()
    ),
    lineId: optionalText,
    address: optionalText,
    taxId: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .regex(/^\d{13}$/, "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก")
        .nullable()
    ),
    paymentTerms: optionalText,
    isActive: z.boolean().default(true),
    isVatRegistered: z.boolean().default(false),
    defaultVatRatePercent: optionalRate,
    defaultSubjectToWht: z.boolean().default(false),
    defaultWhtRatePercent: optionalRate,
  })
  .superRefine((data, ctx) => {
    // VAT-registered supplier must declare its VAT rate (Q4 prefills 7.00).
    if (data.isVatRegistered && data.defaultVatRatePercent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultVatRatePercent"],
        message: "ร้านที่จด VAT ต้องระบุอัตรา VAT",
      });
    }
    // Subject-to-WHT supplier must declare its WHT rate (per service type).
    if (data.defaultSubjectToWht && data.defaultWhtRatePercent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultWhtRatePercent"],
        message: "ซัพพลายเออร์ที่หัก ณ ที่จ่าย ต้องระบุอัตรา WHT",
      });
    }
  });

/** Validated supplier input — output type consumed by *Logic (Step 5). */
export type SupplierInput = z.infer<typeof supplierInputSchema>;
