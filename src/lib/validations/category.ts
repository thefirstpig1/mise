// ============================================================
// Mise — Category input validation (Sprint 1 Part 6)
// ============================================================
// Single zod schema for create + update of a category, mirroring the
// supplier slice. The 3-tier model (CONTEXT.md): account (COGS/OpEx) →
// accountingSection (free text) → groupName (free text).
//
// `account` is a fixed 2-value set — the only two accounting buckets in Mise
// (see the default seed in src/server/tenant-init.ts). ACCOUNT_VALUES is the
// SINGLE SOURCE OF TRUTH: the zod enum AND the form <select> both read it.
//
// Uniqueness of (tenantId, account, accountingSection, groupName) is a Prisma
// @@unique enforced in the DB; the logic layer maps P2002 → Thai error. Unlike
// supplier's partial index, this full unique also counts soft-deleted rows
// (see the note in src/server/category.ts).
//
// Error messages are Thai (shown to user); code is English.
// ============================================================

import { z } from "zod";

/** The two accounting buckets in Mise — single source for zod + the form. */
export const ACCOUNT_VALUES = ["COGS", "OpEx"] as const;
export type Account = (typeof ACCOUNT_VALUES)[number];

/** Required trimmed free-text tier (accountingSection / groupName). */
const requiredTier = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string()
      .min(1, `กรุณากรอก${label}`)
      .max(100, `${label}ต้องไม่เกิน 100 ตัวอักษร`)
  );

export const categoryInputSchema = z.object({
  account: z.enum(ACCOUNT_VALUES, {
    errorMap: () => ({ message: "กรุณาเลือกบัญชี (COGS หรือ OpEx)" }),
  }),
  accountingSection: requiredTier("หมวด"),
  groupName: requiredTier("กลุ่ม"),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

/** Thai display labels per schema field (keyed by zod issue.path[0]). */
export const CATEGORY_FIELD_LABELS_TH: Record<keyof CategoryInput, string> = {
  account: "ประเภทบัญชี",
  accountingSection: "หมวด",
  groupName: "กลุ่ม",
};

/** Thai gloss for each account value (Thai-first) — used by the form <select> options. */
export const ACCOUNT_LABELS_TH: Record<Account, string> = {
  COGS: "ต้นทุนขาย (COGS)",
  OpEx: "ค่าใช้จ่ายดำเนินงาน (OpEx)",
};
